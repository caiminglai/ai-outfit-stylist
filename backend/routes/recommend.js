/**
 * 穿搭推荐路由模块
 * 对应 Python: app/routes/recommend.py
 *
 * 1. 规则引擎推荐：POST /engine（能识别出人时按人读写长期档案）
 * 2. 规则反馈：POST /feedback（有用/不准）
 * 3. LLM 文案增强：POST /enhance
 */
const express = require('express')
const db = require('../db/init')
const { sendSuccess, sendError } = require('../utils/response')
const { asText, normalizeItem, projectWardrobeForEngine } = require('../utils/common')
const { optionalUser, getCurrentUser, getSessionId } = require('../middleware/auth')
const { rateLimit } = require('../middleware/rateLimit')
const { gateBody } = require('../middleware/bodyGate')
const { buildRecommendation } = require('../services/recommendEngine')
// 报错与告警一律走 utils/logger：console.* 只落 stdout，容器里那份不归本项目留档，
// 事后按订单号/用户查不到痕迹（判据见 test/loggerDiscipline.test.js）
const { error: logErr, warn: logWarn } = require('../utils/logger')
const {
  loadArchive,
  mergeWithArchive,
  saveArchive,
  saveTags,
  writeRecommendationLog,
} = require('../services/profileArchive')
const {
  SIGNALS,
  recordFeedback,
  scoreError,
  clearFeedbackForGroup,
} = require('../services/ruleFeedback')
const {
  actorKeyOf,
  itemFeedbackError,
  recordItemFeedback,
  deleteItemFeedback,
  listItemFeedback,
  countItemFeedback,
} = require('../services/itemFeedback')
const { generateStructuredText } = require('../services/recommendReportText')
// 🔴 第十三阶段·第一步 §四·1：城市白名单与取天气都只从 `weatherService` 那一份真相源取
// （⛔ 路由里不许抄第二份名单，抄了就会出现"前端能选、后端说暂不支持"两套口径）
const { getWeather, levelFromFeelsLike, WEATHER_CITIES } = require('../services/weatherService')

// 推荐引擎限流：每分钟最多 20 次
const recommendLimiter = rateLimit({ windowMs: 60000, max: 20 })
// 另两条 POST 原来一道专用闸都没有，只靠全局 100 次/15 分钟那道按 IP 的共享闸
// （出口是 CGNAT，一个 IP 后面一片人）。这里各给一个桶，额度比引擎宽、
// 但不再和 /engine 共用计数——点反馈不该把重新推荐的额度提前吃掉（2026-10-12 补）。
const feedbackLimiter = rateLimit({
  windowMs: 60000,
  max: 60,
  message: '操作过于频繁，请稍后再试',
})
const enhanceLimiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: '文案生成过于频繁，请稍后再试',
})

const router = express.Router()

/**
 * 推荐模式取值表。
 * 库里 rule_groups.mode 实测只有 store／personal 两种（seed 264 组：store 102／personal 162），
 * 后台标签表也是这两档（static/admin/admin-utils.js:76），前端类型同样锁死
 * （app/src/api/recommend.ts:10 `'store' | 'personal'`，11-03 按内容重指：这一段原先在 api.ts 里）。原来这里是 `asText(data.mode) || 'store'`：
 * 任意长串都能一路写进 recommendation_logs.mode，再由 routes/history.js:27 当作
 * `scenario` 原样回吐到"我的历史"里 ⇒ 一条脏数据就是一个用户看得见的假场景名。
 * 认不到就当没填的两档之一，不再往库里写第三种值。
 */
const RECOMMEND_MODES = ['store', 'personal']

/**
 * 把请求里的 mode 收敛到枚举内。
 * @param {*} raw 请求原值
 * @param {string} fallback 没带或带空串时的默认档
 * @returns {{ok: true, mode: string} | {ok: false, error: string}}
 */
