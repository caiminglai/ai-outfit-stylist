/**
 * 隐性偏好画像层（2026-10-20 第八阶段·第一步 一e 建档，2026-10-21 第十一阶段·第一步 扩到四轴）
 * 规范出处：`docs/依据/16-数据采集输入输出规范-20261020.md` §五（建档）
 *        ＋ `docs/依据/19-穿搭日记与天气输入输出规范-20261021.md` §五（本轮：温度档厚薄／复穿次数／场合升档）。
 *
 * 这一层只干一件事：**把这个人自己记下的穿搭日记（含那天的天气），折成一个 ±5% 以内的乘性顺位微调**。
 * 原料全部来自第一手采集（`wardrobe_outfits` ＋ `feedback_events` 两把星 ＋ `user_wardrobe`），
 * 不引入任何外部数据、不猜、不训练。
 *
 * ── 为什么它是乘性且有界 ─────────────────────────────────────────────
 * 第四阶段定的三路权重（0.1/0.45/0.45）与色彩/廓形两维的 0~100 真分是这套排序的**主**。
 * 偏好要做的是"两个真分打平时，把你自己常穿的那一族稍微排前一点"，不是"再判一次好坏"。
 * 加法会把 ±0.05 这种量级的东西搅进 0~100 的分里（既看不出来源也没法解释），
 * 所以这里只在 `rankDims` 出完总分之后**乘一个界内的乘子**，与 `factor`（覆盖率折扣）、
 * `algo_penalty`（算法缺席惩罚）同层出账，审计串里能拆账。
 *
 * ── 三条不退让的口径 ───────────────────────────────────────────────
 * ① **缺测不出分**（硬规矩 2 在采数层的落地）：某一维样本 < `MIN_SAMPLES` ⇒ 这一维整块缺席，
 *    不参与乘子（不是"按 0 计"，0 会把它推成"最不偏好"，那是造假）。
 * ② **零样本零影响**：没日记、没星 ⇒ `factor` 必须恒等于 1，且 Top 8 改前改后**逐条相同**。
 *    这条是本轮唯一能自证安全的断言，写在 `test/wearPreference.test.js`。
 * ③ **出账带 basis**：乘子必须能回指"是哪几行算出来的"，报告里要说人话，不许只给一个数。
 *
 * ⛔ 措辞红线（对外文案照抄，不许加工）：这一层不是"机器学习"，也不许写"AI 学会了你"。
 * 只能说：**按你自己记下的搭配和那天的天气，把常穿的那一档稍微排前一点。**
 * `MIN_SAMPLES=3`、`0.95~1.05`、`+2%/0/−1%`、`REPS_STEP/REPS_MAX` 这四个幅度全是 C 档手拍值（标定中，未回归）。
 */
const db = require('../db/init')
const { colorFamily } = require('./colorMetrics')
const { FIT_TYPE_VALUES, FABRIC_WEIGHT_VALUES } = require('./topFitBody')
const { asText, parseIdList } = require('../utils/common')
// 词表唯一真相源（`19` §三 第 1 条）：⛔ 不许在这一层再抄一份五档阈值。
// weatherService 只 require utils/common，不碰库 ⇒ 这一条 import 不会把 db 拖进热路径。
const { WEATHER_LEVELS, levelFromFeelsLike } = require('./weatherService')

/**
 * 一个维度至少要几条样本才允许开口（C 档手拍，先拍严）。
 * 为什么是 3 不是 1：1 条就是"上次穿了件蓝衬衫"，那不是偏好那是巧合；
 * 为什么不是 10：日记现在 0 行，拍到 10 等于这层永远不生效，白写。
 */
const MIN_SAMPLES = 3

/** 乘子上下界（C 档手拍）：满打满算只能把一条推荐抬/压 5%，盖不过色彩与廓形的真分 */
const FACTOR_MIN = 0.95
const FACTOR_MAX = 1.05

