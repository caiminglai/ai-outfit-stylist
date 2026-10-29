/**
 * 排序层（10-29 从 recommendEngine.js 拆出，行为不变；原文 :804-1142）。
 * 职责：三维加权综合分（rankDims）、同分裁决／强制在场／截断（rankAndTruncate）。
 * RANK_* 常数与 COLOR_BORROW_WEIGHT 的全部真相在这一个文件里，⛔ 别处不许抄第二份
 * （regressRankWeights.test.js 的漂移哨兵钉的就是本文件）。
 */
const { asText } = require('../../utils/common')
const { preferenceFactor } = require('../wearPreference')
const { collabFactor } = require('../collabFilter')

// ============================================================
// 算法重排（2026-10-19 第二阶段「换脑」→ 2026-10-20 第四阶段·第一步「让算法说话」）
// ============================================================
//
// 改前这里排序只有一刀：`matchRules` 按 priority→score→group_id 排完就交给报告端，
// 而 priority 是人工拍的整数（现量 10-13：priority=25 的组有 79 个、=5 的有 76 个），
// score 又基本等于"这条规则写了几个人都一样的条件"⇒ 同一次推荐里前 3 名的先后
// 与这个人的身材、肤色几乎无关。那一刀就是"抛硬币"。
//
// 现在换成两段：
//   第一段 规则初筛（matchRules 原样保留）：决定**谁有资格进候选集**，不再决定名次。
//   第二段 算法重排（本节）：给每个候选算综合分，按分排名次，取前 RANK_TOP_N 条。
//
//   Score = (w1·规则基础分 + w2·色彩贴合分 + w3·廓形贴合分) × 覆盖率折扣 × 算法缺席惩罚
//   并且：前 RANK_TOP_N 条里必须有 RANK_MIN_ALGO_IN_TOP 条带算法分，不够就从落选池补。
//
// 三个分量各自本来就是 0~100 的量（规则基础分由下面的 RANK_RULE_REF 归一出来），
// 缺哪一维就把那一维的权重退掉、按在场维归一化，再整体乘一个覆盖率折扣 ——
// **绝不给缺测补 0 分，也绝不给缺测补高分**（docs/依据/README.md:64「缺测不出分」（硬规矩 2））。
//
// 第四阶段·第一步为什么不只改权重：只把 w1 从 0.2 压到 0.1，对"一维算法都没出分"的条目
// 几乎没有影响——它的 raw 仍是规则分自己归一出来的那个数（在场维归一化会把权重和约掉），
// 只多挨 0.68→0.64 的一点折扣。10-19 现量的榜首 68 分那条就是这么来的。
// 所以这一轮配了后两件：缺席惩罚把它压到 51.2（按公式推导：raw 100 × 折扣 0.64 × 惩罚 0.8，
// 逐条实测见 docs/进展报告/第四阶段进展报告-20261020.md），强制在场保证算法条目一定进前 8 被看见。

/**
 * 综合分权重。**产品可调的唯一入口**：改这三个数就够了，别处不再各写一遍。
 * 口径（10-20 第四阶段·第一步定）：规则退到 0.1 只当兜底，色彩与廓形各 0.45 主导名次。
 *   改前是 { rule: 0.2, color: 0.4, body: 0.4 }（10-19 第二阶段定的）。
 * ⚠️ 这仍是 C 档手拍值（产品口径，不是依据）：《服装色彩搭配指南》一类资料给的是定性的
 *    面积/对比关系，没有任何一条规定 w2/w3 该是多少；要换成回归系数得先有被试数据
 *    （08 §9.3 的协议），而 `feedback_events` 到 10-19 现量还是 0 行。
 * ⚠️ 单改这一行不会让算法"接管"：色彩与廓形两维在候选里出不出分由数据决定（10-19 现量
 *    规则条目色彩在场率 15.1%、廓形对规则条目恒为 0）。所以同轮还配了下面两件事：
 *    `RANK_ALGO_ABSENCE_PENALTY`（算法缺席就压分）与 `RANK_MIN_ALGO_IN_TOP`（Top N 里强制在场）。
 */
const RANK_WEIGHTS = { rule: 0.1, color: 0.45, body: 0.45 }

