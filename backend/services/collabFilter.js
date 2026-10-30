/**
 * 协同过滤层：「和你体型相近的人，怎么给这件衣服打分」＋「在这种天气下常穿哪一档」
 * ============================================================
 * 规范出处：`docs/依据/17-协同过滤输入输出规范-20261021.md` §四（星级那一路）
 *        ＋ `docs/依据/19-穿搭日记与天气输入输出规范-20261021.md` §六（10-21 第十一阶段加的第二路：日记属性档分布）
 *        ＋ `docs/依据/21-算法四轴输入输出规范-20261021.md` §五（10-22 第十三阶段加的第三路：同组人的色族分布）。
 * 本文件是这三节的实现，三路共用同一套闸门与同一道界，⛔ 各开各的参数。
 *
 * 它是一层**乘子**，⛔ 不是第四个权重：
 *  - 不进 `rankDims` 的三维出账、不改 `algoScoreOf`、不进回归的自变量（`17` §4.3 第 2 条 ＝ `19` §六 第 4 条逐字继承），
 *    只在总分末尾乘一刀，幅度与偏好乘子同界 `[0.95,1.05]`（一个数字少一个真相源）；
 *  - 库里 `item_feedback` 0 行 ⇒ 这一层今天上线就是 100% 隐身（`factor` 恰好 1）。
 *    ⛔ 不许为了让它"看起来在工作"而拿规则命中数或日记数冒充 likes——那是本项目反复清扫的注水病灶。
 *
 * 🔴 现在这一层**有三个信号**，各出一个 factor：
 *  ① 星级——"同组的人给**这一件**打几分"（键是 `wardrobe_item_id`，只在衣橱那几行上有）；
 *  ② 日记属性档——"同组的人在这个温度档**常穿哪一档厚薄**"（键是厚薄档，⛔ 不是衣服）；
 *  ③ 色族——"同组的人**常穿哪一族色**"（键是 `color_family`，⛔ 不是衣服；第十三阶段 `21` §五）。
 *  三个 factor **相乘之后再夹紧一次**（`19` §六 第 3 条 ＋ `21` §五 第 4 条），不是把几路折成一个中间值——
 *  那是"平均掉互相反对的结论"，本项目第 N 次拒绝。任一路样本不足 ⇒ 那一路恰好 1。
 *  为什么第二、三路只能比属性档：`wardrobe_outfits.item_ids` 指向的是**每个人自己的衣橱行**，
 *  两个人各有各的"蓝衬衫"，跨人比 id 语义上不成立；全库唯一能跨人比"同一件"的钥匙是 `sku`，
 *  本机库现量 0 行非空（`19` §六 第 1 条）。⇒ ⛔ 这一层永远不许说"和你身材相近的人也买了这件"。
 *
 *  ⚠️ 第三路与第二路的**唯一**结构差别：它不看温度档（`21` §五 只点名复用那四个数，
 *  温度闸不在那四个数里）。所以库里"没填天气的日记"也会喂这一路——这一条在 ⑫⑰⑱ 那三条
 *  第十一阶段的老断言上是**行为变更**，老断言的意图（"没带档 ⇒ 日记那一路整块缺席"）靠把 fixture
 *  改成"色族那一格也取不到"来保住，第三路自己的在场/隐身由新增的 ⑲~㉓ 钉。
 *
 * ⚠️ 与 `wearPreference.js` 的分工：那一层读的是**这个人自己**的日记（我记我穿什么），
 * 这一层读的是**别人**留下的信号（相似的人怎么评它、相似的人在这种天气穿什么、相似的人常穿哪一族色）。
 * 两张表、三句话术，不许互借数据——**但同一格只许有同一把尺子**：色族这一路读候选走偏好层那个
 * `candAxisValue(cand,'color_family')`，读别人的衣橱走偏好层那句 `colorFamily(color) || colorFamily(name)`，
 * ⛔ 不在这里再写第三份判族逻辑（读法分叉等于几个 factor 建在不同口径上）。
 *
 * 🔴 措辞红线（`17` §4.4 ＋ `19` §九 ＋ `21` §五 第 6 条）：对外只许说"和你体型相近的人给这件打分高（同组 N 人）"
 *    或"和你体型相近的人在这个温度档常穿厚（同组 N 人·M 套）"
 *    或"和你体型相近的人记的 M 套里有 K 套穿蓝（同组 N 人）"这一族**份额**话，
 *    ⛔ 说成"和你身材相近的人也喜欢这个色"里那个"喜欢"是行为份额不是态度（本轮没有态度数据）；
 *    单条打分人／日记人／姓名／门店／时间戳一律不出前端；`cohort_size < 3` 之前这一句整体不许出现在顾客端。
 */
const db = require('../db/init')
const { actorKeyOf } = require('./itemFeedback')
const { asText, parseIdList } = require('../utils/common')
// 厚薄档的词表唯一真相源是 `topFitBody.js` 的 `FABRIC_WEIGHT_VALUES`（薄/中/厚），⛔ 不在这里抄第二份
const { FABRIC_WEIGHT_VALUES } = require('./topFitBody')
// 温度档词表唯一真相源是 `weatherService.js` 的 `WEATHER_LEVELS`；这一层只认它，⛔ 不自己判阈值
const { WEATHER_LEVELS, levelFromFeelsLike } = require('./weatherService')
// "这一条候选的厚薄是哪一档"与偏好层用同一个读法（它认 `fabric_weight` 与 `body_fit.top.fabric_weight` 两个来源）。
// ⛔ 不在这里再写一份取格逻辑：两路信号读同一格，读法分叉等于两个 factor 建在不同口径上。
const { candAxisValue } = require('./wearPreference')
// 🔴 第三路（`21` §五）：判族那把尺子唯一真相源是 `colorMetrics.js:935`（🔴 10-30 按内容重指：原写 933＝它 JSDoc 的 `@returns` 行） 的 `colorFamily`，
// 偏好层读别人衣橱用的就是它（`wearPreference.js:234`）⇒ 这一层必须调同一个函数，⛔ 不抄第二份族表。
const { colorFamily } = require('./colorMetrics')