function normalizeMode(raw, fallback) {
  // 没带／空串＝按默认档；对象、数组这类非文本先当"没填"处理会静默换档，
  // 与仓内新口径（firstBadScalar：类型不对就 400，别替调用方猜）不一致 ⇒ 一并打回。
  if (raw === undefined || raw === null) return { ok: true, mode: fallback }
  if (typeof raw !== 'string') {
    return { ok: false, error: `mode 只能是 ${RECOMMEND_MODES.join(' / ')}` }
  }
  const v = asText(raw)
  if (!v) return { ok: true, mode: fallback }
  if (!RECOMMEND_MODES.includes(v)) {
    return { ok: false, error: `mode 只能是 ${RECOMMEND_MODES.join(' / ')}` }
  }
  return { ok: true, mode: v }
}

/**
 * 把这次身份名下的衣橱行读成引擎要的 `wardrobe_items`（2026-10-21 第九阶段·第一步）。
 *
 * 为什么要（现量，不是设想）：全仓 `wardrobe_items` 的注入点原来只有 `routes/wardrobe.js`
 * 里那一条，而前端唯一在用的推荐入口是 `/api/recommend/engine`（`app/src/api.ts` 里写死），
 * 调 `/api/wardrobe/recommend` 的次数现量 **0** ⇒ **用户真正看到并打分的那张卡永远没有身体维**
 * （`docs/依据/17-协同过滤输入输出规范-20261021.md` §一 第 4 条）。
 *
 * ⛔ 三条边界：
 *  ① 只按 `session_id`（有登录态再并上 `user_id`）取，绝不跨人——这一步做错了就是把 A 顾客
 *     扫码录的衣服推给 B 顾客，属于隐私事故而不是排序瑕疵；
 *  ② 认不到身份或查不到行 ⇒ 返回空数组，调用方保持改前行为（这是"默认关得住"那条回归防线的落点）；
 *  ③ 投影只用 `utils/common.js` 的 `projectWardrobeForEngine`，⛔ 不在这里抄第二份字段清单。
 * @param {{sessionId:string|null, userId:number|null}} who
 * @returns {Array<object>}
 */
function loadWardrobeForEngine(who) {
  const sid = asText(who.sessionId)
  const arms = []
  const args = []
  if (sid) {
    arms.push('session_id = ?')
    args.push(sid)
  }
  if (typeof who.userId === 'number') {
    arms.push('user_id = ?')
    args.push(who.userId)
  }
  if (arms.length === 0) return []
  try {
    const rows = db
      .prepare(
        `SELECT * FROM user_wardrobe
          WHERE (${arms.join(' OR ')})
          ORDER BY created_at DESC
          LIMIT 200`,
      )
      .all(...args)
    // 🔴 10-22 第十三阶段·一f 真浏览器那一下抓出来的：这里原来写 `rows.map(normalizeItem)`，
    // `normalizeItem(row, tagFields)` 的第二个参数被 `Array.map` 塞进来的是**下标**——
    // 第一行下标 0（假值）走默认词表、第二行起下标 ≥1（真值）被当成词表数组去 `for...of`，
    // 当场 `TypeError: fields is not iterable`。整条衣橱注入被下面那个 catch 吞成空数组，
    // 只留一行日志 ⇒ 名下一件衣服时看得见卡片、两件以上整批消失，顾客连星都点不了。
    // ⛔ 回调带可选参数的函数一律不许直接递给 `.map()`。
    return rows.map((row) => normalizeItem(row)).map(projectWardrobeForEngine)
  } catch (err) {
    // 读衣橱失败不该把整次推荐打挂：这一格读不到就是"没有可算的衣服"，退回改前的名单
    logErr('[推荐] 读取衣橱候选失败:', err)
    return []
  }
}