/**
 * 借色降权（10-21 第十三阶段·第一步 §二·3，你拍的板＝"借第一色＋降权＋标出处"）。
 * 上衣那一格自己没写具体色、色彩分是**从本组配色串借来的第一个色**算出来的 ⇒
 * 色彩这一维的权重乘 0.5。判据是候选对象上的 `color_borrowed === true`（出处字段见
 * `scoreTopColor`），⛔ 不许在 `colorFit` 的分数里再乘一次——同一件事两层各折一次
 * 是本项目反复清扫的病灶（上面 `rankDims` 里 `COVERAGE_PENALTY` 那条禁令）。
 * ⚠️ C 档手拍值：0.5 没有文献依据。取这个数只为了与第五阶段那条 `ESTIMATED_BODY_AXIS_WEIGHT=0.5`
 *    同档（"这一维的输入不是它自己写的，是推算/借来的"用同一个折扣表达），⛔ 对外不许称"科学"。
 * 后果要如实算：权重从 0.45 变 0.225 ⇒ `coverage` 分母里色彩那一格只算半格，
 * 借色的条目会在覆盖率折扣上再吃一点点，这是"打折"应有的一部分，不是 bug。
 */
const COLOR_BORROW_WEIGHT = 0.5

/**
 * 规则基础分的归一化参照。区间两端都是**现量**（10-19，ro-copy.db enabled=1 +
 * 112 场 personal 推荐跑出来的 918 条候选）：
 *   priority 落在 15~30；命中权重和 score 落在 1~9（众数 3）。
 * 用固定分母而不是"这批候选里的最大最小"，是为了让分数与候选池无关：
 * 同一个人换个场合，同一条规则的基础分不该变（相对归一会把这条性质弄丢）。
 */
const RANK_RULE_REF = { priority: [15, 30], score: [1, 9] }

/**
 * 覆盖率折扣下限：f = FLOOR + (1−FLOOR)·coverage。三维全缺也不清零，只压到 0.6 倍（缺测降权，不是缺测出局）。
 *
 * FLOOR 不是随手拍的，改前的判据（10-19 推导）是：
 *   「一整维缺席」的候选，不许越过另一件其余各维完全相同、而那一维量出来恰好等于
 *    自己其余维平均分的候选 ⇒ 缺身体那维时 coverage=0.6、对面 f=1、raw 相同
 *   ⇒ 要 FLOOR + 0.24 < 1 ⇒ FLOOR < 0.76。取 0.6 留余量（0.7 只留 6% 的差距，会被噪声吃掉）。
 *
 * 10-20 第四阶段·第一步加了 `RANK_ALGO_ABSENCE_PENALTY` 之后这条判据重推了一遍：
 *   往归一化里补一个"等于其余维均值"的分，raw 本来就不变（那是均值的定义），
 *   再乘 0.8 的惩罚 ⇒ 只要 penalty<1，判据自动成立，FLOOR<0.76 不再是那道最紧的约束。
 *   FLOOR 的职责因此退成"整维缺席不许打平量齐"（FLOOR<1 就够）。
 *   0.6 这个值**保留不动**：一是与改前口径连续，二是它把"量齐"与"没量"的差距拉开到肉眼可辨，
 *   第三是它和 0.8 的惩罚叠乘之后的合成因子已经够狠（见 §3 进展报告的实测表），再动它要先重测。
 */
const RANK_COVERAGE_FLOOR = 0.6

/**
 * 算法缺席惩罚（10-20 第四阶段·第一步，产品口径）。
 * 规则命中的那条候选，色彩与廓形**任有一维没出分** ⇒ 综合分再乘 0.8。
 * 三条口径写死在这里，别处不许各算一遍：
 *   1) **只打规则来源的候选**（`src.isRule`）。衣橱里量出来的那几行不吃这条惩罚——
 *      它缺哪一维已经由 `topFitBody` 的 `COVERAGE_PENALTY`（身体层）和上面的 coverage 折扣
 *      各管过一次，再乘 0.8 就是同一件事收三回钱，而且罚的正是我们最想让用户填的那格数据。
 *   2) **缺一维与缺两维都只乘一次 0.8**，不搞 0.8×0.8。这条惩罚表达的是"这条推荐没经过算法"
 *      这一个事实，不是每缺一维再表达一遍。
 *   3) 与 `RANK_COVERAGE_FLOOR` 的折扣**叠乘**（不互斥、不取大）。后果是纯规则条目
 *      拿到 0.64×0.8=0.512 的合成因子——这是刻意的：它一次都没量过、一个字都没算过，
 *      不该继续靠 priority 一个人占榜首。实测表见 docs/进展报告/第四阶段进展报告-20261020.md。
 * ⚠️ C 档手拍值：0.8 没有文献依据，是"要让算法缺席的条目明显让位"的产品判断。
 */