/**
 * 参数一档全在这里（⛔ C 档手拍值：产品口径，标定中，未做文献回归，对外不许称"科学/量化"）。
 * `COLLAB_FILTER_ENABLED=0` 是退出开关（`17` §4.3 第 2 条要求"能一键关"）：
 * 关掉后 `buildCohortModel` 直接返回 null ⇒ 每条候选的乘子恰好是 1 ⇒ Top 8 与改前逐条相同。
 */
const COLLAB_CONFIG = {
  enabled: process.env.COLLAB_FILTER_ENABLED !== '0',
  /** 体型距离阈值（归一化后的平均绝对差） */
  DIST_MAX: 0.35,
  /** 经验贝叶斯收缩的先验条数：`shrunk = (n·组内均值 + K·全局均值) / (n + K)` */
  K_PRIOR: 5,
  /** 乘子幅度：收缩分每偏离全局均值 1 星（满量程 4 星）抬/压 6% */
  AMP: 0.06,
  STAR_SPAN: 4,
  FACTOR_MIN: 0.95,
  FACTOR_MAX: 1.05,
  /** 隐私与噪声共用的一道闸：组内不足 3 人 ⇒ 不出话术、乘子恰好 1 */
  MIN_COHORT: 3,
  /**
   * 三项各自的参照跨度（cm）。⛔ 不是人体极差，是"多远的差算 1.0"的尺子：
   * 身高 20cm、净胸围 25cm、净肩宽 6cm——肩宽一项的人间跨度本来就比身高小，
   * 用同一个分母会让肩宽那点差异在距离里彻底哑掉。跨度值本身是 C 档手拍。
   */
  REF: { height: 20, bust: 25, shoulder: 6 },
  /** 至少要有两格可比才算"体型相近"：只有身高一格可比 ⇒ 判不可比（宁可不说话） */
  MIN_COMPARABLE: 2,

  // ── 第二路信号：日记属性档分布（`19` §六）───────────────────────────
  /**
   * 这一路比的是哪一个属性档。本轮只做 `fabric_weight`（厚薄）：
   * 它是衣橱录入里已经有词表、且**跨人能同义**的那一格（我的"厚"和你的"厚"是同一个意思），
   * 而"这件蓝衬衫"不是（`19` §六 第 1 条：跨人比 `item_ids` 语义上不成立）。
   * ⛔ 这一格的名字不许在别处再写一份——出账、话术、读候选全用这一个常量。
   */
  DIARY_ATTRIBUTE: 'fabric_weight',
  /**
   * 分布这一路的"满量程"。⚠️ 这不是第三个手拍幅度：份额本身就是 0~1 的数，
   * 满量程按**定义**是 1（星级那一路的满量程按定义是 4 星，同一个道理）。
   * 抬降压的力道与上下界仍然共用 `AMP`/`FACTOR_MIN`/`FACTOR_MAX`/`K_PRIOR`——
   * `19` §六 第 2 条逐字写着"⛔ 不许开第二个 AMP、第二个上下界"。
   */
  SHARE_SPAN: 1,

  // ── 第三路信号：同组人的色族分布（`21` §五）─────────────────────────
  /**
   * 这一路比的是哪一个属性档。⚠️ 这一格**不是第五个可调参数**、也**不是新词表**：
   * 它是偏好层四轴里已经存在的那个轴名（`wearPreference.js:58` 的 `MULTIPLIER_AXES` 第一项），
   * 读候选走现成的 `candAxisValue(cand,'color_family')`，判族走现成的 `colorFamily`。
   * 本轮没有为这一路开任何新的阈值／幅度／上下界（`21` §五 逐字"⛔ 开第五个数、⛔ 开第二个界"）：
   * 闸门全部复用上面 `DIST_MAX`／`K_PRIOR`／`MIN_COHORT`／`AMP`／`FACTOR_MIN`／`FACTOR_MAX`，
   * 满量程同样按定义取份额的 1（`SHARE_SPAN`）。
   */
  COLOR_ATTRIBUTE: 'color_family',
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * 份额型信号（第二路厚薄、第三路色族）**共用的那一个算式**：
 * `shrunk = (n·组内份额 + K_PRIOR·全局份额) / (n + K_PRIOR)`，
 * `factor = clamp(1 + AMP·(shrunk − 全局份额)/SHARE_SPAN, FACTOR_MIN, FACTOR_MAX)`。
 * 🔴 第十三阶段把它抽出来的唯一理由是"一处真相源"：`19` §六 第 2 条与 `21` §五 第 3 条写的是同一条式子，
 * 在第三路里再抄一遍＝将来有人改一路忘另一路，两个 factor 从此建在两把尺子上（本项目反复清扫的病灶）。
 * ⛔ 这里没有新参数：`K_PRIOR`／`AMP`／`SHARE_SPAN`／上下界全部读 `COLLAB_CONFIG` 那几个老数。
 */
function shrinkShare(k, n, gk, globalN) {
  const mean = k / n
  const globalShare = globalN > 0 ? gk / globalN : 0
  const shrunk = (n * mean + COLLAB_CONFIG.K_PRIOR * globalShare) / (n + COLLAB_CONFIG.K_PRIOR)
  const factor = clamp(
    1 + COLLAB_CONFIG.AMP * ((shrunk - globalShare) / COLLAB_CONFIG.SHARE_SPAN),
    COLLAB_CONFIG.FACTOR_MIN,
    COLLAB_CONFIG.FACTOR_MAX,
  )
  return { mean, globalShare, shrunk, factor }
}

/** 取一个"能进算术"的厘米数：没填／非有限／≤0 一律当没有（⛔ 0 不许冒充 0cm 的人体） */
function cm(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** actor_key `'u123'` → 123；`'s…'`（没建成游客档的会话）→ null，这一条当"没有体型档案"处理 */
function actorUserId(actorKey) {
  const m = /^u(\d+)$/.exec(String(actorKey || ''))
  return m ? Number(m[1]) : null
}

/**
 * 两个人的体型距离＝三项标准化差的**平均**绝对值（`17` §4.2 落地时对原文做了一处订正，
 * 逐字记在 §九：原来写的是"绝对值的和"，但按 §4.2 那个 0.35 的阈值，三相加等于要求
 * 三项各自只差 2~3cm，五个人里凑不出一个组，这一层永远隐身——阈值与算式必须配套）。
 * 只有一格可比 ⇒ 判不可比（返回 null），⛔ 不许把缺的那几格按 0 差处理（那是白送相似）。
 * @param {{height:?number,bust:?number,shoulder:?number}} a
 * @param {{height:?number,bust:?number,shoulder:?number}} b
 * @returns {null|number}
 */
function bodyDistance(a, b) {
  let sum = 0
  let n = 0
  for (const k of ['height', 'bust', 'shoulder']) {
    const x = a && a[k]
    const y = b && b[k]
    if (x == null || y == null) continue
    sum += Math.abs(x - y) / COLLAB_CONFIG.REF[k]
    n += 1
  }
  if (n < COLLAB_CONFIG.MIN_COMPARABLE) return null
  return sum / n
}

/**
 * 一条打分里的"这个人有多喜欢这件"：两把星都在取均值，只有一把就用那一把，都没有 ⇒ null。
 * ⛔ 不做"好看为主"那种偏心加权——两把星各自是色彩与廓形的实测反馈，权重还没标定过。
 */
function likeValue(row) {
  const a = row.aesthetic_score
  const f = row.fit_score
  const has = [a, f].filter((v) => Number.isInteger(v) && v >= 1 && v <= 5)
  if (has.length === 0) return null
  return has.reduce((s, v) => s + v, 0) / has.length
}

/**
 * 体型档案表（`user_id` → 三项厘米数）。两路信号组 cohort 用的是**同一份**距离尺子，
 * 所以这张表也只许有一份读法（⛔ 星级一次、日记一次各写各的 SELECT 是早晚分叉的开始）。
 * `cm()` 把关：没填／非有限／≤0 一律当"没有这一格"。
 */
function loadMetricsMap() {
  const metrics = new Map()
  for (const m of db
    .prepare('SELECT user_id, height_cm, bust_cm, shoulder_width_cm FROM body_metrics')
    .all()) {
    metrics.set(m.user_id, {
      height: cm(m.height_cm),
      bust: cm(m.bust_cm),
      shoulder: cm(m.shoulder_width_cm),
    })
  }
  return metrics
}

/**
 * 读全表 + 体型档案，拼成这一层要用的样本（一次推荐只调一次，⛔ 不在逐条候选里查库）。
 * 表小（今天 0 行）所以整表读；将来大了再换按 item 的聚合查询，那是性能账不是正确性账。
 */
function loadSamples() {
  const rows = db
    .prepare(
      `SELECT actor_key, wardrobe_item_id, occasion, aesthetic_score, fit_score, user_id
         FROM item_feedback`,
    )
    .all()
  const metrics = loadMetricsMap()
  const out = []
  for (const r of rows) {
    const like = likeValue(r)
    if (like === null) continue
    // 归属优先用行里存的 user_id，退到 actor_key 的 `u` 前缀（同一把尺子的两个来源，⛔ 不再猜第三个）
    const uid = r.user_id != null ? r.user_id : actorUserId(r.actor_key)
    out.push({
      actor_key: r.actor_key,
      item_id: r.wardrobe_item_id,
      occasion: r.occasion || null,
      like,
      person: uid != null ? metrics.get(uid) || null : null,
    })
  }
  return out
}

/**
 * 🔴 2026-10-21 第十一阶段·第一步新增的第二路信号（`19` §六）：日记；
 * 🔴 2026-10-22 第十三阶段·第一步在这之后加的第三路（`21` §五）读的是**同一张日记表**。
 * 所以这一段的四个函数（`loadOutfitSamples`／`loadDiarySamples`／`buildDiarySignal`／`buildColorSignal`）
 * 共用一份底表，各说两句话：
 *  ·「和你体型相近的人，在这个温度档常穿哪一档厚薄」；
 *  ·「和你体型相近的人，常穿哪一族色」（这一句⛔ 不问天气，见下面 `buildColorSignal` 那段）。
 *
 * 与星级那一路的关系：同一道体型闸（`bodyDistance`/`DIST_MAX`/`MIN_COMPARABLE`）、
 * 同一套收缩（`K_PRIOR`）、同一个幅度与上下界（`AMP`/`FACTOR_MIN`/`FACTOR_MAX`），
 * 只有"比什么"不同——那一路比"这一件得几分"，后两路比"哪一档／哪一族穿得多"。
 */

/**
 * 这一套日记是在什么温度档下穿的：先认 `weather_level`（人自己选的那一档），
 * 没选再由 `feels_like_c` 折算（同一把 `levelFromFeelsLike` 尺子，⛔ 不在这里重切阈值）。
 * 两格都没有 ⇒ null——缺测不出档（硬规矩 2），这一套在"在这种天气下"那句话里没有主语，整条不进样本。
 */
function diaryLevelOf(row) {
  const s = asText(row.weather_level)
  if (WEATHER_LEVELS.includes(s)) return s
  return levelFromFeelsLike(row.feels_like_c)
}

/**
 * 读全库日记，折成"这一套＝（谁记的·什么场合·哪个温度档·穿了哪几档厚薄·穿了哪几族色）"。
 * 🔴 第十三阶段（`21` §五）：这份底表现在**两路共用**——日记那一路要"温度档＋厚薄"，
 * 色族那一路只要"色族"、⛔ 不看温度档，所以这里 `level` 允许是 null，温度闸留给各自的视图去关。
 *
 * ⚠️ `item_ids` 在这里**只用来取属性档**（这一套里有没有"厚"这一档、有没有"蓝"这一族），
 * ⛔ 绝不当成跨人可比的东西——两个人各有各的"蓝衬衫"（`19` §六 第 1 条 ＋ `21` §五 第 6 条）。
 * 与 `loadSamples()` 一样：整次推荐只读一次库，⛔ 不在逐条候选里查库。
 * @returns {Array<{actor_key:string,occasion:string|null,level:string|null,
 *          bands:string[],families:string[],person:object|null}>}
 */
function loadOutfitSamples() {
  const rows = db
    .prepare(
      `SELECT session_id, user_id, occasion, item_ids, feels_like_c, weather_level
         FROM wardrobe_outfits`,
    )
    .all()
  const parsed = []
  const idSet = new Set()
  for (const r of rows) {
    const ids = parseIdList(r.item_ids)
    if (ids.length === 0) continue
    parsed.push({ row: r, level: diaryLevelOf(r), ids })
    for (const id of ids) idSet.add(id)
  }
  if (parsed.length === 0) return []

  // 两路的属性档一次查完：`fabric_weight` 给日记那一路，`color`+`name` 给色族那一路。
  // ⛔ 分两次查同一张表＝同一份衣橱读两遍口径（查得到与否都会分叉）。
  const list = [...idSet]
  const bandById = new Map()
  const famById = new Map()
  for (const it of db
    .prepare(
      `SELECT id, fabric_weight, color, name FROM user_wardrobe WHERE id IN (${list.map(() => '?').join(', ')})`,
    )
    .all(...list)) {
    const v = asText(it.fabric_weight)
    bandById.set(it.id, FABRIC_WEIGHT_VALUES.includes(v) ? v : null)
    // 色族的读法与偏好层**同一把尺子**（`wearPreference.js:234`）：先试颜色栏、取不到才试件名。
    // 衣服后来被删了 ⇒ `famById.get(id)` 是 undefined ⇒ 这一票不补（缺测不出分）。
    famById.set(it.id, colorFamily(it.color) || colorFamily(it.name) || null)
  }

  const metrics = loadMetricsMap()
  const out = []
  for (const { row, level, ids } of parsed) {
    // 身份键与写入口、星级那一路同一把尺子（'u'+user_id 优先，退 's'+session_id）
    const actorKey = actorKeyOf({ sessionId: row.session_id, userId: row.user_id })
    if (!actorKey) continue // 两把键都没有 ⇒ 连"谁记的"都认不出，不进样本
    const bands = new Set()
    const families = new Set()
    for (const id of ids) {
      const b = bandById.get(id)
      if (b) bands.add(b) // 同一套里两件厚外套只算一票（这一路的分母是"几套"，不是"几件"）
      const f = famById.get(id)
      if (f) families.add(f) // 同一套里两件蓝上衣同样只算一票（与偏好层"一套里同一族只记一次"同口径）
    }
    // 两格都没取到（或衣服后来删了）⇒ 这一套对两路都是缺测，⛔ 不补票、不补"其他"
    if (bands.size === 0 && families.size === 0) continue
    out.push({
      actor_key: actorKey,
      occasion: asText(row.occasion) || null,
      level,
      bands: [...bands],
      families: [...families],
      // 体型只有按 user_id 才查得到 ⇒ 游客期的日记（只有 's' 键）天然进不了组（⑦ 那半边同一口径）
      person: row.user_id != null ? metrics.get(row.user_id) || null : null,
    })
  }
  return out
}

/**
 * 日记那一路（厚薄）用的那份视图：**温度档＋至少一个厚薄档**，缺一样这套就不进这一路的分母。
 * 🔴 第十三阶段把它降级成 `loadOutfitSamples()` 的一道闸＋一次投影，输出形状与改前**逐字相同**
 * （五个键、`bands` 是数组、`level` 是词表内的那个档），为的是 `19` §六 那几条老断言一个字不改也照样绿。
 * @returns {Array<{actor_key:string,occasion:string|null,level:string,bands:string[],person:object|null}>}
 */
function loadDiarySamples() {
  return loadOutfitSamples()
    .filter((s) => s.level && s.bands.length > 0)
    .map((s) => ({
      actor_key: s.actor_key,
      occasion: s.occasion,
      level: s.level,
      bands: s.bands,
      person: s.person,
    }))
}

/**
 * 组第二路信号：同组的人在**本次请求那个温度档**下常穿哪一档厚薄。
 *
 * 收缩式与星级同形（`19` §六 第 2 条）：`shrunk = (n·组内份额 + K_PRIOR·全局份额) / (n + K_PRIOR)`，
 * 只是 `n` 从"几条打分"换成"组内在这个温度档记过几套日记"，`SPAN` 从 4 星换成份额的满量程 1（定义，非手拍）。
 * 乘子仍 `clamp(1 + AMP·(shrunk − 全局份额)/SHARE_SPAN, FACTOR_MIN, FACTOR_MAX)`——
 * ⛔ 没有第二个 AMP、没有第二道上下界。
 *
 * @param {Array<object>|null} [outfits] 共用的那份日记底表；⛔ 传了就不再查一次库（引擎路径每次都传）
 * @returns {null|{attribute:string,temperature_level:string,occasion_used:string|null,
 *          cohort_people:number,cohort_diary_sets:number,pool_diary_sets:number,
 *          byBand:Map<string,object>,provenance:string}}
 *          本次没带天气档／这一档没有别人的日记／同组凑不满 `MIN_COHORT` 人 ⇒ null（这一路恰好 ×1）
 */
function buildDiarySignal(selfKey, person, level, occasion, outfits = null) {
  if (!level) return null // 没带天气档 ⇒ "在这种天气下"没有主语，整块缺席（⛔ 不猜一档）
  // `outfits` 是 `buildCohortModel` 现成的那份底表（整次推荐只读一次库）；单独调这一函数时自己现读。
  const withBand = outfits
    ? outfits.filter((s) => s.level && s.bands.length > 0)
    : loadDiarySamples()
  const others = withBand.filter((s) => s.actor_key !== selfKey && s.level === level)
  if (others.length === 0) return null

  // 场合这一刀与星级同形：凑得到同场合的日记就按场合说话，凑不到退回不限场合、话术跟着改口
  const occRows = occasion ? others.filter((o) => o.occasion === occasion) : []
  const pool = occRows.length > 0 ? occRows : others
  const occasionUsed = occRows.length > 0 ? occasion : null

  const similar = pool.filter((s) => {
    if (!s.person) return false // ⛔ 没体型档案不许当"距离 0"白送进组
    const d = bodyDistance(person, s.person)
    return d !== null && d <= COLLAB_CONFIG.DIST_MAX
  })
  const people = new Set(similar.map((s) => s.actor_key)).size
  if (people < COLLAB_CONFIG.MIN_COHORT) return null // 隐私与噪声共用那道闸（`17` §4.2/§4.4）

  const n = similar.length
  const globalN = pool.length
  const byBand = new Map()
  for (const band of FABRIC_WEIGHT_VALUES) {
    const k = similar.reduce((a, s) => a + (s.bands.includes(band) ? 1 : 0), 0)
    const gk = pool.reduce((a, s) => a + (s.bands.includes(band) ? 1 : 0), 0)
    const { mean, globalShare, shrunk, factor } = shrinkShare(k, n, gk, globalN)
    byBand.set(band, {
      n,
      sets_with_band: k,
      people,
      share: Math.round(mean * 1000) / 1000,
      global_share: Math.round(globalShare * 1000) / 1000,
      shrunk: Math.round(shrunk * 1000) / 1000,
      factor: Math.round(factor * 1000) / 1000,
      // 出账那句人话：只许出现人数与套数（`19` §九 隐私口径），⛔ 不带日记人／门店／时间戳
      basis: `和你体型相近的人在这个温度档记了 ${n} 套，其中 ${k} 套穿了${band}（同组 ${people} 人${
        occasionUsed ? `·${occasionUsed}` : '·不分场合'
      }）`,
    })
  }

  return {
    attribute: COLLAB_CONFIG.DIARY_ATTRIBUTE,
    temperature_level: level,
    occasion_requested: occasion || null,
    occasion_used: occasionUsed,
    cohort_people: people,
    cohort_diary_sets: n,
    pool_diary_sets: globalN,
    byBand,
    provenance: `同组 ${people} 人 · ${level} 这一档有 ${n} 套日记（不分体型时 ${globalN} 套）`,
  }
}

/**
 * 组第三路信号（`21` §五）：同组的人**常穿哪一族色**。
 *
 * 与第二路只有三点不同，其余全部同形（同一道体型闸、同一套收缩 `shrinkShare`、同一道界）：
 *  · ⛔ 不看温度档——`21` §五 点名复用的是那四个数（`DIST_MAX`/`K_PRIOR`/`MIN_COHORT`/那道界），
 *    温度闸不在点名的范围里，所以"这一屏没带天气"时这一路照样能说话。🔴 这是本轮唯一的既有行为变更，
 *    逐字写在文件头；`19` 时代那三条"没带档就整层 null"的老断言靠把 fixture 的色族那一格也留空来保住原意，
 *    这一路自己的在场／隐身由新增的 ⑲~㉒ 钉。
 *  · 只给**这一池里真出现过的色族**建账：谁都没穿过的族，组内份额与全局份额都是 0 ⇒ 乘子本来就是恰好 1，
 *    而 `colorFamily` 能回的词没有导出词表可枚举 ⇒ ⛔ 不为了"看起来三档齐全"抄第二份族表。
 *    全局出现过、组内没出现过的族照旧建账（`k=0` ⇒ 压），那才是这一路真正能说话的方向。
 *  · 比的是**色族份额**，⛔ 永远不比"是不是同一件"（跨人唯一的同款钥匙 `sku` 全库 0 行非空）。
 *
 * @param {Array<object>|null} [outfits] 共用的那份日记底表（同 `buildDiarySignal`，⛔ 不重复查库）
 * @returns {null|{attribute:string,occasion_used:string|null,cohort_people:number,
 *          cohort_diary_sets:number,pool_diary_sets:number,
 *          byFamily:Map<string,object>,provenance:string}}
 *          库里没有别人的日记／别人的衣橱里一格色都取不到／同组凑不满 `MIN_COHORT` 人 ⇒ null（这一路恰好 ×1）
 */
function buildColorSignal(selfKey, person, occasion, outfits = null) {
  const src = outfits || loadOutfitSamples()
  const others = src.filter((s) => s.actor_key !== selfKey && s.families.length > 0)
  if (others.length === 0) return null

  // 场合这一刀与前两路同形：凑得到同场合的日记就按场合说话，凑不到退回不限场合、话术跟着改口
  const occRows = occasion ? others.filter((o) => o.occasion === occasion) : []
  const pool = occRows.length > 0 ? occRows : others
  const occasionUsed = occRows.length > 0 ? occasion : null

  const similar = pool.filter((s) => {
    if (!s.person) return false // ⛔ 没体型档案不许当"距离 0"白送进组
    const d = bodyDistance(person, s.person)
    return d !== null && d <= COLLAB_CONFIG.DIST_MAX
  })
  const people = new Set(similar.map((s) => s.actor_key)).size
  if (people < COLLAB_CONFIG.MIN_COHORT) return null // 与前两路共用那一道隐私闸（数**人**，不数套）

  const n = similar.length
  const globalN = pool.length
  const observed = new Set()
  for (const s of pool) for (const f of s.families) observed.add(f)

  const byFamily = new Map()
  for (const fam of [...observed].sort((a, b) => String(a).localeCompare(String(b)))) {
    const k = similar.reduce((a, s) => a + (s.families.includes(fam) ? 1 : 0), 0)
    const gk = pool.reduce((a, s) => a + (s.families.includes(fam) ? 1 : 0), 0)
    const { mean, globalShare, shrunk, factor } = shrinkShare(k, n, gk, globalN)
    byFamily.set(fam, {
      n,
      sets_with_family: k,
      people,
      share: Math.round(mean * 1000) / 1000,
      global_share: Math.round(globalShare * 1000) / 1000,
      shrunk: Math.round(shrunk * 1000) / 1000,
      factor: Math.round(factor * 1000) / 1000,
      // 出账那句人话：只许出现人数与套数（`19` §九 隐私口径），⛔ 不带日记人／姓名／门店／时间戳
      basis: `和你体型相近的人记了 ${n} 套，其中 ${k} 套穿${fam}这一族（同组 ${people} 人${
        occasionUsed ? `·${occasionUsed}` : '·不分场合'
      }）`,
    })
  }

  return {
    attribute: COLLAB_CONFIG.COLOR_ATTRIBUTE,
    occasion_requested: occasion || null,
    occasion_used: occasionUsed,
    cohort_people: people,
    cohort_diary_sets: n,
    pool_diary_sets: globalN,
    byFamily,
    provenance: `同组 ${people} 人的 ${n} 套日记里数得出 ${byFamily.size} 个色族（不分体型时 ${globalN} 套）`,
  }
}

/**
 * 组一次这个人的 cohort 模型（整次推荐只算一次，逐条候选只查 `byItem`／`diary.byBand`／`color.byFamily`）。
 *
 * @param {{sessionId?:string|null,userId?:number|null}} identity 本次身份（与写入口同一把 actorKeyOf）
 * @param {{height:?number,bust:?number,shoulder:?number}} person 这个人的体型向量
 *        （读 `bodyDeviation().person_cm`：实测优先、缺格由第五阶段的估算顶上，出处在 person_cm_src 里）
 * @param {string|null} [occasion] 本次场合；⛔ 场合只是**加分过滤**，退回不限场合时话术跟着改口
 * @param {string|null} [weatherLevel] 🔴 本次请求带来的温度档（`19` §六）；
 *        归一后没带 ⇒ 只有第二路整块缺席（⛔ 系统绝不替用户猜档），第一、三路不受影响
 * @returns {null|{cohort_size:number,global_mean:number|null,byItem:Map,diary:object|null,
 *          color:object|null,self_key:string,occasion_used:string|null,
 *          temperature_level:string|null,provenance:string}}
 *          没身份／没体型／这一层被开关关掉／三路都没有样本 ⇒ null（调用方按"完全不参与"处理）
 */
function buildCohortModel(identity, person, occasion = null, weatherLevel = null) {
  if (!COLLAB_CONFIG.enabled) return null
  const selfKey = actorKeyOf(identity || {})
  if (!selfKey) return null
  if (!person || person.height == null) return null // `17` §4.1：连身高都没有 ⇒ 不组 cohort
  const lvl = asText(weatherLevel)
  const level = WEATHER_LEVELS.includes(lvl) ? lvl : null

  // ⛔ 自己的分不进信号：反馈回路（我打的高分把我自己的推荐再抬上去）是这一类系统最常见的自我强化，
  //    这里从源头断掉——同组只算"其他 actor_key"（§4.1 逐字写着"同 cohort 其他 actor_key"）。
  const others = loadSamples().filter((s) => s.actor_key !== selfKey)
  const globalMean =
    others.length > 0 ? others.reduce((s, o) => s + o.like, 0) / others.length : null

  // 场合这一刀：凑得到同场合的分就按场合说话，凑不到就退回不限场合，⛔ 但话术必须跟着改口
  // （对外不许出现"在这个场合"这种它其实没做到的限定）。
  const occRows =
    globalMean === null || !occasion ? [] : others.filter((o) => o.occasion === occasion)
  const pool = occRows.length > 0 ? occRows : others
  const occasionUsed = occRows.length > 0 ? occasion : null

  const similar = []
  if (globalMean !== null) {
    for (const o of pool) {
      if (!o.person) continue // 没有体型档案的人进不了组：⛔ 不许当成"距离 0"白送
      const d = bodyDistance(person, o.person)
      if (d !== null && d <= COLLAB_CONFIG.DIST_MAX) similar.push({ ...o, dist: d })
    }
  }

  const cohortSize = new Set(similar.map((s) => s.actor_key)).size
  const byItem = new Map()
  if (cohortSize >= COLLAB_CONFIG.MIN_COHORT) {
    const groups = new Map()
    for (const s of similar) {
      if (!groups.has(s.item_id)) groups.set(s.item_id, [])
      groups.get(s.item_id).push(s)
    }
    for (const [itemId, list] of groups) {
      const n = list.length
      const mean = list.reduce((a, s) => a + s.like, 0) / n
      const K = COLLAB_CONFIG.K_PRIOR
      const shrunk = (n * mean + K * globalMean) / (n + K)
      const factor = clamp(
        1 + COLLAB_CONFIG.AMP * ((shrunk - globalMean) / COLLAB_CONFIG.STAR_SPAN),
        COLLAB_CONFIG.FACTOR_MIN,
        COLLAB_CONFIG.FACTOR_MAX,
      )
      byItem.set(itemId, {
        n,
        people: new Set(list.map((s) => s.actor_key)).size,
        mean: Math.round(mean * 100) / 100,
        shrunk: Math.round(shrunk * 100) / 100,
        factor: Math.round(factor * 1000) / 1000,
        // 出账那句人话：只许出现人数与均值（`17` §4.4 的隐私口径），⛔ 不带任何可反推的字段
        basis: `和你体型相近的人给这件打 ${Math.round(mean * 10) / 10} 星（同组 ${
          new Set(list.map((s) => s.actor_key)).size
        } 人${occasionUsed ? `·${occasionUsed}` : '·不分场合'}）`,
      })
    }
  }

  // 第二、三路（都读同一张日记表，⛔ 各查一遍库）。⚠️ 它们**不看第一路的脸色**：库里 `item_feedback` 0 行、
  // 但日记有货时，这两路照样该说话——那是第十一阶段与第十三阶段各自要的效果。
  const outfits = loadOutfitSamples()
  const diary = buildDiarySignal(selfKey, person, level, occasion, outfits)
  // 🔴 第三路不看温度档（`21` §五 只复用那四个数，温度闸不在点名的范围里）：
  // 所以 `level === null` 时它照样可能出账——这一条是本轮唯一的既有行为变更，逐字写在文件头。
  const color = buildColorSignal(selfKey, person, occasion, outfits)
  // 三路都没有可说的 ⇒ 回到改前的"模型 null"（① 那条断言钉的就是这个形状）
  if (globalMean === null && diary === null && color === null) return null

  const starProvenance =
    globalMean === null
      ? '库里没有别人的打分 ⇒ 星级这一路不出话术、乘子恒为 1'
      : cohortSize < COLLAB_CONFIG.MIN_COHORT
        ? `同组只有 ${cohortSize} 人（不足 ${COLLAB_CONFIG.MIN_COHORT} 人）⇒ 不出话术、乘子恒为 1`
        : byItem.size === 0
          ? `同组 ${cohortSize} 人，但他们没评过这一屏里的任何一件 ⇒ 乘子恒为 1`
          : `同组 ${cohortSize} 人（体型距离 ≤ ${COLLAB_CONFIG.DIST_MAX}）· 全局均值 ${
              Math.round(globalMean * 10) / 10
            } 星`

  const roadNotes = [starProvenance]
  if (diary) roadNotes.push(`日记这一路：${diary.provenance}`)
  if (color) roadNotes.push(`色族这一路：${color.provenance}`)

  return {
    self_key: selfKey,
    cohort_size: cohortSize,
    global_mean: globalMean === null ? null : Math.round(globalMean * 100) / 100,
    occasion_requested: occasion || null,
    occasion_used: occasionUsed,
    byItem,
    temperature_level: level,
    diary,
    color,
    provenance: roadNotes.join(' ｜ '),
  }
}

/**
 * 这一条候选的协同过滤乘子（与偏好乘子同层出账）。
 *
 * 🔴 三路合成（`19` §六 第 3 条 ＋ `21` §五 第 4 条）：星级 factor × 日记 factor × 色族 factor，
 * **乘完再夹紧一次**。不是把几个信号加权成中间值——那是"平均掉互相反对的结论"。
 * 任一路样本不足 ⇒ 那一路恰好 1，其余各路照常说话；三路都满格时也只会到 `[0.95,1.05]` 这一道界
 * （⛔ 界不会因为多了一路就变宽，也⛔ 不许每路各夹一次——那等于把界悄悄放宽到 1.05³）。
 *
 * @param {object} cand 穿搭条目（只有 `source:'wardrobe'` 那几条带 `wardrobe_item_id` 与厚薄那一格）
 * @param {object|null} model `buildCohortModel` 出的那份；null ⇒ 这一层完全不参与
 * @returns {{factor:number, basis:string|null, cohort_size:number|null, n:number,
 *            star_factor:number, diary_factor:number, diary_sets:number, diary_band:string|null,
 *            color_family_factor:number, color_family_sets:number, color_family_band:string|null}}
 */
function collabFactor(cand, model) {
  const off = {
    factor: 1,
    basis: null,
    cohort_size: null,
    n: 0,
    star_factor: 1,
    diary_factor: 1,
    diary_sets: 0,
    diary_band: null,
    color_family_factor: 1,
    color_family_sets: 0,
    color_family_band: null,
  }
  if (!model) return off

  // 第一路：星级（键＝这一件）
  let starFactor = 1
  let starBasis = null
  let starN = 0
  const itemId = cand && cand.wardrobe_item_id
  const hasItem = itemId !== null && itemId !== undefined // 规则命中的那一路没有"这一件"，进不了这张表
  if (hasItem && model.byItem && model.byItem.size > 0) {
    const hit = model.byItem.get(itemId)
    if (hit) {
      starFactor = hit.factor
      starBasis = hit.basis
      starN = hit.n
    }
  }

  // 第二路：日记属性档（键＝这一档厚薄；⛔ 永远不比"是不是同一件"）。
  let diaryFactor = 1
  let diaryBasis = null
  let diarySets = 0
  // ⚠️ 轴名 `'warmth'` 是偏好层给 `DIARY_ATTRIBUTE`（=`fabric_weight`）这一格起的名字，
  // 两路读同一格走同一个读法（它认 `fabric_weight` 与 `body_fit.top.fabric_weight` 两个来源），
  // ⛔ 不在这里再写一份取格逻辑。
  const band = model.diary ? candAxisValue(cand, 'warmth') : null
  const diaryHit = model.diary && band ? model.diary.byBand.get(band) : null
  if (model.diary && band && diaryHit) {
    diaryFactor = diaryHit.factor
    diaryBasis = diaryHit.basis
    diarySets = model.diary.cohort_diary_sets
  }

  // 🔴 第三路：同组人的色族分布（键＝这一条候选的色族；⛔ 同样不比"是不是同一件"）。
  // 轴名用 `COLLAB_CONFIG.COLOR_ATTRIBUTE` 指向的那个 `'color_family'`（偏好层四轴之一），
  // 取格也共用 `candAxisValue`（它认 `color_text`→`outfit_top`→`top_style` 那一条链），
  // ⛔ 不在这里再写一份"候选身上哪一格算色"的逻辑——两层读同一格，读法分叉就是两个乘子建在不同口径上。
  let colorFactor = 1
  let colorBasis = null
  let colorSets = 0
  const family = model.color ? candAxisValue(cand, COLLAB_CONFIG.COLOR_ATTRIBUTE) : null
  const colorHit = model.color && family ? model.color.byFamily.get(family) : null
  if (colorHit) {
    colorFactor = colorHit.factor
    colorBasis = colorHit.basis
    colorSets = model.color.cohort_diary_sets
  }

  // 三路都没话要说（这件既不在星级表里、也没有可比的那一档厚薄、更没有可比的那一族色）⇒ 回到缺席形状。
  // ⚠️ 注意与下一段的分工：**乘子恰好 1 但话要说**（例如全组只评过这一件 ⇒ 组内均值＝全局均值）
  // 仍然要出 basis——那是 `17` 时代就钉住的行为（⑥ 那条断言），不许借着"合成"把它改成静默。
  if (!starBasis && !diaryBasis && !colorBasis) {
    return { ...off, cohort_size: hasItem ? model.cohort_size : null, n: starN }
  }
  const clamped = clamp(
    starFactor * diaryFactor * colorFactor,
    COLLAB_CONFIG.FACTOR_MIN,
    COLLAB_CONFIG.FACTOR_MAX,
  )
  return {
    factor: Math.round(clamped * 1000) / 1000,
    basis: [starBasis, diaryBasis, colorBasis].filter(Boolean).join('；') || null,
    cohort_size: model.cohort_size,
    n: starN,
    star_factor: starFactor,
    diary_factor: diaryFactor,
    diary_sets: diarySets,
    diary_band: band,
    color_family_factor: colorFactor,
    color_family_sets: colorSets,
    color_family_band: family,
  }
}

module.exports = {
  COLLAB_CONFIG,
  bodyDistance,
  likeValue,
  actorUserId,
  // 🔴 第十一阶段第二路、第十三阶段第三路信号（`19` §六、`21` §五）：这几个导出来是给单测
  // 直接盯形状用的，引擎侧只调 `buildCohortModel`/`collabFactor` 那两个入口。
  diaryLevelOf,
  loadOutfitSamples,
  loadDiarySamples,
  buildDiarySignal,
  buildColorSignal,
  buildCohortModel,
  collabFactor,
}