/** 单条轴的幅度：命中"你最常穿的那一档"给 +2%，落在"你穿过的其他档"给 0，从没穿过给 −1% */
const LIFT_TOP = 0.02
const LIFT_SEEN = 0
const LIFT_UNSEEN = -0.01

/**
 * 参与乘子的轴（候选身上**取得到值**的才许进这一列，见下面 `AXES` 那条注释）。
 * 🔴 2026-10-21 第十一阶段·第一步从两轴升到四轴（`docs/依据/19` §五）：
 * 加 `warmth`（温度档→厚薄）与 `occasion`（场合），`reps`（复穿次数）单独走
 * `pref.item_reps` 那条特判（它比的是"这一件"，不是"哪一档"，塞不进同一个循环）。
 */
const MULTIPLIER_AXES = ['color_family', 'fit_type', 'occasion', 'warmth']

/**
 * 复穿次数的幅度（C 档手拍，标定中，对外⛔ 不许称"科学/量化"）：
 * `lift = min(REPS_MAX, REPS_STEP × ln(1+n))`。为什么取 ln——记 40 次的那件不该把总分掀翻，
 * 这层满打满算只能动 ±5%，超过 `REPS_MAX` 就封顶。⛔ 只加不减：
 * "没记进过日记"不等于不喜欢（也许只是这周没穿），那一维已经由 `LIFT_UNSEEN` 在族级别付过账了。
 */
const REPS_STEP = 0.006
const REPS_MAX = 0.03

/**
 * 出账的七个维度（`19` §五；第八阶段建的是前五个，本轮加 `warmth` 与 `reps`）。
 * ⚠️ 下面这段是 10-20 建档时的原话，**前提已在 10-21 被现量推翻**（`19` §十 订正第 1 条）：
 * 当时量到 `grep -n occasion services/recommendEngine.js` 回 0 处、并据此断言"候选身上只有色族与
 * 版型这两格取得到值"。今天同一把尺子回 **3 处**，而唯一投影 `utils/common.js:358-376`
 * 一直带着 `fabric_weight`/`occasion_tags`。⇒ `occasion` 与厚薄这一维**从本轮起进乘子**；
 * `season` 仍只出账——不是取不到值，是 `rule_conditions` 里那一维的词形没归一
 * （现量 10-21：`{"season": "春"}` 与 `"夏"` 两种写法混存，`19` §三 第 7 条），
 * 拿一个词形混乱的列去乘分＝把脏数据洗成"看起来有依据"。星级那一维照旧不进乘子：
 * 它量的是"这个人打分的手松还是手紧"，不是"这件该不该排前"，乘上去是两层搅一起。
 */
const AXES = [
  { key: 'color_family', name_cn: '色族偏爱', multiplier: true },
  { key: 'fit_type', name_cn: '版型档', multiplier: true },
  // 🔴 10-21 第十一阶段·第一步：`occasion` 从"只出账"升为进乘子（前提见上面那段订正）
  { key: 'occasion', name_cn: '场合覆盖', multiplier: true },
  { key: 'season', name_cn: '季节', multiplier: false },
  { key: 'rating', name_cn: '星级均值', multiplier: false },
  // 本轮新增两轴。`warmth` 走通用循环（比的是"档"）；`reps` 比的是"这一件"，
  // 在 `preferenceFactor` 里单独一支（没进 `MULTIPLIER_AXES` 那份通用循环的名单）。
  // ⚠️ `warmth` 带两格它自己的口径（`19` §五 第 1 条）：
  //  · `lift_unseen: 0`——"你在这个温度档没穿过这一档厚薄"**不扣分**。色族那 −1% 讲的是
  //    "整本日记里没这个色系"，而厚薄在单档下只有几票；拿样本最小的那一轴去罚候选，
  //    等于把最薄的一格变成最狠的一格。
  //  · `share_label`——这一轴的 `share` 分母是"该温度档内的票数"，不是"日记条数"，
  //    出账那句话必须跟着改口，否则读报告的人以为在看全本来占比。
  { key: 'warmth', name_cn: '温度档厚薄', multiplier: true, lift_unseen: 0, share_label: '占本档' },
  { key: 'reps', name_cn: '复穿次数', multiplier: true },
]