const RANK_ALGO_ABSENCE_PENALTY = 0.8

/** 综合分并列时保留几条（现量：每场穿搭候选 6~9 条，中位 8） */
const RANK_TOP_N = 8

/**
 * 付费报告里"落选池"最多列几条（第十二阶段·第一步，docs/依据/20 §五 第 2 条）。
 * 200 是响应体积上限的产品判断，不是统计量：现量每场穿搭候选只有几十条，正常永远撞不到。
 * ⛔ 这个数不影响任何名次与分数，只决定"尾巴截在哪一行显示"。
 */
const RANK_DROPPED_MAX = 200

/**
 * Top N 里**算法分在场的条目**至少要占几条（10-20 第四阶段·第一步，产品口径）。
 * "在场"= 这条候选的色彩分或廓形分有一个 > 0（不是"没缺席"就算，0 分是真实算出来的最低分，
 *  与"根本没算"是两件事——那条区分见 rankDims 里 `priority=0` 的注释）。
 * 不够就从落选池里按算法分降序补进来，同时从在场名单末尾踢掉同数量的算法缺席条目，
 * 踢谁补谁都要可重复（决定性的比较键，见 rankAndTruncate）。
 * ⛔ 池子里凑不出这么多条就**不硬塞**：凑不出说明这个人的档案和衣柜里没有可算的依据，
 *   把一条 null 分的条目捞进前 8 只会让报告出现"0 分的推荐"那种假东西。
 *   凑不出是数据问题，走采集（第四、五步）解决，不在排序层造假解决。
 */
const RANK_MIN_ALGO_IN_TOP = 2

const clamp01 = (v) => Math.max(0, Math.min(1, v))

/**
 * 固定区间归一：出界钉到两端；参照区间退化成一个点时当"中性"（0.5），不放大噪声。
 * ⚠️ 空值先挡在 Number() 之前：`Number(null)`、`Number('')`、`Number('  ')` 都等于 0，
 *    直接进 Number 会把"这一格没填"读成"这一格填了 0"（10-19 同一条坑在 waistband_cm 上也踩过一次）。
 */
function normTo(v, range) {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const [lo, hi] = range
  if (hi === lo) return 0.5
  return clamp01((n - lo) / (hi - lo))
}

/**
 * 一个候选的综合分。
 * @param {object} cand 穿搭条目（可带 color_fit / body_fit）
 * @param {{isRule:boolean}} src 这条是规则命中的，还是衣橱里量出来的一件上衣
 * @param {object|null} [prefProfile] 这个人的隐性偏好画像（`wearPreference.buildPreference` 出的那份）。
 *   ⛔ 默认 null＝**这一层完全不参与**（门店模式没有个人日记，传进来也只会是 null）。
 *   画像没就绪（各轴样本都够不着 `MIN_SAMPLES`）时 `preferenceFactor` 恰好返回 1 ⇒ 总分一分不变，
 *   这就是"零样本零影响"那条断言的落点（docs/依据/16 §五）。
 * @param {object|null} [collabModel] 协同过滤的 cohort（`collabFilter.buildCohortModel` 出的那份）。
 *   ⛔ 默认 null＝这一层完全不参与；`item_feedback` 0 行时它本身就是 null ⇒ 总分一分不变（docs/依据/17 §4.3）。
 * @returns {null|{score:number, dims:Array, coverage:number, missing:string[]}}
 *          一维都没有 ⇒ null（不进排序，不硬给个分）
 */
