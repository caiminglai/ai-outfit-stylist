/**
 * 上衣 × 身体 的按人适配分（这一层不看脸）
 *
 * 建档：2026-10-09。设计口径见 docs/依据/08-上衣适配规则-量化方案.md §5/§8/§9/§10。
 * 脸侧那一半（上衣代表色 vs 肤色锚点）在 colorMetrics.js 的 colorFit，两个分数不许混进一个数。
 *
 * 一句话做法：**先算这个人身上"能被上衣改"的比例偏差（偏差向量），再读这件上衣"往哪个方向修、
 * 修多少"（修形向量），同向得分、反向扣分；缺哪一维就不算哪一维，权重按在场维重新归一化。**
 * 这样"同一件上衣在不同人身上分数不同"是几何出来的，不需要谁背书。
 *
 * 输入只用连续量（cm、BMI、明度）。`body_type` / `kibbe_type` / 色彩四季型这类离散标签
 * 一律不进公式（08 §9.2：分类会把分类自身的信度问题带进分数，还会让人以为系统在"判定体型"）。
 *
 * 六根轴与出处（DOI 均已于 10-08 逐条走 api.crossref.org 自核，记录在 docs/依据/06 §8）：
 *  1) shoulder 肩线宽窄   —— 肩宽÷身高、肩宽÷腰围两条离带距离 + 梨形信号；上衣往肩上加体量还是收
 *       Pazhoohi 2023 的 SHR＝肩围÷臀围（本机原文 p2 逐字：the circumference of the shoulders relative to the hips）；
 *       我们量不到"肩围"⇒ 肩宽÷腰围是站内自建比值，只借它方向（p1 摘要：larger SHRs were considered more attractive）
 *  2) waist 腰线强调      —— 人的胸腰差/臀腰差；上衣收腰还是直筒（顺着身体走，不给不存在腰线硬收）
 *  3) ease 松量           —— Liu/Fan/Lau 2006, PMS 103(1):253-264, DOI 10.2466/pms.103.1.253-264
 *       （9 名中国男性 × 5 档白 T：BMI<20 穿大码被评更胖、20–28 更瘦、>28 两端都罚；最小感知尺寸在胸围松量 2–3 cm）B
 *       + Sakata/Kim/Takatera 2020, IJCSCT 33(3):448-464, DOI 10.1108/ijcst-03-2020-0031
 *       （女式衬衫 fit 款胸围 1–7 cm、straight 款约 4 cm；n=20 低于 ITU-T P.910 的 ≥24）B−，只当先验区间
 *  4) length 视觉腰位     —— 人的腿身比偏差 vs 上衣把视觉重心上移/下移（短款、塞腰头 vs 长款过胯）
 *       Kiire 2016 与 Versluys 2018 对腿长比例结论不一致 ⇒ 参考带只当"偏差原点"，不当判据
 *  5) volume 观感体量     —— 深色收缩：Koutsoumpis/Economou/van der Burg 2021, Perception 50(9):741-756,
 *       DOI 10.1177/03010066211038158（深色独立效应 d=0.35–0.58）B；面料厚薄加体量是 C 档经验
 *  6) pattern 条纹方向    —— 结论对冲（Thompson & Mikellidou 2011 DOI 10.1068/i0405 与 Swami & Harris 2012
 *       DOI 10.2224/sbp.2012.40.8.1239 方向相反；Ashida 2013 DOI 10.1068/i0595rep 指出体型大时减弱甚至反转；
 *       Chen & Peng 2026 DOI 10.1177/20416695261441454 给的是"最瘦判断"不是绝对量）
 *       ⇒ 权重压到最低，且 BMI≥25 直接关掉这根轴；对外措辞禁止写"横条显胖/显瘦"（docs/依据/05）
 *
 * 档位诚实说明：修形向量的**方向**来自上面这些 B 档实验；**刻度**（want 拉到 ±1 的换算、
 * 厚薄分档、六根轴的权重）全是 C 档手拍值，处于"标定中"。没有任何国标/行标/同行评议文献规定
 * "某人穿某件上衣好不好看"（08 开头 + 06 的证伪记录）。对外只可以说"按公开研究的方向给参考分"。
 *
 * ============================================================
 * 2026-10-19 第二阶段「最后一公里」：修形向量改吃**成品实测尺寸**，中文词典整块废除
 * ============================================================
 *
 * 改前这件上衣"往哪修"是从 `name / sub_category / pattern / style_tags` 拼出来的自由文本里
 * 认字（`LEXICON` 四张表：垫肩 +1、落肩 −0.6、oversize −0.7…），再拿"宽松/合体"这两个自填档位
 * 当松量代理。那叫**伪量化**：同一件衣服，商品名写"廓形落肩卫衣"和写"卫衣"会得到两个不同的分，
 * 而这两句话背后没有任何尺寸。⇒ 本轮把词典与自由文本这条路整块删掉，改成四格实测数与人体净尺寸
 * 直接做算术（列在 `user_wardrobe`，录入口径见 `fitSize.js` 的 MEASURE_GUIDE）：
 *
 *   shoulder_cm 成品肩宽 − 净肩宽   → 肩线方向（按身高换算成百分点，与 want.shoulder 同一把尺子）
 *   bust_cm     成品胸围 − 净胸围   → 松量（cm），直接进 easeScore(松量窗口, 实测算出的松量)
 *                               └ 这一格没量时改由 fit_type 版型档估（见下面第三阶段那段）
 *   length_cm   下摆落在人体哪条线  → 视觉腰位（身高×0.40 附近＝胯线，往上为正）
 *   waistband_cm 收口/腰缝带高度    → 腰线强调（0＝明确直筒，5cm 及以上＝拉满收腰）
 *
 * 一列一格、一维一源，不重复收钱（胸围只进松量那一维，不再同时喂"观感体量"）。
 * 体量维仍走两个**真字段**：color 的 Lab 明度（A 档色差侧）＋ fabric_weight 自填厚薄档。
 * 条纹维只读 `pattern` 这一格自填值（认 竖条/横条 四个值），不再从商品名里找"条"字。
 *
 * ⛔ **没有衣柜行 ⇒ 这一件不打分**。规则引擎给的那句 `top_style` 文本（"商务Polo衫"）从此
 * 不再产出 body_fit——这不是退化，是拒绝把"认字"冒充成"量出来的分"。缺测在身体层按**覆盖率惩罚**
 * 打折（见下面第三阶段那段），排序侧只负责"整维缺席 ⇒ 权重退场"，不补 0 分、不猜高分。
 *
 * ============================================================
 * 2026-10-19 第三阶段「注水与校准」：这一层加了两件事
 * ============================================================
 *
 * ① 模块二·覆盖率惩罚（`COVERAGE_PENALTY`）：在场轴归一让"六格只量出一格、那格恰好满分"归出
 *    100 分 ⇒ 靠少填给高分。现在 `score = raw_score ×（floor + span × coverage）`，量得越少扣得越狠，
 *    六格齐全的一件一分不扣。
 *
 * ② 模块一·版型映射（`FIT_TYPE_VALUES`／`FIT_TYPE_EASE`）：真实用户不动软尺，四格门槛把管道饿住了。
 *    所以 `bust_cm` 没量但 `fit_type` 选了档 ⇒ 松量按该档放松量区间的**中值**估出来，让公式照样跑；
 *    代价是估出来的那一维在 `coverage` 里只按 **半格**（`ESTIMATED_AXIS_WEIGHT`）计，
 *    ⇒ "只选一档版型"最多拿到 0.5/6≈0.08 的覆盖率，惩罚照样压在头上（选版型买不到整格分数）。
 *    有 `bust_cm` 实测 ⇒ 只认实测，版型那格一个分都不影响（实测优先，两套依据不重复收钱）。
 *
 * ============================================================
 * 2026-10-20 第五阶段「只填身高体重」接线：估算值进 `person_cm`，只进这一格
 * ============================================================
 *
 * ③ `bodyDeviation(person, est)` 多了一个可选入参（不传时回落到 `person.body_est`，
 *    那是 `profileEnricher.enrichProfile` 挂的独立通道）。估算出来的净胸围／净肩宽**只补
 *    `person_cm` 里没量到的那两格**，用来和成衣实测做减法；⛔ 不回写 `p.bust`／`p.shoulder`、
 *    ⛔ 不参与 `measure`／`want`／体型五分类／规则匹配（口径与七条禁令全在
 *    `docs/依据/13-体型估算输入输出规范-20261020.md` §五，喂与不喂 est 的 `measure`/`want`
 *    逐格相同由 `test/bodyDimEstimator.test.js` 断言）。
 *    顶上来的那一轴按 **半格**（`ESTIMATED_BODY_AXIS_WEIGHT`）计覆盖率、且与版型侧那半格不叠乘，
 *    `person_cm_src`＋`ease_src`/`shoulder_src`＋`based_on` 文案三处都留下"这是估的"的记号。
 */