/** 规则引擎推荐（新版，无需登录；能识别出人时按人读写长期档案） */
router.post('/engine', recommendLimiter, async (req, res) => {
  try {
    const data = req.body || {}
    const profile = data.profile
    // profile 必须是对象：传成数组/字符串时 Object.keys() 照样有长度，挡不住，
    // 一路带到引擎里按字段取值、往 SQL 里绑值才炸。入参形状不对就该 400。
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return sendError(res, '缺少 profile 数据', 400)
    }
    // mode 认不到就 400，不再原样往库里写（见上面 RECOMMEND_MODES 的说明）。
    // 前端 app/src/api/recommend.ts:10 把这两档写死在类型里，本仓没有第三种调用方。
    const normalizedMode = normalizeMode(data.mode, 'store')
    if (!normalizedMode.ok) return sendError(res, normalizedMode.error, 400)
    const mode = normalizedMode.mode

    if (Object.keys(profile).length === 0) {
      return sendError(res, '缺少 profile 数据', 400)
    }

    const user = optionalUser(req)
    const archive = loadArchive(user ? user.id : null)
    const { profile: merged, used } = mergeWithArchive(profile, archive)

    // 衣橱候选注入（10-21 第九阶段·第一步，`17` §五 第 2~3 条）。
    // 请求体里已经带了 `wardrobe_items` 就沿用（那是改前唯一能送进来的路子，不改它的语义）；
    // 没带才从库里按这次身份读——读不到行 ⇒ 数组为空 ⇒ 名单与改前逐条相同。
    const sessionId = getSessionId(req)
    if (!Array.isArray(merged.wardrobe_items) || merged.wardrobe_items.length === 0) {
      const items = loadWardrobeForEngine({ sessionId, userId: user ? user.id : null })
      if (items.length > 0) merged.wardrobe_items = items
    }

    // 🔴 10-21 第十三阶段·第一步 §四·1（你拍的板：「推荐时现取天气一起带上」）。
    // `city` 是**可选**入参，白名单＝`weatherService` 那份（10 城，⛔ 这里不抄第二份名单）。
    // 三条口径按 `21` §四·1 逐条落：
    //  ① 取到了 ⇒ 只注入 `merged.weather_level`／`merged.feels_like_c`，与第十一阶段那一格同语义：
    //     **只当这一屏排序的输入**，⛔ 不进长期档案（`profileArchive.js` 那两份白名单收不到它）、
    //     ⛔ 不进 `input_snapshot`（下面 `logProfile` 那一处剥掉，否则 `loadPrefill` 会把这次的
    //     天气当成他填的档带进下一次表单）；
    //  ② 取不到（名单外／上游超时／上游字段缺／折算不出档）⇒ **fail-open**：照样出推荐，只多回
    //     `weather_source:'failed'` ＋一句人话，⛔ 500、⛔ 400、⛔ 拿 22°C 那种假默认值顶
    //     （`weatherService.js` 早就把 defaultWeather 废掉了，本轮不许在前端把它请回来）；
    //  ③ 没带 `city` ⇒ 上面两个键**一个都不写**，响应与改前逐字节相同（§八·9 那条回归锚）。
    // ⚠️ 结构性代价写在这：本 handler 从同步变 async（全仓唯一一条 async 推荐路径），
    //    `recommendLimiter`（20 次/分钟）与错误处理形状照旧不变。
    const city = asText(data.city).trim()
    let weatherSource = null
    let weatherNotice = null
    if (city) {
      weatherSource = 'failed'
      if (!WEATHER_CITIES.includes(city)) {
        weatherNotice = `「${city.slice(0, 40)}」不在可选城市里，本次不带天气档。可选城市：${WEATHER_CITIES.join('、')}`
      } else {
        try {
          const wx = await getWeather(city) // 600 秒内存缓存：同一城第二次不打外网
          const level = levelFromFeelsLike(wx.feelsLike)
          if (level) {
            merged.weather_level = level
            merged.feels_like_c = wx.feelsLike
            weatherSource = 'live'
          } else {
            weatherNotice = '天气服务这次没回可用的体感温度，本次不带天气档。'
          }
        } catch (err) {
          // fail-open：天气取不到不该把推荐打挂，也不该把 404/503 透给顾客当推荐失败
          weatherNotice = `${err && err.message ? err.message : '天气暂时取不到'}（本次不带天气档，名单不受影响）`
        }
      }
    }
    // 🔴 10-21 第十一阶段·第一步（`docs/依据/19` §五 第 1 条）：`profile.weather_level` 走的是
    // 与 `occasion` 同一条来路——**请求里给、只当这一屏排序的输入**。三条边界写死在这里：
    //  ① ⛔ 不落库、⛔ 不进长期档案：`profileArchive.js` 的 `saveArchive` 只认 `BODY_FIELDS`/`FACE_FIELDS`
    //     两份白名单，`weather_level` 不在里面（`occasion` 也不在，同一个口径），所以这一格天然存不进去；
    //  ② 表外词不 400——引擎侧 `wearPreference.normalizeWeatherLevel` 把它当"没带天气档"，
    //     `warmth` 那一轴整块缺席（读路径不是写路径，⛔ 不许在这里发明第二条尺子）；
    //  ③ ⛔ 系统绝不替用户猜档：没带就是没带，硬规矩 2「缺测不出分」。
    // 第四参数＝身份，给排序层现算隐性偏好乘子用（穿搭日记 0 条 ⇒ 乘子恰好 1，Top 8 与改前逐条相同）。
    // 两种模式照同一个身份传：日记本来就是 session∪user 并集口径认的，
    // 门店演示机那种没登记过会话的请求查不到任何行 ⇒ 这一层自动隐身。
    const result = buildRecommendation(merged, mode, true, {
      sessionId,
      userId: user ? user.id : null,
    })

    let savedFields = 0
    let tags = []
    if (user) {
      const saved = saveArchive(user.id, profile)
      savedFields = saved.body + saved.face
      tags = saveTags(user.id, result)
      // 🔴 §四·1「只当这一屏」这句承诺的落点（10-22 补）：天气档是我们这一拍替他去 Open-Meteo
      // 取的，⛔ 不是他填的，所以不许留在 `input_snapshot` 里——`loadPrefill`（:270）会把整份
      // 快照原样回吐成下一次的表单预填，留着等于把"上周北京 3°C 那一档"悄悄带进今天的推荐。
      // 只剥我们注入的那两格；他自己在请求里带来的 `profile.weather_level`（第十一阶段那条来路）
      // 语义没变，照旧进快照。
      const logProfile =
        weatherSource === 'live'
          ? (() => {
              const copy = { ...merged }
              delete copy.weather_level
              delete copy.feels_like_c
              return copy
            })()
          : merged
      writeRecommendationLog({
        sessionId: getSessionId(req),
        userId: user.id,
        mode,
        profile: logProfile,
        result,
      })
    }

    return sendSuccess(
      res,
      {
        recommendation: result,
        mode: mode,
        // §四·1 天气那一路的账：只有**带了 city** 才多这两个键（没带 ⇒ 响应与改前逐字节相同）。
        // 'live'＝这次真的按体感温度折了档并进排序；'failed'＝名单外或上游没给，名单照出、不带天气档。
        ...(weatherSource ? { weather_source: weatherSource } : {}),
        ...(weatherNotice ? { weather_notice: weatherNotice } : {}),
        privacy_notice: '推荐结果基于您填写的数据生成。',
        archive: {
          // 本次沿用了档案里的哪些条件(中文名),供前端说明"少填了也没关系"
          used_fields: used,
          saved_fields: savedFields,
          // 算完就存的结论标签,库里查得到同一份
          tags,
        },
      },
      '规则引擎推荐已生成',
    )
  } catch (err) {
    logErr('[推荐] 规则引擎失败:', err)
    return sendError(res, '推荐失败', 500)
  }
})