// `item_ids` 这一列的解析口径在 `utils/common.js` 的 `parseIdList`（唯一真相源）。
// 🔴 10-21 第十一阶段：协同过滤那一层读的是**同一列**，原来这里私有一份 `parseIds`，
// 两份各写各的早晚分叉（一处丢脏元素、一处不丢），已经合并掉、下面的调用点全部改成 `parseIdList`。
const bump = (map, key, n = 1) => {
  if (!key) return
  map[key] = (map[key] || 0) + n
}

/** 计数表 → 维度出账：value 取占比最高的那一档（并列取词面小的，保证可重复） */
function dimFromCounts(meta, counts, samples, basisParts) {
  const keys = Object.keys(counts)
  const total = keys.reduce((s, k) => s + counts[k], 0)
  const top =
    keys.slice().sort((a, b) => counts[b] - counts[a] || String(a).localeCompare(String(b)))[0] ||
    null
  return {
    key: meta.key,
    name_cn: meta.name_cn,
    value: total > 0 ? top : null,
    share: top && total > 0 ? Math.round((counts[top] / total) * 100) / 100 : null,
    counts,
    samples,
    in_multiplier: meta.multiplier,
    // 逐轴的幅度口径（`19` §五 第 1 条）：不给就是通用档（未穿过 = LIFT_UNSEEN）
    lift_unseen: meta.lift_unseen,
    share_label: meta.share_label || '占日记',
    basis: basisParts || '',
  }
}

/**
 * 把"本次请求带来的天气档"归一到那五个词（`19` §五 第 1 条）。
 * 表外值一律当没带（⛔ 不许现推：请求里没有体感温度，推出来的是猜的），
 * 这一轴整块缺席 ⇒ 乘子恰好不受它影响。
 */
function normalizeWeatherLevel(raw) {
  const s = asText(raw)
  return WEATHER_LEVELS.includes(s) ? s : null
}

/**
 * 按人现算偏好画像。
 * @param {{sessionId?:string|null, userId?:number|null}} who 两条身份任一即可（日记本来就是并集口径）
 * @param {string|null} [weatherLevel] 本次推荐请求带来的天气档（`19` §五 第 1 条：只有带着它，
 *   `warmth` 这一轴才可能生效；表外值当没带，⛔ 不猜）
 * @returns {{dims:object[], factor_ready:boolean, samples:number, provenance:string,
 *   weather_level_used:string|null, item_reps:Map<number,number>, reps:{counted_items:number,max_reps:number}}}
 */