const { resolveColor, hexToLab } = require('./colorMetrics')
const { TOP_WORDS, OUTER_WORDS, hitsWord } = require('./fullLookAdvisor')
const { ownValue } = require('../utils/common')
const { bmiValue } = require('./bmi')

// ------------------------------------------------------------
// 0. 通用小工具
// ------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const clamp01 = (v) => clamp(v, 0, 1)
const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100
/** 数值项：非正数、非有限、空串一律当"没量"，不兜底不编造 */
function meas(val) {
  const n = Number(val)
  return Number.isFinite(n) && n > 0 ? n : 0
}

// ------------------------------------------------------------
// 1. 参考带（站内口径；带外的"想要往哪修"才是算分用的东西）
// ------------------------------------------------------------

const BODY_REF = {
  // 肩宽÷身高 %。GB/T 10000-2023 的百分位公开渠道读不到原值 ⇒【无法证真】，
  // 这里 21~24 只当**站内偏差原点**（与 computeShoulderRatio 的切点同一套），不当"合格线"。
  shoulder_band: [21, 24],
  shoulder_span: 3, // 离带 3 个百分点算这一维拉满
  // 肩宽÷净腰围（站内自建比值；Pazhoohi 2023 那个 SHR 是肩围÷臀围，量不到肩围 ⇒ 不是同一个量）。
  // 原点带由本机 GB/T 10000-2023 表2/表7 的 P50 目视抄读值推：男 391/763=0.512、女 354/690=0.513；
  // 腰围挪到 P10~P90（男 678~905、女 622~788）比值落在 0.43~0.58 ⇒ 取 0.44~0.57 当站内原点带。
  // ⚠️ 人群分布推出来的原点，不是判据（10 §2h ⑦ 那条口径）；span 是 C 档手拍。
  shr_band: [0.44, 0.57],
  shr_span: 0.1,
  // 腿长（髋骨到脚跟）÷身高。中枢≈0.54 是二手转录，切点 ±0.02 是产品假设（08 §2.3）
  leg_band: [0.52, 0.56],
  leg_span: 0.04,
  // 腰线明显度：min(胸围-腰围, 臀围-腰围) ≥12cm 算明显、≤6cm 算平直（产品刻度，C 档）
  waist_strong: 12,
  waist_flat: 6,
  waist_span: 6,
  // BMI 分档沿用 computeBmi 的 18.5 / 24 / 28 切点（体重口径，不是"好看"口径）
  bmi_thin: 18.5,
  bmi_normal: 24,
  bmi_heavy: 28,
  // 松量合适区间：按 BMI 分档（Liu 2006 的方向 + Sakata 2020 的区间先验，谁都不当判定线）
  ease_windows: [
    { below: 20, range: [1, 4], note: 'Liu 2006：BMI<20 穿大码被评更胖 ⇒ 只取小松量' },
    { below: 24, range: [2, 7], note: 'Liu 2006 最小感知尺寸 2–3cm；Sakata 2020 fit 款 1–7cm' },
    { below: 28, range: [3, 10], note: 'Liu 2006：20–28 穿大码被评更瘦 ⇒ 区间往宽挪' },
    { below: Infinity, range: [4, 8], note: 'Liu 2006：BMI>28 过紧过松都显胖 ⇒ 只留中段' },
  ],
  // 条纹轴闸门：Ashida 2013 指体型较大时效应减弱甚至反转
  stripe_bmi_max: 25,
}

/** 六根轴权重：C 档手拍值（标定中），任何对外说法不得称"回归得到"（08 §9.3 才是换它的协议） */
const AXIS_WEIGHTS = {
  shoulder: 0.2,
  waist: 0.18,
  ease: 0.22,
  length: 0.16,
  volume: 0.18,
  pattern: 0.06,
}

/**
 * 覆盖率惩罚因子（2026-10-19 第三阶段·模块二）。
 *
 *   FinalBodyFit = RawBodyFit × (floor + span × Coverage)
 *
 * 病灶：改前 `raw` 只在**在场轴**之间归一（present 轴的权重和当分母），所以"六轴里只量出
 * 一根、而且那根恰好满分"的衣服会归一出 100 分——填得越少越容易全是满分，这是**靠少填给高分**
 * 的作弊口子（他点名的"边界作弊"）。引擎侧原来用 `权重 × 覆盖率` 折了一道，但那只压权重、
 * 压不动"归一后本身就是 100"这件事，10-19 复算实测：覆盖率 0.17 的那件照样出 body_fit 100。
 *
 * 口径（10-19 第三阶段定）：**惩罚只在身体层乘这一次**，`recommendEngine.js` 那一层不再乘
 * `bodyCoverage`（两层各折一遍＝同一件事收两次钱，是本项目反复扫的那类病灶；只留缺整维时的
 * 权重退场与总分侧的 coverage 折扣，那两件管的是"这一维根本没出分"，与"出分但依据薄"不重复）。
 *
 * floor/span 是 C 档手拍锚点：floor=0.5 保证「只量出一格」最多只能拿到满分的一半，
 * 越不过"量到两格且两格都一般"（0.5+0.5×0.33=0.665 的折扣 × 它自己的原始分）那一档；
 * span=0.5 保证覆盖率 1 ⇒ 因子恰好 1（量齐的一件不打折，惩罚只针对"依据薄"）。
 * 要改成别的曲线（比如平方根、或按轴数而不是覆盖率）就动这两个数，别处不再写第二遍。
 */
const COVERAGE_PENALTY = { floor: 0.5, span: 0.5 }