/**
 * 规则反馈：一条建议到底准不准，点一次记一行，换主意覆盖旧的那行。
 *
 * 10-19 第三阶段·模块三加了四样都可选：两把星级（审美/合身 1~5）、这条落在哪件衣服、
 * 以及**打分那一刻的三维分快照**（`rank`，由前端把推荐结果里那条的 rank 原样带回）。
 * 星级越界 ⇒ 400 说破（不静默抹成"没打"）；快照认不出形状 ⇒ 存 NULL（宁缺不猜）。
 *
 * 🔴 第八阶段·第一步（10-20）：`signal` 多一档 `rated`＝"只打了星、没点👍/👎"。
 * 这一档必须**至少带一把星**才收（下面那条守卫）：否则它会变成"有一行、什么信息都没有"的噪声，
 * 而 `feedback_events` 的 `UNIQUE(user_id, group_id)` 还会把这个人在这条规则上的正负表态顶掉。
 * 规范见 `docs/依据/16-数据采集输入输出规范-20261020.md` §一·1.1。
 */
router.post('/feedback', feedbackLimiter, (req, res) => {
  try {
    const data = req.body || {}
    // 🔴 第十四阶段·第一步 X4 现量到的同源缺陷（本文件 `DELETE /feedback/group` 同一把尺子）：
    // 原来这里是 `Number.parseInt(data.group_id, 10)`，`1.5` 会**截成 1** 一路写进**另一条规则**上，
    // 顾客给第 1.5 条打的分落到了第 1 条——形状不对就该 400 说破，⛔ 拿猜出来的编号入库。
    const groupId = Number(asText(data.group_id))
    const signal = data.signal
    const category = typeof data.category === 'string' ? data.category.slice(0, 20) : null

    if (!Number.isInteger(groupId) || groupId <= 0) return sendError(res, '缺少有效的规则编号', 400)
    if (!SIGNALS.includes(signal))
      return sendError(res, `signal 只能是 ${SIGNALS.join(' / ')}`, 400)
    const sErr = scoreError(data)
    if (sErr) return sendError(res, sErr, 400)
    if (signal === 'rated' && data.aesthetic_score == null && data.fit_score == null) {
      return sendError(res, '只打星不表态时，至少要给一把星（审美或合身）', 400)
    }

    const user = optionalUser(req)
    if (!user) return sendError(res, '识别不出你是谁，无法记录反馈', 401)

    const stat = recordFeedback(user.id, groupId, category, signal, {
      aesthetic_score: data.aesthetic_score,
      fit_score: data.fit_score,
      wardrobe_item_id: data.wardrobe_item_id,
      rank: data.rank && typeof data.rank === 'object' ? data.rank : undefined,
    })
    if (!stat) return sendError(res, '规则不存在', 404)
    return sendSuccess(res, stat, '反馈已记录')
  } catch (err) {
    logErr('[推荐] 反馈记录失败:', err)
    return sendError(res, '反馈记录失败', 500)
  }
})