function rankDims(cand, src, prefProfile = null, collabModel = null) {
  const dims = []
  // 规则基础分：priority 与命中权重和各占一半（两个都是人工量，合成一维才不至于重复收钱）
  if (src.isRule) {
    const p = normTo(cand.priority, RANK_RULE_REF.priority)
    const s = normTo(cand.score, RANK_RULE_REF.score)
    // 两个都是人工量，少任一个就不给这一维出分（缺测不出分），不许用 (p||0) 把"没填"折成"填了 0"
    const ruleNorm = p == null || s == null ? null : Math.round(100 * (p * 0.5 + s * 0.5))
    dims.push({ key: 'rule', name_cn: '规则基础分', score: ruleNorm, weight: RANK_WEIGHTS.rule })
  }
  // 色彩贴合分：上衣色 vs 肤色的 ΔE 侧（colorMetrics.colorFit），已经是一个 0~100 的分
  const colorScore = cand.color_fit && cand.color_fit.score != null ? cand.color_fit.score : null
  // 🔴 §二·3：上衣那格没写色、这一分是从本组配色串**借**来的 ⇒ 权重打折。
  //    分数照算、在场判据不变（`present`/`missing` 还是看 score 与 weight>0），只是它说话的分量减半。
  dims.push({
    key: 'color',
    name_cn: '色彩贴合分',
    score: colorScore,
    weight:
      colorScore != null && cand.color_borrowed === true
        ? Math.round(RANK_WEIGHTS.color * COLOR_BORROW_WEIGHT * 1000) / 1000
        : RANK_WEIGHTS.color,
    borrowed: cand.color_borrowed === true,
  })
  // 廓形贴合分：topFitBody 那一套实测对齐。**覆盖率惩罚只在身体层乘过一次**
  // （`topFitBody.js` 的 `COVERAGE_PENALTY`，10-19 第三阶段·模块二），这一层就不许再乘一遍
  // `bodyCoverage`——同一件事两层各折一次是本项目反复清扫的那类病灶（改前这里乘 1/6，
  // 身体层又归一出 100，量得越少反而越占便宜）。这一层只管两件事：整维缺席 ⇒ 权重退场；
  // 在场 ⇒ 拿满 RANK_WEIGHTS.body，覆盖率只作为出账字段带出去给前端与报告看。
  const bf = cand.body_fit
  const bodyCoverage = bf ? (bf.coverage == null ? 1 : bf.coverage) : 0
  dims.push({
    key: 'body',
    name_cn: '廓形贴合分',
    score: bf && bf.score != null ? bf.score : null,
    weight: bf && bf.score != null ? RANK_WEIGHTS.body : 0,
    coverage: bodyCoverage,
  })

  const present = dims.filter((d) => d.score != null && d.weight > 0)
  if (present.length === 0) return null
  const wsum = present.reduce((s, d) => s + d.weight, 0)
  const total = RANK_WEIGHTS.rule + RANK_WEIGHTS.color + RANK_WEIGHTS.body
  const raw = present.reduce((s, d) => s + d.weight * d.score, 0) / wsum
  // 覆盖率折扣：在场维的权重占满三分时不折，缺得越多折得越狠（缺测降权那条）
  const coverage = clamp01(wsum / (src.isRule ? total : total - RANK_WEIGHTS.rule))
  const factor = RANK_COVERAGE_FLOOR + (1 - RANK_COVERAGE_FLOOR) * coverage
  // 算法缺席惩罚（10-20 第四阶段·第一步）：规则来源的候选，色彩/廓形任缺一维 ⇒ 再乘 0.8。
  // 用与 present 同一个判据（score 有值且权重没退成 0），不许在这里另起一把尺子。
  // 衣橱行不吃（它那一维的覆盖率惩罚在身体层已经乘过）；缺一维与缺两维都只乘一次。
  const algoMissing = dims
    .filter((d) => d.key === 'color' || d.key === 'body')
    .filter((d) => !(d.score != null && d.weight > 0)).length
  const algoPenalty = src.isRule && algoMissing > 0 ? RANK_ALGO_ABSENCE_PENALTY : 1
  // 偏好乘子（10-20 第八阶段·一e）：与上面两个乘子同层出账，界内 ±5%、画像没就绪恰好是 1。
  // ⛔ 不许在这里再乘第二遍任何"覆盖率"类的东西——同一件事两层各折一次是本项目反复清扫的病灶。
  const pref = preferenceFactor(cand, prefProfile)
  // 协同过滤乘子（10-21 第九阶段·第一步，`17` §四）：与偏好乘子同层同界，⛔ 不进上面那三维的出账。
  // 只有衣柜那一路（带 `wardrobe_item_id`）可能有同组人的分；规则命中的那几条恒 ×1。
  const collab = collabFactor(cand, collabModel)
  return {
    score: Math.round(raw * factor * algoPenalty * pref.factor * collab.factor * 10) / 10,
    dims,
    present: present.map((d) => d.key),
    missing: dims.filter((d) => !(d.score != null && d.weight > 0)).map((d) => d.key),
    coverage: Math.round(coverage * 100) / 100,
    factor: Math.round(factor * 1000) / 1000,
    // 出账要能拆账：报告与回归脚本都要能看出"这一分是被哪一层压下来的"，别只给一个总分
    algo_missing: algoMissing,
    algo_penalty: algoPenalty,
    algo_present: present.some((d) => d.key === 'color' || d.key === 'body'),
    preference_factor: pref.factor,
    preference_basis: pref.basis,
    // 协同过滤出账（`17` §4.2 要求那三件套）：⛔ 只出账、不参与三维归一，也不进回归自变量
    collab_factor: collab.factor,
    collab_basis: collab.basis,
    collab_cohort_size: collab.cohort_size,
    collab_n: collab.n,
  }
}