function buildPreference(who, weatherLevel = null) {
  const level = normalizeWeatherLevel(weatherLevel)
  const blank = (a) => ({
    key: a.key,
    name_cn: a.name_cn,
    value: null,
    share: null,
    counts: {},
    samples: 0,
    in_multiplier: a.multiplier,
    lift_unseen: a.lift_unseen,
    share_label: a.share_label || '占日记',
    basis: '',
  })
  // `who` 传 null 是合法调用（路由那边 `(getCurrentUser(req) || {}).id` 拼出来可能就是 null）：
  // 默认参数只对 undefined 生效，不挡这一层就是 `Cannot read properties of null` 一条 500。
  const id = who || {}
  const sessionId = typeof id.sessionId === 'string' ? id.sessionId.trim() : null
  const userId = Number.isInteger(id.userId) && id.userId > 0 ? id.userId : null
  const empty = {
    dims: AXES.map(blank),
    factor_ready: false,
    samples: 0,
    weather_level_used: null,
    item_reps: new Map(),
    reps: { counted_items: 0, max_reps: 0 },
    provenance: '没有身份（既没有 session 也没有 user）⇒ 不读任何行，乘子恒为 1',
  }
  if (!sessionId && !userId) return empty

  const conds = []
  const params = []
  if (sessionId) {
    conds.push('session_id = ?')
    params.push(sessionId)
  }
  if (userId) {
    conds.push('user_id = ?')
    params.push(userId)
  }
  const outfits = db
    .prepare(`SELECT * FROM wardrobe_outfits WHERE ${conds.join(' OR ')}`)
    .all(...params)

  // 日记里引用到的衣物行**一次查完**再按 id 建索引：原来在循环里逐条 prepare 会 N+1，
  // 而推荐是热路径（每个顾客每次出报告都要走一遍排序）。
  const idSet = new Set()
  for (const o of outfits) for (const id of parseIdList(o.item_ids)) idSet.add(id)
  let itemRows = []
  if (idSet.size > 0) {
    const ids = [...idSet]
    itemRows = db
      .prepare(
        `SELECT id, name, color, fit_type, fabric_weight FROM user_wardrobe
          WHERE id IN (${ids.map(() => '?').join(', ')})`,
      )
      .all(...ids)
  }
  const itemById = new Map(itemRows.map((r) => [r.id, r]))

  const colorCounts = {}
  const fitCounts = {}
  const occCounts = {}
  const seasonCounts = {}
  const ratings = []
  // 🔴 本轮两条新账（`19` §五）：
  //  · `warmthByLevel`——「这个温度档下你翻出来穿的是哪一档厚薄」。整表都建（出账要能给全部五档），
  //    但只有**本次请求那一档**进乘子（`level` 为 null 时这一轴整块缺席）。
  //  · `itemReps`——「这件衣服你自己记进了几套日记」。行为账，比星硬。
  const warmthByLevel = new Map()
  const itemReps = new Map()
  for (const o of outfits) {
    if (o.occasion) bump(occCounts, asText(o.occasion))
    if (o.season) bump(seasonCounts, asText(o.season))
    if (Number.isInteger(o.rating) && o.rating >= 1 && o.rating <= 5) ratings.push(o.rating)
    // 一套里同一族只记一次：一套穿搭不该因为"上下装都是蓝色"就被数成两票
    const fams = new Set()
    const fits = new Set()
    const weights = new Set()
    const counted = new Set()
    for (const id of parseIdList(o.item_ids)) {
      const it = itemById.get(id)
      if (!it) continue // 衣服后来被删了 ⇒ 这一票不补（缺测不出分）
      if (!counted.has(id)) {
        counted.add(id)
        itemReps.set(id, (itemReps.get(id) || 0) + 1)
      }
      const fam = colorFamily(it.color) || colorFamily(it.name)
      if (fam) fams.add(fam)
      const ft = asText(it.fit_type)
      if (FIT_TYPE_VALUES.includes(ft)) fits.add(ft)
      const fw = asText(it.fabric_weight)
      if (FABRIC_WEIGHT_VALUES.includes(fw)) weights.add(fw)
    }
    for (const f of fams) bump(colorCounts, f)
    for (const f of fits) bump(fitCounts, f)
    // 这一行的天气档：存了档就读档，只存了体感温度就现推（`19` §三 第 6 条：
    // 温度是事实、档是解释 ⇒ 读取侧一律以 `feels_like_c` 现推为准的口径在这里体现为"两格都空才缺席"）
    const oLevel = WEATHER_LEVELS.includes(asText(o.weather_level))
      ? asText(o.weather_level)
      : levelFromFeelsLike(o.feels_like_c)
    // 既没有档、这一套又没取到任何厚薄 ⇒ 这一行不进这一轴（⛔ 不补 0 票、不补"常温"）
    if (!oLevel || weights.size === 0) continue
    if (!warmthByLevel.has(oLevel)) warmthByLevel.set(oLevel, {})
    const band = warmthByLevel.get(oLevel)
    for (const w of weights) bump(band, w)
  }

  // 星级那一维把推荐卡上的两把星一起收进来（同一把尺子：1~5，null 不计）
  let aesthetic = null
  let fit = null
  if (userId) {
    const srow = db
      .prepare(
        `SELECT AVG(aesthetic_score) AS a, AVG(fit_score) AS f,
                COUNT(aesthetic_score) AS na, COUNT(fit_score) AS nf
           FROM feedback_events WHERE user_id = ?`,
      )
      .get(userId)
    if (srow && srow.na > 0) aesthetic = { avg: Math.round(srow.a * 100) / 100, samples: srow.na }
    if (srow && srow.nf > 0) fit = { avg: Math.round(srow.f * 100) / 100, samples: srow.nf }
  }
  const ratingAvg = ratings.length
    ? Math.round((ratings.reduce((s, x) => s + x, 0) / ratings.length) * 100) / 100
    : null

  // `warmth` 这一轴只看**本次请求那一档**：整表出账进 basis，乘子只吃这一档（`19` §五 第 1 条）。
  // samples 用"该档票数"而不是"该档套数"——闸门原文量的是"这一档计数 < MIN_SAMPLES"，
  // 拿套数当分母会让"一套里薄厚都有"多算一票，两个口径哪个更严不好说，所以写清楚用的是哪个。
  const warmthCounts = level ? warmthByLevel.get(level) || {} : {}
  const warmthVotes = Object.keys(warmthCounts).reduce((s, k) => s + warmthCounts[k], 0)
  /** 档内按词表顺序（薄→中→厚）列，⛔ 不按插入顺序：出账那串要能逐字比差分 */
  const bandLine = (lv) => {
    const band = warmthByLevel.get(lv)
    if (!band || Object.keys(band).length === 0) return null
    return `${lv}：${FABRIC_WEIGHT_VALUES.filter((w) => band[w])
      .map((w) => `${w}×${band[w]}`)
      .join('、')}`
  }
  const warmthBasis = WEATHER_LEVELS.map(bandLine).filter(Boolean).join('；')

  // 复穿这一轴的账：记了几件、最多的一件记了几次（⛔ 只加不减，见 `REPS_STEP` 那段注释）
  const repValues = [...itemReps.values()]
  const maxReps = repValues.length ? Math.max(...repValues) : 0

  const dims = [
    dimFromCounts(
      AXES[0],
      colorCounts,
      outfits.length,
      Object.keys(colorCounts)
        .map((k) => `${k}×${colorCounts[k]}`)
        .join('、'),
    ),
    dimFromCounts(
      AXES[1],
      fitCounts,
      outfits.length,
      Object.keys(fitCounts)
        .map((k) => `${k}×${fitCounts[k]}`)
        .join('、'),
    ),
    dimFromCounts(
      AXES[2],
      occCounts,
      outfits.length,
      Object.keys(occCounts)
        .map((k) => `${k}×${occCounts[k]}`)
        .join('、'),
    ),
    dimFromCounts(
      AXES[3],
      seasonCounts,
      outfits.length,
      Object.keys(seasonCounts)
        .map((k) => `${k}×${seasonCounts[k]}`)
        .join('、'),
    ),
    {
      key: 'rating',
      name_cn: '星级均值',
      value: ratingAvg,
      share: null,
      counts: { diary: ratingAvg, aesthetic: aesthetic && aesthetic.avg, fit: fit && fit.avg },
      samples: ratings.length + (aesthetic ? aesthetic.samples : 0) + (fit ? fit.samples : 0),
      in_multiplier: false,
      basis:
        `日记 ${ratings.length} 条${ratingAvg ? `，均值 ${ratingAvg}` : ''}；` +
        `推荐卡审美 ${aesthetic ? `${aesthetic.avg}（${aesthetic.samples} 条）` : '无'}、` +
        `合身 ${fit ? `${fit.avg}（${fit.samples} 条）` : '无'}`,
    },
    // —— 本轮新增两轴（`19` §五）——
    dimFromCounts(AXES[5], warmthCounts, warmthVotes, warmthBasis || '日记里还没有带天气档的行'),
    {
      key: 'reps',
      name_cn: '复穿次数',
      // value 用"最多的一件记了几次"：它不是"哪一档"，是这一层的强度刻度，出账要能回指到具体行
      value: maxReps > 0 ? maxReps : null,
      share: null,
      counts: { counted_items: itemReps.size, max_reps: maxReps },
      // 闸门与其它计数轴同一把尺子（日记套数），⛔ 不许用"件数"当分母把门槛降下来
      samples: outfits.length,
      in_multiplier: true,
      lift_step: REPS_STEP,
      lift_max: REPS_MAX,
      basis:
        `记过 ${itemReps.size} 件单品，最多的一件记了 ${maxReps} 次；` +
        `幅度 = min(${REPS_MAX}, ${REPS_STEP}×ln(1+次数))，⛔ 只加不减`,
    },
  ]

  // 乘子认这四轴的样本数（`season`/`rating` 只出账不进乘子，样本够不够都不影响这一层是否生效）
  const multReady = dims
    .filter((d) => d.in_multiplier)
    .some((d) => d.samples >= MIN_SAMPLES && d.value != null)

  return {
    dims,
    factor_ready: multReady,
    samples: outfits.length,
    // 本次请求带来的天气档（归一后；没带＝null＝这一轴整块缺席）。出账要能自证"这一屏吃了哪一档"。
    weather_level_used: level,
    // 单品 → 记进日记的套数（`preferenceFactor` 里那条 reps 特判吃它；Map 不进 JSON，出账走 `reps` 那格）
    item_reps: itemReps,
    reps: { counted_items: itemReps.size, max_reps: maxReps },
    provenance: `日记 ${outfits.length} 条（身份口径：${
      sessionId ? 'session' : ''
    }${sessionId && userId ? '+' : ''}${userId ? 'user' : ''}）`,
  }
}