/**
 * 撤掉自己在这条规则上的整行反馈（2026-10-22 第十四阶段·第一步 X4）。
 * 契约见 `docs/依据/22-用户体验与商业模式输入输出规范-20261022.md` §五。
 *
 * 为什么非开这个口不可：前端把最后一颗星抹掉时，POST 那一路唯一的合法形态
 * （`signal='rated'`＋两把星全空）正好被 :303 那条守卫 400 掉——它防的是"空壳行"，
 * 但用户此刻想说的是"这条我改主意了，当我没评过"。⛔ 不能靠 POST 送 null 实现撤销，
 * 那要么撞守卫、要么写出一行什么信息都没有的噪声，两头都是坑。
 *
 * 三条口径与下面那条 `DELETE /feedback/item` 逐字对齐，只是这张表按 `user_id` 认人
 * （`feedback_events` 的 `UNIQUE(user_id, group_id)`，游客没有 user_id ⇒ POST 本来就 401，
 * 撤销跟着同一个门槛走，⛔ 不新造第二套身份判定）：
 *  ① 只按 `user_id` 删自己的行 ⇒ ⛔ 不可能删到别人的星；
 *  ② 规则不存在 ⇒ **404 `规则不存在`**（与 POST 那条同一个说法，不另造词）；
 *  ③ 规则存在、但你本来没评过 ⇒ 200 带 `deleted:0`（幂等，前端重复点不报错）。
 * 计数由 `clearFeedbackForGroup` 重算：从 `feedback_events` 现数，⛔ 做减法。
 */