/**
 * 版型四档（2026-10-19 第三阶段·模块一「注水」）。
 *
 * 为什么要这一列：真实用户不会随身带软尺，四格实测尺寸的门槛把管道饿住了（"管道通了，水没来"）。
 * 于是让**量不了尺寸的人至少选一档版型**，松量那一维由版型映射出的放松量区间**取中值**估出来，
 * 公式照样跑——但估的那一维在覆盖率里**只按半格计**（见 `describeTop` 的 coverage 算式），
 * 所以它拿的是模块二那条惩罚折过之后的分，**"选个版型"绕不开惩罚**。
 *
 * 值域与 `fit_style`（合体/宽松，两档）不是一回事：fit_style 从这一轮起退役为展示标签，
 * 评分只认 fit_type ⇒ 同一件事只留一个真相源（老库里 fit_style 已填的值不动、也不再产生分）。
 *
 * 区间是**C 档手拍值**，锚在本机有原文的两处（详见 docs/依据/10 §2g、docs/依据/09）：
 *   · Sakata/Kim/Takatera 2020（n=20，实测成品−净尺寸）：fit 款正面胸围放松量 1~7cm
 *   · GB/T 2668-2017 §3.1：成品规格＝控制部位数值**加放松量**，三个实例是胸围 +20（男中山服上装）
 *     /+22（女茄克衫）/+26（男茄克衫）cm —— ⚠️ 那是有里子或硬挺的外衣，不是 T 恤与衬衫，
 *     国标**没有**给"宽松 T 恤该放多少"，所以这四档不能对外称国标值
 * 他给的例子「宽松 = 胸围 +15cm」落在宽松档的上端（区间中值 11.5cm）。
 * ISO 8559 系列与 EN 13402 只规定部位与成品规格的**量法**，不给放松量；GB/T 31901-2024 的合体性
 * 五级要真人试穿评定，机器量不出来（且 2026-12-01 才实施）⇒ 都不当这里的依据。
 */
const FIT_TYPE_VALUES = ['修身', '合身', '宽松', '廓形']

/** 每档的放松量区间（cm，胸围）＋ 中值就是估出来的松量；note 只写给审计看，不进对外文案 */
const FIT_TYPE_EASE = {
  修身: { range: [0, 2], note: '贴身款，上限压在 Sakata 2020 fit 款下限 1cm 附近' },
  合身: { range: [2, 7], note: 'Sakata 2020 fit 款正面胸围实测 1~7cm（本机原文·摘要级）' },
  宽松: { range: [8, 15], note: '比 fit 款上限再放一档；15cm 取产品口径（他给的例子）' },
  廓形: { range: [15, 26], note: 'GB/T 2668-2017 三个外衣实例 +20/+22/+26 只当上端锚' },
}

/**
 * 版型档 → 估计松量（区间中值）。认不到值域（包括空、旧词"合体"）一律回 null ⇒ 不估、这一维缺席。
 * ⛔ 不做"就近归档"：把"紧身""oversize"这类自由词猜成某一档，等于又回到认字打分。
 */
function easeFromFitType(val) {
  const v = typeof val === 'string' ? val.trim() : ''
  const hit = FIT_TYPE_EASE[v]
  if (!hit) return null
  const [lo, hi] = hit.range
  return r1((lo + hi) / 2)
}

/** 估计轴在覆盖率里的计法：实测一格算 1 格，版型估出来的一格只算半格（依据比量出来的薄） */
const ESTIMATED_AXIS_WEIGHT = 0.5

/**
 * 身体侧估出来的那一轴在覆盖率里的计法（第五阶段·第一步接线）。
 * 与版型侧同值、同一含义（依据同样薄），单列一个名字是因为 `13` §五 第 5 条把它写成独立常量：
 * 一轴同时"身体估＋版型估"（松量轴会撞上）时**只推一次 key ⇒ 取 0.5，不取 0.25**——
 * 两个半格叠乘会把"估出来的合身度"打到比"什么都没量"还低，那是惩罚数据缺口的反面。
 */
const ESTIMATED_BODY_AXIS_WEIGHT = 0.5

const AXIS_CN = {
  shoulder: '肩线宽窄',
  waist: '腰线强调',
  ease: '松量',
  length: '视觉腰位',
  volume: '观感体量',
  pattern: '条纹方向',
}

const AXIS_TIER = {
  shoulder:
    'B 方向(Pazhoohi 2023；该文的 SHR＝肩围÷臀围，本机原文 p2) + C 参考带与刻度(肩宽÷身高、肩宽÷腰围都是站内比值,手拍)',
  waist: 'B− 腰臀比与腰线可读性(Singh 系结论被 BMI 混淆) + C 刻度(手拍)',
  ease: 'B 方向与区间(Liu 2006 n=9 中国男性 / Sakata 2020 n=20) + C 松量代理(版型档换算)',
  length: 'B− 腿身比结论未闭合(Kiire 2016 vs Versluys 2018) + C 刻度(手拍)',
  volume: 'B 深色收缩(Koutsoumpis 2021 d=0.35–0.58) + C 面料厚薄加体量(经验)',
  pattern: 'B 结论对冲(四篇方向不一) ⇒ 最低权重且 BMI 闸门，禁止写成确定话',
}

// ------------------------------------------------------------
// 2. 偏差向量：这个人身上"能被上衣改"的几维，各往哪个方向修（+加 / −收）
// ------------------------------------------------------------

/**
 * @param {object} person 档案（enrichProfile 的输入或输出都行，字段名同一套）
 * @param {object} [est] `estimateBodyDims()` 的结果；不传时回落到 `person.body_est`
 *        （enrichProfile 挂的那一格），所以现有五个调用点不改也能吃到估算值。
 * @returns {{measure:object, person_cm:object, person_cm_src:object, want:object,
 *            ease_window:number[]|null, notes:string[]}}
 *          某维的输入没量 ⇒ want 该维为 null，这一维就不进总分
 *
 * 🔴 第五阶段·第一步接线：`est` **只许补 `person_cm` 的 bust／shoulder 两格**
 * （`docs/依据/13-体型估算输入输出规范-20261020.md` §五 第 1、4 条）。
 * 上面 `measure`／`want` 用的仍是"量到的"那几个局部变量 ⇒ 同一个档案喂 est 与不喂 est，
 * `measure` 与 `want` 逐格相同（这条有单测断言）。补进来的那一格在 `person_cm_src`
 * 里标 `'estimated'`，`describeTop` 据此在覆盖率里按半格计、在 based_on 里写明是估的。
 */