/** 兜底排序键：综合分并列时回到老口径（priority 降序 → 命中权重降序 → 建规顺序），保证可重复 */
const ruleTie = (a, b) =>
  (b.priority || 0) - (a.priority || 0) ||
  (b.score || 0) - (a.score || 0) ||
  (a.group_id || 0) - (b.group_id || 0) ||
  String(a.group_name || '').localeCompare(String(b.group_name || ''))

/**
 * 这条候选的算法分（色彩 / 廓形取大的那一个）。根本没算出来 ⇒ 0。
 * 注意 0 有两种：`rankDims` 里 `priority=0` 那种"真实算出的最低分"会带 score=0 进来，
 * 但色彩/廓形这两维的 0 分只能来自算完确实是 0（缺测时 score 是 null，不是 0），
 * 所以这里 `> 0` 与"这一维出分了"在实战里等价，写 `> 0` 是为了把"确实算出 0 分"也算进在场。
 */
function algoScoreOf(e) {
  if (!e.rank) return 0
  let best = 0
  for (const d of e.rank.dims) {
    if ((d.key === 'color' || d.key === 'body') && d.score != null && d.score > best) best = d.score
  }
  return best
}

/** 名单主比较键：综合分降序 → 覆盖率降序 → 老口径兜底（全键决定，可重复） */
const rankCmp = (a, b) =>
  (b.rank ? b.rank.score : -1) - (a.rank ? a.rank.score : -1) ||
  (a.rank && b.rank ? b.rank.coverage - a.rank.coverage : 0) ||
  ruleTie(a, b)

/**
 * 规则初筛出来的候选集 → 综合分重排 → 强制算法在场 → 前 RANK_TOP_N 条。
 * 只在穿搭这一类做：妆容/发型/配饰/姿势这四类现在没有色彩与廓形两个分量，
 * 拿同一个公式排等于只按规则分排一遍，白算（等它们各自接进量化层再说）。
 * @param {Array} list 穿搭条目（就地写 rank 字段后返回新数组）
 * @param {Array} wardrobeRows 衣橱里的上衣行（personal 模式才传；没量尺寸的行进不来）
 * @param {object|null} [prefProfile] 这个人的隐性偏好画像（`wearPreference.buildPreference` 出的那份）。
 *   ⛔ 默认 null＝偏好这一层完全不参与；画像没就绪时每条乘子恰好是 1 ⇒ 名次与改前逐条相同。
 * @param {object|null} [collabModel] 协同过滤 cohort；同上，null ⇒ 每条恰好 ×1，名次与改前逐条相同。
 * @param {object} [opts] 第十二阶段·第一步（docs/依据/20 §五）的两个出账开关，⛔ 默认 {} 必须与改前逐字节相同：
 *   `keep_ranked_out` 才挂 `_dropped`（被截掉那一尾的精简投影，上限 200 条），默认连键都不写。
 *   它只给付费报告用（§三 A 节），免费路径读不到、也序列化不出去（数组上的字符串键不参与 JSON.stringify）。
 * @returns {Array} 排名次后的条目，超出 RANK_TOP_N 的被截掉（截掉的写进 _ranked_out）
 */