router.delete('/feedback/group', feedbackLimiter, (req, res) => {
  try {
    const groupId = Number(asText(req.query.group_id))
    if (!Number.isSafeInteger(groupId) || groupId <= 0)
      return sendError(res, '缺少有效的规则编号', 400)

    const user = optionalUser(req)
    if (!user) return sendError(res, '识别不出你是谁，无法撤销反馈', 401)

    const deleted = clearFeedbackForGroup(user.id, groupId)
    if (deleted === null) return sendError(res, '规则不存在', 404)
    return sendSuccess(
      res,
      { group_id: groupId, deleted },
      deleted ? '这条评分已清除' : '这条本来就没有你的评分',
    )
  } catch (err) {
    logErr('[推荐] 反馈撤销失败:', err)
    return sendError(res, '撤销失败', 500)
  }
})

/**
 * 人 × 衣服 的评分（2026-10-21 第九阶段·第一步）。
 * 契约全部在 `docs/依据/17-协同过滤输入输出规范-20261021.md` §二·2.2 那六条，逐条对应：
 * 越界星 400／表外场合 400／不是你的衣服 404／没星没表态 400／快照认不出形状存 NULL。
 *
 * ⛔ 这一条**不写 `feedback_events`、不回写 `rule_groups` 的好评差评数**：
 * 那张表评的是"这条规则准不准"，这张表评的是"这件衣服你穿得怎么样"，两层语义不同、不许混。
 */
router.post('/feedback/item', feedbackLimiter, (req, res) => {
  try {
    const data = req.body || {}
    const user = optionalUser(req)
    const actor = { userId: user ? user.id : null, sessionId: getSessionId(req) }
    if (!actorKeyOf(actor)) {
      return sendError(
        res,
        '识别不出你是谁（需要登录态或 X-Session-Id），无法记录这件衣服的评分',
        401,
      )
    }
    const err = itemFeedbackError(data)
    if (err) return sendError(res, err, 400)

    const itemId = Number(data.wardrobe_item_id)
    const saved = recordItemFeedback(actor, {
      wardrobe_item_id: itemId,
      occasion: data.occasion,
      signal: data.signal,
      aesthetic_score: data.aesthetic_score,
      fit_score: data.fit_score,
      rank: data.rank && typeof data.rank === 'object' ? data.rank : undefined,
    })
    // recordItemFeedback 里已经做过归属校验：认不到就 null ⇒ 回 404（⛔ 不是 403，
    // 那等于向调用方承认这一行存在，是本项目既有的越权口径，见 16 §四 第 3 条）
    if (!saved) return sendError(res, '这件衣服不存在或不属于你', 404)
    return sendSuccess(
      res,
      { ...saved, rank_snapshot: undefined, total_in_db: countItemFeedback() },
      '这件衣服的评分已记录',
    )
  } catch (err) {
    logErr('[推荐] 衣物评分记录失败:', err)
    return sendError(res, '评分记录失败', 500)
  }
})

/**
 * 读回这个人在指定这几件衣服上已有的评分（前端回填那两把星）。
 * ⛔ 只准读自己的：查询键就是 `actor_key`，跨人的读数一律没有（`17` §4.4 隐私口径）。
 */
router.get('/feedback/items', (req, res) => {
  try {
    const user = getCurrentUser(req)
    const actor = { userId: user ? user.id : null, sessionId: getSessionId(req) }
    if (!actorKeyOf(actor)) return sendError(res, '缺少 X-Session-Id', 400)
    const raw = asText(req.query.ids) || ''
    const ids = raw
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isSafeInteger(v) && v > 0)
    return sendSuccess(res, { items: listItemFeedback(actor, ids) })
  } catch (err) {
    logErr('[推荐] 衣物评分读取失败:', err)
    return sendError(res, '查询失败', 500)
  }
})