function bodyDeviation(person, est) {
  const p = person || {}
  const height = meas(p.height)
  const weight = meas(p.weight)
  const shoulder = meas(p.shoulder)
  const bust = meas(p.bust)
  const waist = meas(p.waist)
  const hip = meas(p.hip)
  const leg = meas(p.leg_length)

  // 算式只在 services/bmi.js 有一份（本层内部沿用 0 当"没量"哨兵，146/212 两处判据都按它写）；带切点的三根比值先按对外精度取整再比（同 bmi.js、同条纹闸门）
  const bmi = r1(bmiValue(height, weight) ?? 0)
  const shoulderRatio = shoulder > 0 && height > 0 ? r1((shoulder / height) * 100) : 0
  const shr = shoulder > 0 && waist > 0 ? shoulder / waist : 0
  const legRatio = leg > 0 && height > 0 ? r2(leg / height) : 0

  const measure = {
    bmi: bmi > 0 ? r1(bmi) : null,
    shoulder_ratio: shoulderRatio > 0 ? r1(shoulderRatio) : null,
    shoulder_waist_ratio: shr > 0 ? r2(shr) : null,
    leg_ratio: legRatio > 0 ? r2(legRatio) : null,
    bust_waist_diff: bust > 0 && waist > 0 ? r1(bust - waist) : null,
    hip_waist_diff: hip > 0 && waist > 0 ? r1(hip - waist) : null,
    bust_hip_diff: bust > 0 && hip > 0 ? r1(bust - hip) : null,
  }

  // 10-19 第二阶段：成衣实测尺寸要和**人体净尺寸**做减法（成品胸围−净胸围＝松量、
  // 成品肩宽−净肩宽＝肩缝外移量），而上面那份 measure 全是比值与差值，拿不到原始 cm。
  // 这里把量到的四个原值随向量一起带出去，describeTop 只读这一份，不再自己去猜字段。
  // 没量的记 null（0 是 meas() 的内部哨兵，绝不外传——外传就变成"净胸围 0cm"这种假数）。
  //
  // 10-20 第五阶段·第一步：没量到的那两格（净胸围／净肩宽）允许由"身高+体重+年龄"估出来顶上。
  // 🔴 估算值只在这里进 `person_cm`，⛔ 不回写 `p.bust`／`p.shoulder`、⛔ 不参与上面的 measure／want。
  //    所以"这个人是苹果型""肩宽比在不在带内"这些结论跟以前一模一样，估的数碰不到（`13` §五 2~4 条）。
  let e = null
  if (est && est.estimated) e = est
  else if (p.body_est && p.body_est.estimated) e = p.body_est
  const estBust = e ? meas(e.bust_cm) : 0
  const estShoulder = e ? meas(e.shoulder_cm) : 0
  const person_cm = {
    height: height > 0 ? r1(height) : null,
    bust: bust > 0 ? r1(bust) : estBust > 0 ? r1(estBust) : null,
    shoulder: shoulder > 0 ? r1(shoulder) : estShoulder > 0 ? r1(estShoulder) : null,
    waist: waist > 0 ? r1(waist) : null,
    hip: hip > 0 ? r1(hip) : null,
  }
  // 每格的出处（实测／估算／没量）。`describeTop` 靠它决定这一轴在覆盖率里算整格还是半格，
  // 报告与后台靠它把"估的"两个字带到用户眼前——⛔ 不许显示成"你填的胸围"（`13` §五 第 6 条）。
  const person_cm_src = {
    height: height > 0 ? 'measured' : null,
    bust: bust > 0 ? 'measured' : estBust > 0 ? 'estimated' : null,
    shoulder: shoulder > 0 ? 'measured' : estShoulder > 0 ? 'estimated' : null,
    waist: waist > 0 ? 'measured' : null,
    hip: hip > 0 ? 'measured' : null,
  }

  const want = { shoulder: null, waist: null, length: null, volume: null, pattern: null }
  const notes = []

  // 估算顶上的那两格必须在审计里露名（`13` §五 第 6 条：⛔ 不能让人读成"你填的胸围"）。
  if (person_cm_src.bust === 'estimated')
    notes.push(
      `净胸围没量 ⇒ 用身高体重按 GB/T 10000-2023 人群分布估的 ${person_cm.bust}cm（本站实测残差 ±2cm 上下）⇒ 只喂减法，这一轴按半格计`,
    )
  if (person_cm_src.shoulder === 'estimated')
    notes.push(
      `净肩宽没量 ⇒ 估的 ${person_cm.shoulder}cm（端到端残差男 ≤5.5%／女 ≤7.0%，偏瘦小个子那端会估高）⇒ 只喂减法，这一轴按半格计`,
    )

  // —— 肩线：离带就往外拉满；下身比上身宽（梨形侧）时也想让上衣把肩加出去 ——
  const shoulderSignals = []
  if (shoulderRatio > 0) {
    const [lo, hi] = BODY_REF.shoulder_band
    if (shoulderRatio < lo)
      shoulderSignals.push(clamp01((lo - shoulderRatio) / BODY_REF.shoulder_span))
    else if (shoulderRatio > hi)
      shoulderSignals.push(-clamp01((shoulderRatio - hi) / BODY_REF.shoulder_span))
    else notes.push(`肩宽比 ${r1(shoulderRatio)} 在参考带内 ⇒ 这维不推拉，上衣往任一侧修都扣分`)
  }
  // 肩宽÷腰围：比值低＝肩相对腰偏窄 ⇒ 想加肩（借 Pazhoohi 2023 的方向）；比值高只是"别再给肩加体量"，
  // 文献没说大到出带还要收，所以高带那一侧的方向是产品选择、不是文献结论（写进 note，别糊过去）
  if (shr > 0) {
    const [lo, hi] = BODY_REF.shr_band
    if (shr < lo) shoulderSignals.push(clamp01((lo - shr) / BODY_REF.shr_span))
    else if (shr > hi) shoulderSignals.push(-clamp01((shr - hi) / BODY_REF.shr_span))
    else notes.push(`肩宽÷腰围 ${r2(shr)} 在参考带内 ⇒ SHR 这条不推拉`)
  }
  if (bust > 0 && hip > 0) {
    // 臀围明显大于胸围 ⇒ 上身偏轻，往"加肩"方向修；反向只在明显超出参考带时才收
    const diff = hip - bust
    shoulderSignals.push(diff > 0 ? clamp01(diff / 8) : clamp(diff / 12, -1, 0))
  }
  if (shoulderSignals.length > 0) {
    want.shoulder = r2(shoulderSignals.reduce((s, v) => s + v, 0) / shoulderSignals.length)
  }

  // —— 腰线：顺着身体走。腰线本来就明显 ⇒ 收腰加分；平直 ⇒ 硬收腰扣分 ——
  const gaps = []
  if (bust > 0 && waist > 0) gaps.push(bust - waist)
  if (hip > 0 && waist > 0) gaps.push(hip - waist)
  if (gaps.length === 2) {
    const groove = Math.min(gaps[0], gaps[1])
    const mid = (BODY_REF.waist_strong + BODY_REF.waist_flat) / 2
    want.waist = r2(clamp((groove - mid) / BODY_REF.waist_span, -1, 1))
    measure.waist_groove_cm = r1(groove)
  } else if (gaps.length === 1) {
    // 只有臀腰差也算，但标成 partial：胸围没填时这一维的证据面窄一半
    const groove = gaps[0]
    const mid = (BODY_REF.waist_strong + BODY_REF.waist_flat) / 2
    want.waist = r2(clamp((groove - mid) / BODY_REF.waist_span, -1, 1))
    measure.waist_groove_cm = r1(groove)
    notes.push('胸围没量 ⇒ 腰线这维只用臀腰差算（partial）')
  }

  // —— 视觉腰位：腿身比偏短 ⇒ 想把视线上移（短款/塞腰头）；偏长 ⇒ 往下压 ——
  if (legRatio > 0) {
    const [lo, hi] = BODY_REF.leg_band
    if (legRatio < lo) want.length = r2(clamp01((lo - legRatio) / BODY_REF.leg_span))
    else if (legRatio > hi) want.length = r2(-clamp01((legRatio - hi) / BODY_REF.leg_span))
    else notes.push(`腿身比 ${r2(legRatio)} 在参考带内 ⇒ 这维不推拉`)
  }

  // —— 观感体量：偏瘦想加体量（浅/蓬），偏胖想收（深/顺） ——
  if (bmi > 0) {
    if (bmi >= BODY_REF.bmi_heavy) want.volume = -1
    else if (bmi >= BODY_REF.bmi_normal)
      want.volume = r2(-clamp01(0.3 + (bmi - BODY_REF.bmi_normal) / 4))
    else if (bmi < BODY_REF.bmi_thin) want.volume = r2(clamp01((BODY_REF.bmi_thin - bmi) / 4))
    else want.volume = 0
    // 条纹轴用同一个方向：想显窄 ⇒ 配对任务里横条更瘦（Koutsoumpis 2026），只当低权重修正
    want.pattern = want.volume
    // 但这方向文献自己就互相冲突（Thompson&Mikellidou 2011 / Swami&Harris 2012 /
    // Ashida 2013 / Chen&Peng 2026 结论不一），只敢在 BMI<25 时当低权重修正用；
    // 闸门关上时把 want.pattern 直接置 null ⇒ 界面不会挂着"条纹想收"却一维都没算它。
    // 闸门读的必须是 measure.bmi（已经 r1 取整那份），不能读原始 bmi：打分侧按 measure.bmi
    // 判 stripeOn，两边用两个数时原始 bmi 落在 24.95≤bmi<25.00（r1 把它抬成 25.0）会出现
    // "闸门放行、打分关掉" ⇒ want.pattern 留着而 pattern 这一维零贡献，
    // 正是这句话承诺不会出现的状态。
    if (measure.bmi >= BODY_REF.stripe_bmi_max) {
      want.pattern = null
      notes.push(
        `BMI ${r1(bmi)} ≥ ${BODY_REF.stripe_bmi_max} ⇒ 条纹方向这条不采用（文献结论互相冲突，只在偏瘦区间当低权重修正）`,
      )
    }
  }

  // —— 松量窗口（口径单点：合身层 fitSize.js 也调这个函数，两处不许各摆一套数） ——
  const win = easeWindowFor(bmi)
  const easeWindow = win ? win.range : null
  if (win) notes.push(`松量窗口 ${win.range.join('~')}cm（${win.note}）`)

  return { measure, person_cm, person_cm_src, want, ease_window: easeWindow, notes }
}