/** 一条候选在这套画像里的取值（取不到 ⇒ null ⇒ 这一轴不参与乘子） */
function candAxisValue(cand, axis, dim) {
  if (axis === 'color_family') {
    const text = asText(cand.color_text) || asText(cand.outfit_top) || asText(cand.top_style)
    return text ? colorFamily(text) : null
  }
  if (axis === 'fit_type') {
    const v =
      asText(cand.fit_type) ||
      asText(cand.body_fit && cand.body_fit.top && cand.body_fit.top.fit_type)
    return FIT_TYPE_VALUES.includes(v) ? v : null
  }
  if (axis === 'occasion') {
    // 场合是**多值**的（一件衣服可以既标通勤又标约会），而画像那一边是"你最常记的一个场合"。
    // 所以这里不是"读候选的场合"，是"读候选与画像的交集里最能说明情况的那一个"：
    // 命中众数 ⇒ 返回众数（+2%）；否则返回"你日记里出现过的哪一个"（0）；
    // 都没有 ⇒ 返回词面最小的那个标签（这一轴按"没记过"记 −1%）。
    // 三条都能被下面的通用循环原样接住，⛔ 不为这一轴再写一份加乘逻辑。
    // 标签为空（规则库那一路的候选现在就没有这一格）⇒ null ⇒ 这一轴对它逐条隐身，不是给它 0 分。
    const tags = (Array.isArray(cand.occasion_tags) ? cand.occasion_tags : [])
      .map((t) => asText(t))
      .filter(Boolean)
    if (tags.length === 0) return null
    if (dim && dim.value && tags.includes(dim.value)) return dim.value
    const seen = dim && dim.counts ? tags.find((t) => dim.counts[t]) : null
    if (seen) return seen
    return tags.slice().sort((a, b) => a.localeCompare(b))[0]
  }
  if (axis === 'warmth') {
    // 衣橱那一路的厚薄在 `body_fit.top.fabric_weight`（`topFitBody.js:716`，没填就是 null）；
    // 直接投进来的行也可能只带 `fabric_weight` 这一格，两个来源都认，⛔ 只认那三个词。
    const v =
      asText(cand.fabric_weight) ||
      asText(cand.body_fit && cand.body_fit.top && cand.body_fit.top.fabric_weight)
    return FABRIC_WEIGHT_VALUES.includes(v) ? v : null
  }
  return null
}