/**
 * 撤掉这个人在某一件衣服上的评分（10-21 第十三阶段·第一步 §四·2「衣橱的星可以撤」）。
 * 三条口径（`docs/依据/21` §四·2，全部在 `itemFeedback.deleteItemFeedback` 里落实）：
 *  ① 只按 `actor_key` 删自己的行 ⇒ ⛔ 不可能删到别人的星；
 *  ② 这一件不是你的／库里没有 ⇒ **404**（⛔ 403——那等于承认这一行存在，与 POST 那条同源口径）；
 *  ③ 是你的、但本来没评过 ⇒ 200 带 `deleted:0`（幂等，前端重复点"清除评分"不报错）。
 * ⛔ 不动 `feedback_events`、⛔ 不回滚 `rule_groups` 的好评差评数（两层语义，见 POST /feedback 那段禁令）。
 */
router.delete('/feedback/item', feedbackLimiter, (req, res) => {
  try {
    const user = optionalUser(req)
    const actor = { userId: user ? user.id : null, sessionId: getSessionId(req) }
    if (!actorKeyOf(actor)) {
      return sendError(
        res,
        '识别不出你是谁（需要登录态或 X-Session-Id），无法撤销这件衣服的评分',
        401,
      )
    }
    const itemId = Number(asText(req.query.wardrobe_item_id))
    if (!Number.isSafeInteger(itemId) || itemId <= 0) {
      return sendError(res, 'wardrobe_item_id 要是一个正整数', 400)
    }
    const out = deleteItemFeedback(actor, itemId)
    if (!out) return sendError(res, '这件衣服不存在或不属于你', 404)
    return sendSuccess(
      res,
      out,
      out.deleted ? '这件衣服的评分已清除' : '这件衣服本来就没有你的评分',
    )
  } catch (err) {
    logErr('[推荐] 衣物评分撤销失败:', err)
    return sendError(res, '撤销失败', 500)
  }
})

/** LLM 文案增强（降级为规则版结构化文本） */
router.post(
  '/enhance',
  enhanceLimiter,
  // recommendation/weather 的形状原来靠 catch 里 `err instanceof TypeError` 那一段兜（见本 handler 末尾的注释），
  // 兜得住但话术只有"recommendation 结构不正确"一句。挂上前置闸门，脏形状当场 400 点名是哪一格，
  // 与 /engine 的 profile 那条（本文件里"profile 必须是对象"那段注释）同一把尺子。
  gateBody({ objects: ['recommendation', 'weather'] }),
  (req, res) => {
    try {
      const data = req.body || {}
      const recommendation = data.recommendation || {}
      const weather = data.weather || null
      // 同一个 mode，这条口以前是 `data.mode || 'personal'` 直接进文案生成：
      // 前端传进来的东西越长，越容易把整段模板拼歪。收敛到同一张取值表。
      const normalizedMode = normalizeMode(data.mode, 'personal')
      if (!normalizedMode.ok) return sendError(res, normalizedMode.error, 400)
      const mode = normalizedMode.mode

      if (!recommendation || Object.keys(recommendation).length === 0) {
        return sendError(res, '缺少 recommendation 数据', 400)
      }

      // 生成结构化文本（未配置 LLM 时降级）
      const text = generateStructuredText(recommendation, weather, mode)

      return sendSuccess(res, { text })
    } catch (err) {
      // generateStructuredText 会逐层解引用 recommendation 的嵌套块(top_spec.fit.present 等)。
      // 调用方把某块传成非对象(如 {"top_spec":1})时那是 TypeError,本质是"入参结构不对",该 400,
      // 而不是被外层一律算成服务器故障 500。真正的内部异常仍归 500。
      if (err instanceof TypeError) {
        logWarn('[推荐] 文案生成入参结构不对:', err.message)
        return sendError(res, 'recommendation 结构不正确', 400)
      }
      logErr('[推荐] 文案生成失败:', err)
      return sendError(res, '文案生成失败', 500)
    }
  },
)

module.exports = router