/**
 * 成衣实测尺寸 → 修形向量的刻度（10-19 第二阶段新增；全部 C 档手拍，标定中）。
 * ⚠️ 表里的比例没有一条有国标原文：GB/T 10000-2023 的百分位本机读不到原值 ⇒【无法证真】，
 * 0.40 只是站内自建的"肩颈点到胯线的距离≈身高多少倍"原点，不当任何合格线。
 */
const GARMENT_REF = {
  /** 肩颈点(HPS)→胯线 ≈ 身高×0.40（衣长落在这一带＝下摆在胯） */
  hps_to_hip_ratio: 0.4,
  // S9（10-23 摘除）：原 `hps_to_waist_ratio: 0.24` 全仓只命中定义行本身、没有任何读取方，
  // 留在原地会让下一个改代码的人以为"腰位那一维"在参与计算（蓝图 §3.2 #9）。
  /** 下摆离胯线 12cm 算"视觉腰位"这一维拉满（C 档手拍） */
  hem_span_cm: 12,
  /** 腰头/收口 5cm 及以上算"腰线强调"拉满，0cm 算完全不强调（C 档手拍） */
  waistband_strong_cm: 5,
  /** 条纹这一格只认这四个自填值（不再从商品名里找"条"字） */
  pattern_values: { 竖条: 1, 竖条纹: 1, 横条: -1, 横条纹: -1 },
}

/**
 * 按 BMI 取"合适松量窗口"。
 * @param {number} bmi 没量（≤0 或非有限）⇒ 返回 null，不兜底
 * @returns {null|{range:number[], note:string, below:number}}
 */
function easeWindowFor(bmi) {
  const b = Number(bmi)
  if (!Number.isFinite(b) || b <= 0) return null
  const band = BODY_REF.ease_windows.find((x) => b < x.below)
  return band || null
}

// ------------------------------------------------------------
// 3. 修形向量：这件上衣往哪几个方向修、修多少（10-19 第二阶段：只吃实测尺寸）
// ------------------------------------------------------------

/**
 * 面料厚薄三档（10-21 第十一阶段·第一步提到唯一真相源的位置）。
 * ⛔ 值表只准从这里取：`routes/wardrobe.js` 的录入校验、`services/wearPreference.js` 的
 * `warmth` 轴、以及未来的门店侧都吃这一份，抄第二份＝"改了那边忘了这边"那类病灶。
 */
const FABRIC_WEIGHT_VALUES = ['薄', '中', '厚']

/** 面料厚薄（衣橱里那一格由主人自己选：薄/中/厚）→ 观感体量加量。C 档经验刻度 */
const FABRIC_BULK = { 薄: -0.4, 中: 0, 厚: 0.6 }

/**
 * 这件算不算"上衣"（含外套）。现量：活库 user_wardrobe.category 存的是中文自由标签
 * （'衬衫'/'开衫'/'外套'…），库里从来没有 'top'/'outerwear' 这种英文键 ⇒ 只按英文键筛会一条不中。
 * 词表沿用 fullLookAdvisor 那一套，不再另立第二套口径；两种键都认，规则结论那条链路传的仍是英文。
 */
const TOP_CATEGORY_KEYS = ['top', 'outerwear']
function isTopCategory(category) {
  const c = String(category || '')
  if (TOP_CATEGORY_KEYS.includes(c.toLowerCase())) return true
  return hitsWord(TOP_WORDS, c) || hitsWord(OUTER_WORDS, c)
}