/**
 * 这条候选的偏好乘子。
 * @returns {{factor:number, basis:string|null}} 画像没就绪（各轴样本都 < MIN_SAMPLES）⇒ `factor` **恰好等于 1**
 */
function preferenceFactor(cand, pref) {
  if (!pref || !pref.factor_ready || !cand) return { factor: 1, basis: null }
  let f = 1
  const parts = []
  for (const axis of MULTIPLIER_AXES) {
    const dim = pref.dims.find((d) => d.key === axis)
    if (!dim || !dim.in_multiplier || dim.samples < MIN_SAMPLES || dim.value == null) continue
    const v = candAxisValue(cand, axis, dim)
    if (!v) continue // 这一轴候选身上没值 ⇒ 不加也不减（不是"不偏好"）
    // 逐轴幅度（`19` §五 第 1 条）：厚薄那一轴的"没穿过这一档"是 0 不是 −1%，
    // 因为它每个温度档只攒得到几票，拿最薄的一格罚得最狠说不通。
    const unseen = typeof dim.lift_unseen === 'number' ? dim.lift_unseen : LIFT_UNSEEN
    if (v === dim.value) {
      f += LIFT_TOP
      parts.push(
        `${dim.name_cn}命中你最常记的「${v}」（${dim.share_label || '占日记'} ${Math.round(
          (dim.share || 0) * 100,
        )}%）×${(1 + LIFT_TOP).toFixed(2)}`,
      )
    } else if (dim.counts[v]) {
      f += LIFT_SEEN
      parts.push(`${dim.name_cn}是你穿过的「${v}」，不动`)
    } else {
      f += unseen
      const label =
        unseen === 0
          ? '你的日记里这一档没记过，不动'
          : `你的日记里没记过 ×${(1 + unseen).toFixed(2)}`
      parts.push(`${dim.name_cn}「${v}」${label}`)
    }
  }
  // `reps` 特判（`19` §五 第 2 条）：它比的是"这一件"，不是"哪一档" ⇒ 塞不进上面那个循环。
  // ⛔ 只对衣橱候选生效（`source==='wardrobe'` 才有可比的 id；规则库商品跟你的衬衫不是同一件东西），
  // ⛔ 只加不减（没记进日记不等于不喜欢），⛔ 不吃 dim.samples——它的闸门就是画像级的 factor_ready。
  const reps =
    cand.source === 'wardrobe' && pref.item_reps && cand.wardrobe_item_id != null
      ? pref.item_reps.get(Number(cand.wardrobe_item_id)) || 0
      : 0
  if (reps > 0) {
    const lift = Math.min(REPS_MAX, REPS_STEP * Math.log(1 + reps))
    f += lift
    parts.push(
      `复穿次数：这件你自己记了 ${reps} 套 ⇒ ×${(1 + Math.round(lift * 1000) / 1000).toFixed(3)}`,
    )
  }
  if (parts.length === 0) return { factor: 1, basis: null }
  const clamped = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, f))
  return { factor: Math.round(clamped * 1000) / 1000, basis: parts.join('；') }
}

module.exports = {
  MIN_SAMPLES,
  FACTOR_MIN,
  FACTOR_MAX,
  LIFT_TOP,
  LIFT_SEEN,
  LIFT_UNSEEN,
  REPS_STEP,
  REPS_MAX,
  AXES,
  MULTIPLIER_AXES,
  normalizeWeatherLevel,
  buildPreference,
  candAxisValue,
  preferenceFactor,
}
