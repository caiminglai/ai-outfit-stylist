/**
 * 入口闸门（第 2 项「接口输入校验」·2026-11-03 建）
 * ============================================================
 *
 * 为什么不是"再补一层统一校验库"
 * ------------------------------------------------------------
 * 本仓的入参尺子早就存在，就是 `utils/common.js`：`asText`／`asNumber`／`asId`／
 * `firstBadScalar`／`stripIdentityFields`，20 份路由文件全部 import 它。11-03 逐入口现量的判据＝
 * 把 `routes/` 的 81 个写入口 post/put/patch/delete 逐个切段、剥注释，再判
 * "这一段读不读 body、过没过守卫、写不写库"（当时的工装是盘外一次性探针，本轮收口已删净；
 * 上面这四行判据抄下来就能重跑，⛔ 不必去找那个文件名）：
 *
 *   - **读 body ＋ 写库 ＋ 零守卫的入口＝0 个**（这就是"没校验的路由容易吃脏数据崩掉"
 *     那句话的真身：它会以 better-sqlite3 绑参 TypeError/RangeError 的形态出成 500，
 *     而这一档现量已经为空）
 *   - 46 个写入口已经过守卫；25 个根本不读 body（只有 `:id` 或不带体）
 *   - 剩下 **10 个**：读 body、没过守卫，然后交给服务层算（`/gaps`／`/evaluate`／
 *     `/suggest`／`/match`／`/recommend`／`/enhance`／`/style-diagnose`／`PUT /archive`／
 *     `/notify/alipay`）——它们不写库所以不会 500 在绑参上，但会 500 在服务层里面，
 *     而那正是"入参错回成服务器故障"的同一个形状。
 *
 * 挂完之后各入口的落点（11-03 本轮，逐个都是先读该 handler 再决定，没有按清单猜）
 * ------------------------------------------------------------
 *   - `gateBody` 挂了 **13 个入口**：wardrobe 的 `/gaps`·`/evaluate`·`/suggest`·`/match`·`/recommend`
 *     ＋ accessory 与 cosmetic 各 `/gaps`·`/evaluate`·`/suggest` ＋ recommend `/enhance`
 *     ＋ analysis `/style-diagnose`。前三家那 11 个补的是顶层容器形状（`profile`／`candidate`／
 *     `wardrobe_items`）：传成字符串时 `Object.keys(profile).length === 0` 那句存在性检查挡不住，
 *     一路算完回 **200 加一份空结果**——脏数据不崩、静悄悄出空答案，比 500 更难查。
 *   - `capJson` 挂了 **3 处整坨落库**：customer 的 `POST /session`·`PUT /session/:sessionId`
 *     ＋ analysis `PUT /archive` 的草稿格（`profileArchive.saveDraft` 把整份表单
 *     `Object.entries(form)` 序列化进 `profile_drafts.form_json`，本轮现量补上的第三处）。
 *   - **判不挂、写明理由的 3 个**：analysis `POST /body` 已经有 `strictNum`／`cleanText`／
 *     `crossCheckErrors` 逐格校验并回 400 点名；analysis `PUT /archive` 的字段值走
 *     `saveArchive` 的"越界不写＋进 rejected 清单"，那条路⛔ 不许回 400（它是自动保存，
 *     注释在原处写着），所以这一处只加体积闸、不改字段；payment `POST /notify/alipay`
 *     是 form-urlencoded 的验签回调，`services/alipay.js:241` 起手就挡非对象、每条失败
 *     都回 `{ok:false}` 出 401，且 `gateBody` 一旦改写字段就会把签名打歪（`server.js:100`
 *     的 `verify` 留原始字节就是为了这类回调）——这一处一个字节都不许动。
 *
 * 所以缺的从来不是校验能力，是**"同一个入口的字段清单只写一处"这件事**。
 * 本文件只做这个收口：一张声明表 ＋ 一个中间件，底下**只调 utils/common.js 那批函数**，
 * ⛔ 不装 ajv／zod／express-validator——装一个要多一次 `npm install`、lock 变、
 * CI 的 `npm audit` 多一张面孔、发布面变大，而它买到的东西本仓已经有了。
 *
 * 400 的文案口径与 accessory/cosmetic/models 三处**逐字一致**
 * （`${字段} 只能是文本或数字`），不另起第二种说法。
 *
 * 这一层明确**不做**的两件事（都有现量依据，不是偷懒）：
 *   1. 不剔未知字段（不做白名单投影）：`grep -rn "\\.\\.\\.req\\.body" routes/` 现量 0 处，
 *      本仓没有 mass-assignment 现场；要挡的是类型，不是键名。
 *   2. 不碰业务规则（"身高不能小于 30"那种）：那在 `analysis.js` 的 `strictNum`／
 *      `crossCheckErrors` 里，已经有归属，不在这里再造一把。
 */

const { asText, asNumber, firstBadScalar } = require('../utils/common')
const { sendError } = require('../utils/response')