/** 取一个"能进算术"的实测数：没填／非有限／≤0 一律当没量（0 不许冒充 0cm 的成衣） */
function cm(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 把**衣柜里的一行**翻成修形向量。
 *
 * 10-19 第二阶段把入参收窄成"必须是行对象"：传字符串（规则结论那句 `top_style` 自由文本）
 * 或 null ⇒ 直接返回一个各维全 null 的描述（`source:'no_row'`），这一件就不打分。
 * 改前这里会从 name/sub_category/pattern/style_tags 拼一句自由文本再认字（LEXICON 四张表），
 * 商品名写"廓形落肩卫衣"和只写"卫衣"能差出两三十分——那是把认字冒充成量出来的数。
 *
 * @param {object} row 衣柜一行（至少要有 shoulder_cm/bust_cm/length_cm/waistband_cm 里的某几个，
 *        或 fit_type 那一档版型——量不了尺寸的人走后者）
 * @param {object} dev `bodyDeviation()` 的结果，只用它的 `person_cm`（人体净尺寸，做减法用）
 *        与 `person_cm_src`（每一格是实测还是估算——决定这一轴在覆盖率里算整格还是半格）
 * @returns {{label:string, source:string, text:string, hex:string|null,
 *            fit_type:string|null,
 *            ease:number|null, shoulder:number|null, waist:number|null,
 *            length:number|null, volume:number|null, pattern:number|null,
 *            measured:string[], estimated:string[], body_estimated:string[], missing:string[],
 *            ease_src:string|null, shoulder_src:string|null,
 *            coverage:number, signals:string[]}}
 */
function describeTop(row, dev) {
  const isRow = row && typeof row === 'object'
  const p = (dev && dev.person_cm) || {}
  const src = (dev && dev.person_cm_src) || {}
  const signals = []
  const measured = []
  const missing = []
  // 由版型档**估**出来的轴（10-19 第三阶段·模块一）：与实测分开记，覆盖率里按半格计
  const estimated = []
  // 由**身体侧**估出来的轴（10-20 第五阶段·第一步：净胸围／净肩宽是身高体重推的）。
  // 同一轴同时被两侧估（松量会撞上）时只往 `estimated` 推一次 ⇒ 半格不叠乘（`13` §五 第 5 条）。
  const bodyEstimated = []
  const markBodyEstimated = (axisKey) => {
    bodyEstimated.push(axisKey)
    if (!estimated.includes(axisKey)) estimated.push(axisKey)
  }

  // 没有衣柜行 ⇒ 四格实测尺寸无从取，这一件不打分（不是打 0 分，是这一维整块缺席）
  if (!isRow) {
    return {
      label: String(row == null ? '' : row).slice(0, 24),
      source: 'no_row',
      text: String(row == null ? '' : row),
      hex: null,
      fit_style: null,
      fit_type: null,
      fabric_weight: null,
      ease: null,
      shoulder: null,
      waist: null,
      length: null,
      volume: null,
      pattern: null,
      measured,
      estimated,
      body_estimated: [],
      ease_src: null,
      shoulder_src: null,
      missing: ['shoulder', 'waist', 'ease', 'length', 'volume', 'pattern'],
      coverage: 0,
      signals: ['没有衣柜行（只有规则结论那句文本）⇒ 四格成品实测尺寸一个都取不到 ⇒ 这件不打分'],
    }
  }

  const gShoulder = cm(row.shoulder_cm)
  const gBust = cm(row.bust_cm)
  const gLength = cm(row.length_cm)
  // 腰头高这一格允许填 0（0＝"这件没有腰头/收口"是一个真实结论，与"没量"不同），
  // 所以它不能过 cm()：先分清"这格到底填了没"，再只挡非有限数与负数，0 照常进公式。
  const wbGiven =
    row.waistband_cm !== null &&
    row.waistband_cm !== undefined &&
    String(row.waistband_cm).trim() !== ''
  const wbRaw = Number(row.waistband_cm)
  const gWaistband = wbGiven && Number.isFinite(wbRaw) && wbRaw >= 0 ? wbRaw : null
  const text = [row.name, row.sub_category].filter(Boolean).join(' ')
  const label = String(row.name || '').trim() || text.slice(0, 12) || '（没填名字的一件）'

  const fitTypeGiven = typeof row.fit_type === 'string' ? row.fit_type.trim() : ''
  const fitType = FIT_TYPE_VALUES.includes(fitTypeGiven) ? fitTypeGiven : null
  if (fitTypeGiven !== '' && fitType === null) {
    signals.push(
      `版型那格填的「${fitTypeGiven.slice(0, 12)}」不在值域（${FIT_TYPE_VALUES.join('/')}）⇒ 不估`,
    )
  }

  // —— 松量：优先实测（成品胸围 − 净胸围）。量不了胸围、但选了版型 ⇒ 按版型区间中值**估**，
  //     这一维标记为 estimated、在覆盖率里只按半格计（10-19 第三阶段·模块一「注水」）。
  //     10-20 第五阶段·第一步：净胸围这一格本身可以是估的（`person_cm_src.bust==='estimated'`），
  //     减法照做、但这一轴同样按半格计——`bust_cm` 那格是成衣实测、`measured` 里照常记，
  //     人体侧的出处由 `ease_src`／`body_estimated` 说清楚，两套估算不叠乘。——
  let ease = null
  let easeSrc = null
  if (gBust != null && p.bust != null) {
    ease = r1(gBust - p.bust)
    measured.push('bust_cm')
    if (src.bust === 'estimated') {
      easeSrc = 'bust_est'
      markBodyEstimated('ease')
      signals.push(
        `松量＝成品胸围 ${gBust} − 净胸围 ${p.bust} = ${ease}cm；净胸围是身高体重估的（±2cm 上下）⇒ 这一格按半格计覆盖率`,
      )
    } else {
      easeSrc = 'bust_cm'
      signals.push(`松量＝成品胸围 ${gBust} − 净胸围 ${p.bust} = ${ease}cm`)
    }
    if (fitType) signals.push(`版型选了「${fitType}」但胸围量到了 ⇒ 只认实测，版型那格不参与算分`)
  } else if (fitType) {
    const est = easeFromFitType(fitType)
    ease = est
    easeSrc = 'fit_type'
    estimated.push('ease')
    signals.push(
      `松量按版型「${fitType}」估 = 区间 ${FIT_TYPE_EASE[fitType].range.join('~')}cm 的中值 ${est}cm（没量胸围 ⇒ 这一格按半格计覆盖率）`,
    )
  } else {
    missing.push('ease')
    if (gBust == null) signals.push('成品胸围没量 ⇒ 松量算不出')
    if (p.bust == null) signals.push('净胸围没量 ⇒ 松量算不出')
  }

  // —— 肩线：成品肩宽 − 净肩宽，换算成"肩宽÷身高"的百分点再除以 BODY_REF.shoulder_span，
  //     与 want.shoulder 用同一把尺子（want 那侧就是按百分点离带多远算出来的）——
  let shoulder = null
  let shoulderSrc = null
  if (gShoulder != null && p.shoulder != null && p.height != null) {
    const pts = ((gShoulder - p.shoulder) / p.height) * 100
    shoulder = r2(clamp(pts / BODY_REF.shoulder_span, -1, 1))
    measured.push('shoulder_cm')
    if (src.shoulder === 'estimated') {
      shoulderSrc = 'shoulder_est'
      markBodyEstimated('shoulder')
      signals.push(
        `肩缝外移 ${r1(gShoulder - p.shoulder)}cm = 肩宽比 ${r1(pts)} 个百分点 ⇒ 方向 ${shoulder > 0 ? '+' : ''}${shoulder}；净肩宽是估的（男 ≤5.5%／女 ≤7.0%）⇒ 这一格按半格计覆盖率`,
      )
    } else {
      shoulderSrc = 'shoulder_cm'
      signals.push(
        `肩缝外移 ${r1(gShoulder - p.shoulder)}cm = 肩宽比 ${r1(pts)} 个百分点 ⇒ 方向 ${shoulder > 0 ? '+' : ''}${shoulder}`,
      )
    }
  } else {
    missing.push('shoulder')
    signals.push('成品肩宽或净肩宽/身高没量齐 ⇒ 肩线方向算不出')
  }

  // —— 腰线强调：腰头/收口自身的高度。0cm＝这件明确直筒不强调，5cm 及以上＝拉满 ——
  let waist = null
  if (gWaistband != null) {
    waist = r2(clamp((2 * gWaistband) / GARMENT_REF.waistband_strong_cm - 1, -1, 1))
    measured.push('waistband_cm')
    signals.push(`腰头高 ${gWaistband}cm → 腰线强调 ${waist > 0 ? '+' : ''}${waist}`)
  } else {
    missing.push('waist')
    signals.push('腰头高没填 ⇒ 腰线强调这一维不算（0 与没填是两件事）')
  }

  // —— 视觉腰位：下摆落在人体哪条线上。衣长≈身高×0.40 时正落在胯线，往上为正（提腰）——
  let length = null
  if (gLength != null && p.height != null) {
    const hipLine = p.height * GARMENT_REF.hps_to_hip_ratio
    length = r2(clamp((hipLine - gLength) / GARMENT_REF.hem_span_cm, -1, 1))
    measured.push('length_cm')
    signals.push(
      `衣长 ${gLength}cm vs 胯线≈${r1(hipLine)}cm ⇒ 视觉腰位方向 ${length > 0 ? '+' : ''}${length}`,
    )
  } else {
    missing.push('length')
    signals.push('衣长或身高没量 ⇒ 视觉腰位算不出')
  }

  // —— 观感体量：两个真字段。色的 Lab 明度（A 档色差侧）+ 面料厚薄（主人自填档）——
  let lightnessDir = null
  let hex = null
  // 10-20 第六阶段·第一步接线：颜色栏空着、色写在商品名里（「雾霾蓝卫衣」）的那一行，
  // 改前这一格直接缺测。⚠️ 是"先试颜色栏、取不到才试名字"，不是把两串拼一起——
  // 拼串会把 '#111111' 这种 hex 变成非纯 hex 串，`resolveColor` 的 hex 分支只认整串是 hex（现量）。
  const colorField = typeof row.color === 'string' ? row.color.trim() : ''
  const nameField = typeof row.name === 'string' ? row.name.trim() : ''
  const resolved = resolveColor(colorField) || (nameField ? resolveColor(nameField) : null)
  if (resolved) {
    const lab = hexToLab(resolved)
    if (lab && Number.isFinite(lab.L)) {
      hex = resolved
      lightnessDir = r2(clamp((lab.L - 50) / 40, -1, 1)) // 深→负(收)，浅→正(胀)
      measured.push('color')
    }
  }
  const bulkField = typeof row.fabric_weight === 'string' ? row.fabric_weight.trim() : ''
  const bulk = ownValue(FABRIC_BULK, bulkField)
  if (bulk != null) {
    measured.push('fabric_weight')
    signals.push(`面料${bulkField}${bulk > 0 ? '加' : bulk < 0 ? '减' : '不动'}体量`)
  }
  let volume = null
  if (lightnessDir != null && bulk != null) volume = r2(0.65 * lightnessDir + 0.35 * bulk)
  else if (lightnessDir != null) volume = lightnessDir
  else if (bulk != null) volume = bulk
  if (lightnessDir != null)
    signals.push(
      `色明度 L*=${hex ? r1(hexToLab(hex).L) : '?'} → 方向 ${lightnessDir > 0 ? '+' : '-'}${Math.abs(lightnessDir)}`,
    )
  if (volume == null) missing.push('volume')

  // —— 条纹方向：只认 pattern 这一格的四个自填值，不再从商品名里找"条"字 ——
  let pattern = null
  const patField = typeof row.pattern === 'string' ? row.pattern.trim() : ''
  const pv = ownValue(GARMENT_REF.pattern_values, patField)
  if (pv != null) {
    pattern = pv
    measured.push('pattern')
    signals.push(pv > 0 ? '竖条' : '横条')
  } else {
    missing.push('pattern')
  }

  return {
    label,
    source: 'wardrobe',
    text,
    hex,
    fit_style: typeof row.fit_style === 'string' ? row.fit_style.trim() || null : null,
    fabric_weight: bulkField || null,
    garment_cm: {
      shoulder_cm: gShoulder,
      bust_cm: gBust,
      length_cm: gLength,
      waistband_cm: gWaistband,
    },
    ease,
    shoulder,
    waist,
    length,
    volume,
    pattern,
    measured,
    estimated,
    body_estimated: bodyEstimated,
    ease_src: easeSrc,
    shoulder_src: shoulderSrc,
    missing,
    fit_type: fitType,
    // 这件衣服的"实测覆盖率"：六个方向里有几个真的由填了数的格子算出来（10-19 第二阶段，
    // 打分侧按它打折——只量出一格的衣服不该和六格齐全的衣服拿一样的分）。
    // 10-19 第三阶段·模块一：版型估出来的那一维只按 **半格** 计 ⇒ 选一档版型买不到整格的分数。
    // 10-20 第五阶段·第一步：身体侧估出来的那一维同样半格；两侧都估这一轴只算 **一次** 半格
    //（`markBodyEstimated` 去重 ⇒ 0.5 不叠乘成 0.25，`13` §五 第 5 条）。
    coverage: r2(
      [
        ['shoulder', shoulder],
        ['waist', waist],
        ['ease', ease],
        ['length', length],
        ['volume', volume],
        ['pattern', pattern],
      ].reduce(
        (s, [k, v]) =>
          s +
          (v == null
            ? 0
            : bodyEstimated.includes(k)
              ? ESTIMATED_BODY_AXIS_WEIGHT
              : estimated.includes(k)
                ? ESTIMATED_AXIS_WEIGHT
                : 1),
        0,
      ) / 6,
    ),
    signals,
  }
}

// ------------------------------------------------------------
// 4. 打分：偏差向量 × 修形向量
// ------------------------------------------------------------

/** 同向=1、反向=0（抵消取均值不取乘积，免得某一维把总分打死 —— 08 §8 硬规矩 1） */
const align = (want, given) => r2(1 - Math.abs(want - given) / 2)

/** 松量：落在窗口内不扣分，越出窗口按每 6cm 掉到 0 */
function easeScore(window, ease) {
  if (!window || ease == null) return null
  const [lo, hi] = window
  const d = ease < lo ? lo - ease : ease > hi ? ease - hi : 0
  return r2(1 - clamp01(d / 6))
}

/**
 * 一件上衣对一个人的身材适配分。
 * @param {object} person 档案（含 height/weight/shoulder/bust/waist/hip/leg_length 中有的那些）
 * @param {object} top **衣柜里的一行**（要带 shoulder_cm/bust_cm/length_cm/waistband_cm 里的某几个）；
 *        传规则结论那句自由文本或 null ⇒ 四格实测都取不到 ⇒ 这一件不打分，返回 null
 * @param {object} [dev] 预先算好的偏差向量（批量排序时传进来，避免重复计算）
 * @returns {null|{score:number, axes:Array, axes_present:string[], axes_missing:string[],
 *                  measured:string[], missing_measure:string[], coverage:number,
 *                  person:object, top:object, evidence:string}}
 *          一维都凑不齐 ⇒ null（缺测不出分，不返回 0 分这种"看起来像判过"的东西）
 */
function topFitBody(person, top, dev) {
  const d = dev || bodyDeviation(person)
  const g = describeTop(top, d)
  const axes = []

  const add = (key, personVal, garmentVal, score, detail) => {
    axes.push({
      key,
      name_cn: AXIS_CN[key],
      score: score == null ? null : r2(score),
      weight: AXIS_WEIGHTS[key],
      person: personVal === undefined ? null : personVal,
      garment: garmentVal === undefined ? null : garmentVal,
      tier: AXIS_TIER[key],
      ...(detail || {}),
    })
  }

  // 每一维都写清"这个数是从哪一格算出来的"——报告与后台要能追到那一格，
  // 追不到的分就是没有依据的分（10-19 第二阶段把这条写进返回值）。
  add(
    'shoulder',
    d.want.shoulder,
    g.shoulder,
    d.want.shoulder != null && g.shoulder != null ? align(d.want.shoulder, g.shoulder) : null,
    {
      based_on:
        g.shoulder_src === 'shoulder_est'
          ? 'shoulder_cm − 净肩宽（净肩宽按身高+体重+年龄估，残差男 ≤5.5%／女 ≤7.0%），按身高换算成肩宽比百分点 ⇒ 覆盖率按半格计'
          : 'shoulder_cm − 净肩宽，按身高换算成肩宽比百分点',
      ...(g.estimated.includes('shoulder') ? { estimated: true } : {}),
    },
  )
  add(
    'waist',
    d.want.waist,
    g.waist,
    d.want.waist != null && g.waist != null ? align(d.want.waist, g.waist) : null,
    { based_on: 'waistband_cm（腰头/收口高度，0 与没填是两件事）' },
  )
  add(
    'length',
    d.want.length,
    g.length,
    d.want.length != null && g.length != null ? align(d.want.length, g.length) : null,
    { based_on: 'length_cm 对照 身高×0.40 的胯线原点（站内自建刻度）' },
  )
  add(
    'volume',
    d.want.volume,
    g.volume,
    d.want.volume != null && g.volume != null ? align(d.want.volume, g.volume) : null,
    { based_on: 'color 的 Lab 明度 + fabric_weight 自填厚薄档' },
  )

  add(
    'ease',
    d.ease_window ? d.ease_window.join('~') + 'cm' : null,
    g.ease,
    easeScore(d.ease_window, g.ease),
    {
      based_on:
        g.ease_src === 'fit_type'
          ? `版型档 ${g.fit_type} 映射的放松量区间中值（没量 bust_cm ⇒ 估的，覆盖率按半格计）`
          : g.ease_src === 'bust_est'
            ? 'bust_cm − 净胸围（净胸围按身高+体重+年龄估，残差 ≤1.93%≈±2cm）⇒ 覆盖率按半格计'
            : 'bust_cm − 净胸围（松量的实测口径）',
      ...(g.estimated.includes('ease') ? { estimated: true } : {}),
    },
  )

  // 条纹：BMI 闸门（Ashida 2013）+ 最低权重；want 为 null（BMI 没算出来）时也直接没有这一维
  const bmi = d.measure.bmi
  const stripeOn = bmi != null && bmi < BODY_REF.stripe_bmi_max
  add(
    'pattern',
    d.want.pattern,
    g.pattern,
    d.want.pattern != null && g.pattern != null && stripeOn
      ? align(d.want.pattern, g.pattern)
      : null,
    {
      based_on: 'pattern 自填值（只认 竖条/竖条纹/横条/横条纹 四个值，不从商品名里找"条"字）',
      ...(stripeOn
        ? {}
        : {
            gated:
              bmi != null
                ? `BMI ${bmi}≥${BODY_REF.stripe_bmi_max} ⇒ 按 Ashida 2013 关掉`
                : 'BMI 没算出来 ⇒ 不启用',
          }),
    },
  )

  const present = axes.filter((a) => a.score != null)
  if (present.length === 0) return null

  const wsum = present.reduce((s, a) => s + a.weight, 0)
  const raw = present.reduce((s, a) => s + a.weight * a.score, 0) / wsum
  // 先在在场轴之间归一（08 §8 硬规矩：缺测的轴不参与，不补 0），再按**实测覆盖率**整体打折。
  // 这一乘是 10-19 第三阶段·模块二补的：光靠在场轴归一，"六轴只量出一根、那根恰好满分"会归一出
  // 100 分 ⇒ 靠少填给高分。惩罚只在身体层乘这一次，排序侧不再拿覆盖率乘第二遍。
  const rawScore = Math.round(100 * raw)
  const penalty = COVERAGE_PENALTY.floor + COVERAGE_PENALTY.span * g.coverage
  const score = Math.round(rawScore * penalty)

  return {
    score,
    raw_score: rawScore,
    coverage_penalty: r2(penalty),
    axes: present,
    axes_present: present.map((a) => a.key),
    axes_missing: axes.filter((a) => a.score == null).map((a) => a.key),
    measured: g.measured,
    missing_measure: g.missing,
    coverage: g.coverage,
    person: { measure: d.measure, want: d.want, ease_window: d.ease_window, notes: d.notes },
    top: g,
    evidence:
      'B 方向(松量×BMI Liu 2006 / 深色收缩 Koutsoumpis 2021 / 肩宽侧更被偏好 Pazhoohi 2023) + C 刻度与权重(手拍,标定中)；' +
      '这一分只量"上衣往哪修、修多少"和这个人的偏差对不对得上，不是"好不好看"的判定',
  }
}

/**
 * 按身材给一摞上衣排序（衣柜里自己的上衣那条链路）。
 * @returns {{person_deviation:object, ranked:Array, unscored:number, unscored_reason:string[]}}
 */
function rankTopsByBody(person, tops) {
  const dev = bodyDeviation(person)
  const ranked = []
  const reasons = []
  for (const t of tops || []) {
    const res = topFitBody(null, t, dev)
    if (!res) {
      const name = t && t.name ? t.name : String(t).slice(0, 12)
      reasons.push(
        `${name}：肩宽/胸围/衣长/腰头高这四格一个都没填、版型那一档也没选（或这个人的净尺寸没量）⇒ 对不出任何一维，不打分`,
      )
      continue
    }
    ranked.push({
      item: t,
      label: res.top.label,
      score: res.score,
      coverage: res.coverage,
      measured: res.measured,
      axes: res.axes.map((a) => ({
        key: a.key,
        name_cn: a.name_cn,
        score: a.score,
        person: a.person,
        garment: a.garment,
      })),
      axes_present: res.axes_present,
      axes_missing: res.axes_missing,
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return { person_deviation: dev, ranked, unscored: reasons.length, unscored_reason: reasons }
}

module.exports = {
  BODY_REF,
  meas,
  easeWindowFor,
  AXIS_WEIGHTS,
  COVERAGE_PENALTY,
  FIT_TYPE_VALUES,
  FIT_TYPE_EASE,
  easeFromFitType,
  ESTIMATED_AXIS_WEIGHT,
  ESTIMATED_BODY_AXIS_WEIGHT,
  AXIS_CN,
  AXIS_TIER,
  GARMENT_REF,
  FABRIC_BULK,
  FABRIC_WEIGHT_VALUES,
  bodyDeviation,
  describeTop,
  isTopCategory,
  topFitBody,
  rankTopsByBody,
}