function rankAndTruncate(list, wardrobeRows, prefProfile = null, collabModel = null, opts = {}) {
  const scored = []
  for (const cand of list) {
    const rank = rankDims(cand, { isRule: true }, prefProfile, collabModel)
    if (rank) cand.rank = rank
    scored.push(cand)
  }
  for (const row of wardrobeRows || []) {
    const rank = rankDims(row, { isRule: false }, prefProfile, collabModel)
    if (rank) {
      row.rank = rank
      scored.push(row)
    }
  }
  scored.sort(rankCmp)
  let out = scored.slice(0, RANK_TOP_N)

  // 强制算法在场（10-20 第四阶段·第一步）：Top N 里算法分在场的条目不足 RANK_MIN_ALGO_IN_TOP 条时，
  // 从落选池按算法分降序补，同时从在场名单末尾踢掉同数量的算法缺席条目。
  // 补进来的按它自己的综合分排位次——**只保证"进前 8 被看见"，不保证排到前面**：
  // 把一条 40 分的东西抬到榜首，只是把"抛硬币"换成了"拍脑袋"，那是另一种造假。
  // 池子里凑不出足够的算法条目 ⇒ 一条都不硬塞（口径写在 RANK_MIN_ALGO_IN_TOP 的注释第 ⛔ 条）。
  let forcedIn = 0
  const inTop = out.filter((e) => algoScoreOf(e) > 0)
  if (inTop.length < RANK_MIN_ALGO_IN_TOP) {
    const donors = scored
      .slice(RANK_TOP_N)
      .filter((e) => algoScoreOf(e) > 0)
      .sort((a, b) => algoScoreOf(b) - algoScoreOf(a) || rankCmp(a, b))
    const dropPool = out.filter((e) => algoScoreOf(e) === 0) // 已按 rankCmp 降序 ⇒ 末尾是分最低的
    const k = Math.min(donors.length, dropPool.length)
    if (k > 0) {
      const dropSet = dropPool.slice(dropPool.length - k)
      out = [...out.filter((e) => !dropSet.includes(e)), ...donors.slice(0, k)].sort(rankCmp)
      forcedIn = k
    }
  }

  out._ranked_out = scored.length - out.length
  out._algo = {
    required: RANK_MIN_ALGO_IN_TOP,
    in_top: out.filter((e) => algoScoreOf(e) > 0).length,
    forced_in: forcedIn,
    // 整个候选池里有算法分的共几条：0 就是"这个人身上没有可算的依据"，不是排序层的锅
    in_pool: scored.filter((e) => algoScoreOf(e) > 0).length,
    candidates: scored.length,
  }
  // 落选池那一尾的精简投影（第十二阶段·第一步·付费报告 A 节）。⛔ 默认不开：
  // 免费路径今天一个字节都不发（`_ranked_out` 只有一个条数），开了也不能改名次。
  // 只带"为什么没进前 8"要的那五个数，⛔ 不把整条动作文案复制两百遍。
  if (opts.keep_ranked_out) {
    const rest = scored.filter((e) => !out.includes(e))
    out._dropped = {
      count: rest.length,
      capped: rest.length > RANK_DROPPED_MAX,
      max: RANK_DROPPED_MAX,
      rows: rest.slice(0, RANK_DROPPED_MAX).map((e) => {
        const r = e.rank || {}
        return {
          name: asText(e.group_name) || asText(e.name) || '',
          source: asText(e.source) || 'rule',
          score: r.score ?? null,
          present: r.present || [],
          missing: r.missing || [],
          coverage: r.coverage ?? null,
        }
      }),
    }
  }
  return out
}


module.exports = {
  RANK_WEIGHTS,
  COLOR_BORROW_WEIGHT,
  RANK_RULE_REF,
  RANK_COVERAGE_FLOOR,
  RANK_ALGO_ABSENCE_PENALTY,
  RANK_TOP_N,
  RANK_MIN_ALGO_IN_TOP,
  rankDims,
  rankAndTruncate,
}