/**
 * @param {{scalars?: string[], numbers?: string[], objects?: string[], arrays?: string[]}} spec
 *   - `scalars`：会被原样绑进 SQLite／交给下游当标量用的列。布尔、数组、对象一律当场 400
 *     并点名是哪一格（判据＝`firstBadScalar`，null/undefined 放行，因为 null 是合法清列值）。
 *   - `numbers`：要落数字列的字段。数字串折成数，认不出的折成 **null**（＝"这一格没填"），
 *     ⛔ 不折成 0——`asNumber` 那条口径写得很清楚，0 会冒充一个真实的零值。
 *   - `objects`：整坨交给服务层的容器（`profile`／`candidate`／`recommendation` 这类）。
 *     传成字符串/数字/数组/布尔时当场 400——这些入口下面的服务会拿它读属性，
 *     字符串能一路读到 `profile.height === undefined` 再在某个 `.split()` 上炸成 500。
 *   - `arrays`：必须是数组的容器（`answers`／`wardrobe_items`）。理由同上，反过来的形状。
 *   ⚠️ 这四样都只管**顶层键**，且"没带"一律放行（`undefined`/`null` 不进判据）：
 *      每个入口自己那句"缺少 profile"的存在性检查照旧归它自己，本层不抢。
 *      容器**里面**的字段不递归校验——现量 10 个入口的崩溃面全在"顶层容器形状不对"，
 *      递归会把 `analysis.js` 已有的 `strictNum`／`crossCheckErrors` 那套业务判据抄成第二份。
 * @returns {(req, res, next) => any} express 中间件；放在鉴权与限流**之后**、业务 handler 之前
 */
function gateBody(spec = {}) {
  const scalars = spec.scalars || []
  const numbers = spec.numbers || []
  const objects = spec.objects || []
  const arrays = spec.arrays || []

  const middleware = (req, res, next) => {
    const body = req.body || {}

    // 先判形状，再谈折数：numbers 里的数组/对象也归 firstBadScalar 管（同一次扫描）
    const bad = firstBadScalar(body, scalars.concat(numbers))
    if (bad) return sendError(res, `${bad} 只能是文本或数字`, 400)

    for (const f of objects) {
      const v = body[f]
      if (v === undefined || v === null) continue
      if (typeof v !== 'object' || Array.isArray(v)) {
        return sendError(res, `${f} 要的是一个对象（形如 { ... }），这次传来的不是`, 400)
      }
    }
    for (const f of arrays) {
      const v = body[f]
      if (v === undefined || v === null) continue
      if (!Array.isArray(v)) {
        return sendError(res, `${f} 要的是一个列表（数组），这次传来的不是`, 400)
      }
    }

    for (const f of numbers) {
      if (body[f] !== undefined) body[f] = asNumber(body[f], null)
    }
    for (const f of scalars) {
      // 只有真是字符串时才 trim：asText 会把数字/布尔转成文本，那是"改变类型"，不是本层的活
      if (typeof body[f] === 'string') body[f] = asText(body[f])
    }
    return next()
  }
  // 给这一层留两个认得出的记号：name 让 express 的调试输出里它就是 `gateBody`，
  // bodyGateSpec 让栈形测试（test/bodyGate.test.js）能核对"这个入口声明的是哪几格"，
  // 不靠行号、不靠注释。新增写入口忘了登记，那条测试就会红。
  Object.defineProperty(middleware, 'name', { value: 'gateBody', configurable: true })
  middleware.bodyGateSpec = spec
  return middleware
}

/**
 * 整坨 JSON 落库前的体积闸门。
 *
 * 现场有三处：`routes/customer.js` 的 `POST /session` 与 `PUT /session/:sessionId` 写成
 * `JSON.stringify(req.body?.profile_data || req.body || {})` 直接进
 * `customer_sessions.profile_data`；`PUT /analysis/archive` 那一处读 body 之后不校验字段清单，
 * 整份表单经 `profileArchive.saveDraft` 的 `Object.entries(form)` 序列化进
 * `profile_drafts.form_json`。三张格的上限原本都是 `server.js:96` 那个
 * `express.json({limit:'10mb'})` ⇒ 一条请求能塞 10 MB 进运行库。
 * 这里给一个远小于 10 MB 的双上限（键数＋序列化字节），超了回 400 说清太大，
 * ⛔ 不许"截断后照存"：截出来的画像是一份没人填过的假数据，比拒收更坏。
 *
 * @param {*} value - 准备序列化的值
 * @param {{maxKeys: number, maxBytes: number}} limits
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function capJson(value, limits) {
  const maxKeys = limits.maxKeys
  const maxBytes = limits.maxBytes
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    // 循环引用（顾客从前端把整个组件状态回传时会碰到）序列化不了，
    // 这本来就是"这一格填错了"，不该把异常抛给调用方的 catch 抹成 500
    return { ok: false, reason: '这一格的内容序列化不了（可能带循环引用）' }
  }
  if (typeof text !== 'string') return { ok: false, reason: '这一格的内容不是可保存的结构' }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { ok: false, reason: `这一格超过 ${Math.round(maxBytes / 1024)} KB` }
  }
  const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value)
  const keys = isPlainObject ? Object.keys(value) : []
  if (keys.length > maxKeys) {
    return { ok: false, reason: `这一格的字段数超过 ${maxKeys} 个` }
  }
  return { ok: true }
}

/**
 * 三处整坨 blob 共用的上限。数值不是拍的：11-03 现量前端能塞进这几格的最大形状＝
 * `app/src/types/index.ts` 的 `CustomerProfile`（该 interface 从声明到收尾 114 行、
 * 顶层键 53 个，值全是短文本与数字，整个 blob 撑死 2 KB）。这里给约 4 倍键数余量、
 * 约 32 倍字节余量——够将来加字段，又离 `express.json` 那个 10 MB 粗闸很远，
 * 一条请求再也塞不进几十 MB 进运行库。三处共用这一个对象，别各写一遍迟早对不上。
 */
const FORM_BLOB_LIMITS = { maxKeys: 200, maxBytes: 64 * 1024 }

module.exports = { gateBody, capJson, FORM_BLOB_LIMITS }
