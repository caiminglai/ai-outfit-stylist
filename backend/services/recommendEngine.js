/**
 * 穿搭推荐引擎
 * 从 Python app/services/recommend_engine.py + rule_engine.py 翻译
 *
 * 包含:
 * 1. getRecommendations: 旧版硬编码推荐(兼容)
 * 2. buildRecommendation: 规则引擎推荐(基础版,完整版待 Phase 3.5 实现)
 */

const db = require('../db/init')
const {
  enrichProfile,
  getBodyShapeOutfitAdvice,
  getFaceShapeGuide,
  computeColorMatch,
} = require('./profileEnricher')
const { explainMatchedRecommendation, CATEGORY_CN_TO_EN } = require('./ruleExplainer')
const {
  colorFit,
  outfitHarmony,
  extractColors,
  skinToneToLab,
  skinUndertoneFromHue,
  synthesizeSkinLab,
} = require('./colorMetrics')
const { BODY_TYPE_ALIASES } = require('./bodyTypes')
const { asText, ownValue } = require('../utils/common')
const { topFitBody, bodyDeviation, isTopCategory, FIT_TYPE_VALUES } = require('./topFitBody')
// 第十三阶段·第一步 §三：款式词／面料词 → 版型档的推断层（⛔ 值域与松量映射都在 topFitBody 那边，这里只认档）
const { inferFitType, inferFabricWeight } = require('./fitInference')
const { topSpec } = require('./topFromBody')
// 10-20 第八阶段·一e：隐性偏好乘子（只在这一层用；画像与乘子的口径全在 wearPreference.js 里）
// 参数一律从那一侧取，排序层不许自己另抄一份数（同一件事两层各持一份是本项目反复清扫的病灶）
// 🔴 10-21 第十一阶段·第一步（`docs/依据/19` §五）：进乘子的轴从两根升到四根
// （色族／版型／场合／温度档厚薄）＋复穿次数一条特判，所以这里多引两个常数与一个词表归一函数
// ——`normalizeWeatherLevel` 只认 weatherService 那五个词，⛔ 排序层不抄第二份阈值。
const {
  buildPreference,
  preferenceFactor,
  normalizeWeatherLevel,
  MIN_SAMPLES: PREF_MIN_SAMPLES,
  FACTOR_MIN: PREF_FACTOR_MIN,
  FACTOR_MAX: PREF_FACTOR_MAX,
  LIFT_TOP: PREF_LIFT_TOP,
  LIFT_SEEN: PREF_LIFT_SEEN,
  LIFT_UNSEEN: PREF_LIFT_UNSEEN,
  REPS_STEP: PREF_REPS_STEP,
  REPS_MAX: PREF_REPS_MAX,
  MULTIPLIER_AXES: PREF_MULTIPLIER_AXES,
} = require('./wearPreference')
// 10-21 第九阶段·第一步：协同过滤乘子（`docs/依据/17` §四）。与偏好乘子同层、同界、同样默认隐身：
// 库里 `item_feedback` 0 行 / 没身份 / 没体型 / `COLLAB_FILTER_ENABLED=0` ⇒ 每条恰好 ×1，名次一个字不变。
// ⛔ 它不进三维出账、不进回归自变量，只在总分末尾乘一刀（退出机制与措辞红线都在 §4.3/§4.4）。
const { buildCohortModel, collabFactor, COLLAB_CONFIG } = require('./collabFilter')
// 只取"库里这几行有没有"这个数，进 `_computed.ranking.collab.signals_in_db` 给报告与台账看
// （⛔ 它不参与任何决策：这一层读的是同组别人的分，不是"库里有多少行"）
const { countItemFeedback } = require('./itemFeedback')

/**
 * 整身呼应件的取色口径（10-20 第六阶段·第一步接线）。
 * 槽位是三个自由文本（上衣／下装／鞋）＋规则自带的结构化配色 `color_combo`。
 * 后者本来就在库里（enabled 组 167 条，扩表后现量 148 条＝88.6% 能翻出色值），
 * 改前排序层一个字都没读它，只把它当显示字段 `outfit_color` 吐给前端。
 * 四条口径：
 *  ① 每个槽位先按 `extractColors` 切多色（'深蓝 + 白 + 黑' 这种一条文案里并列三个色）；
 *  ② 同一槽位切出几件就均分这个槽位的面积（面积只是相对量，`outfitHarmony` 内部归一）；
 *  ③ ⛔ 只有明度档、没有具体色的那一条（'深色上衣'）不进呼应——两两 ΔE00 要两个 Lab，
 *     给它编一个 hex 就是喂假数（判据见 docs/依据/14 §二 L5）；
 *  ④ 同一个 hex 在多个槽位重复出现只记一次（'白 + 白' 不该自己跟自己和出一个满分呼应）；
 *     被跳过的那份面积不重新分配——combo 里与上衣重复的色本来就不该再有话语权。
 * @param {Array<{label:string,text:*,area:number}>} slots text 允许是 null／非字符串
 * @returns {Array<{label:string,color:string,area:number,relational_from?:string}>} `outfitHarmony` 直接可用的 parts
 */
function outfitColorParts(slots) {
  const parts = []
  const seen = new Set()
  for (const slot of slots) {
    let colors = extractColors(slot.text).filter((c) => c.is_specific && c.hex)
    // §二·4：本槽自己没色、但被 `resolveRelationalSlots` 认出了"跟哪一格同色" ⇒ 用那一格的色。
    // 记 `relational_from`＝被指的槽名，⛔ 冒充本槽自己写的（措辞红线见 docs/依据/21 §一）。
    // 去重那一条（口径④）会吃掉与兄弟格同 hex 的那份 ⇒ 呼应分多数时候不涨，这是**预期行为**；
    // 真正的收益在上衣侧的贴合分（见 `scoreTopColor` 的 relational 支路）。
    if (!colors.length && slot.relational && slot.relational.hex) {
      colors = [
        { hex: slot.relational.hex, label: slot.relational.label, from: slot.relational.from },
      ]
    }
    if (!colors.length) continue
    const raw = Number(slot.area)
    // 面积没填／填了 0／填了垃圾 ⇒ 按"一件小件"0.2 记账，不许 NaN 传进加权
    const slotArea = Number.isFinite(raw) && raw > 0 ? raw : 0.2
    const area = slotArea / colors.length
    for (const c of colors) {
      if (seen.has(c.hex)) continue
      seen.add(c.hex)
      parts.push({
        label: c.label,
        color: c.hex,
        area,
        ...(c.from ? { relational_from: c.from } : {}),
      })
    }
  }
  return parts
}

/**
 * 关系色就地展开（10-21 第十三阶段·第一步 §二·4）。
 * 库里 36 行文案写的是"这一格跟哪一格同色"，⛔ 没写这一格自己是什么色 ⇒
 * `extractColors` 抽不出任何东西，这一格在白吃算法缺席惩罚。这一层只做"顺着指涉词去兄弟格取色"。
 * 词表只在这四个指涉词上；⛔ 不进 `colorMetrics` 那张色名表（那张表回答"这个词是不是颜色"，
 * 这一层回答"这一格把色指向哪一格"，两件事两处真相源）。
 */
const RELATIONAL_WORDS = ['同色系', '同色', '一致', '呼应']
// 名词 → 槽 label，数组顺序＝命中多个名词时的优先级（先鞋后包再下装最后上衣；'上下' 先抹掉）
const RELATIONAL_NOUN_TO_SLOT = [
  [/鞋|靴/, '鞋'],
  [/包/, '包'],
  [/裤|裙|下装|下半/, '下装'],
  [/上衣|上装|外套|内搭/, '上衣'],
]

/**
 * 关系色展开的收口账（§二·4）：把"哪一格只写了跟谁同色、取的是哪个色"压成一个中文字符串。
 * 没展开任何格 ⇒ 回 `null`（⛔ 不许写一个空串字段进输出，默认路径要逐字节不变）。
 * @param {Array} resolvedSlots `resolveRelationalSlots` 的返回
 * @returns {string|null}
 */
function relationalLedger(resolvedSlots) {
  const list = (resolvedSlots || []).filter((s) => s && s.relational)
  if (!list.length) return null
  return list.map((s) => `${s.label}←${s.relational.from}(${s.relational.label})`).join('、')
}

/**
 * 这句话把色指向哪几格。
 * 🔴 先剔掉"说的就是本槽自己"的那个名词：'同色西裤' 写在**下装**那一格时，名词是 裤＝本槽，
 * 真正指的对象是与之同色的**另一件**（这一句里就是上衣）。⛔ 不剔就会把"自指"当成目标然后跳过，
 * 库里 id=1102/1224 那两条「同色西裤」正是这样漏掉的（现量见 docs/依据/21 §十二）。
 * 剔完没名词了 ⇒ 默认指向 `上衣`（'上下同色系'／'同色系穿搭' 这类，说的就是"跟上衣一个色系"）；
 * 但本槽已经是上衣时不回指自己 ⇒ 回 `[]`（'深色外套+同色内搭' 那句的对面还是上衣，没量分支）。
 * @param {string} text 本槽文案
 * @param {string} [ownLabel] 本槽 label，传了就剔除自指
 * @returns {string[]} 槽 label 列表（按优先级），无法展开时回 []
 */
function relationalTargetsOf(text, ownLabel) {
  const s = String(text === null || text === undefined ? '' : text)
  if (!RELATIONAL_WORDS.some((w) => s.includes(w))) return []
  // '上下' 是一个词组（说"上衣与下装之间"），⛔ 拆成"下"再当成向"下装"的点名
  const body = s.replace(/上下/g, '')
  const hits = []
  for (const [re, label] of RELATIONAL_NOUN_TO_SLOT) {
    if (re.test(body) && label !== ownLabel) hits.push(label)
  }
  if (hits.length) return hits
  return ownLabel === '上衣' ? [] : ['上衣']
}

/**
 * 把槽数组里"只有关系、没有颜色"的那几格补上被指格的**第一个具体色**。
 * 三条闸门（全部按 §二·4 落，⛔ 任一不满足就当没这回事）：
 *  ① 被指那一格自己抽不出具体色 ⇒ 不补（没量分支，⛔ 拿明度档冒充）；
 *  ② 只解一层：只读被指格**自己写的**文案，⛔ 读它展开出来的色 ⇒ A 指 B、B 又指 A 时两侧都不补；
 *  ③ 本槽自己已经有色 ⇒ 不补（否则同一件衣服两个色，呼应侧会双计）。
 * 补不上的格子原样返回，⛔ 不新增字段 ⇒ 默认路径逐字节不变。
 * @param {Array<{label:string,text:*}>} slots
 * @returns {Array<{label:string,text:*,relational?:{from:string,hex:string,label:string,source:string}}>}
 */
function resolveRelationalSlots(slots) {
  const list = Array.isArray(slots) ? slots.filter(Boolean) : []
  if (list.length < 2) return list
  const specificOf = (t) => extractColors(t).filter((c) => c.is_specific && c.hex)
  return list.map((slot) => {
    const text = String(slot.text === null || slot.text === undefined ? '' : slot.text)
    if (!text.trim() || slot.relational) return slot
    const targets = relationalTargetsOf(text, slot.label)
    if (!targets.length) return slot
    if (specificOf(text).length) return slot // 闸门③
    for (const label of targets) {
      if (label === slot.label) continue // 自指（'深色外套+同色内搭' 那种）不展开
      const sib = list.find((x) => x.label === label)
      if (!sib) continue
      const own = String(sib.text === null || sib.text === undefined ? '' : sib.text)
      const cols = specificOf(own)
      if (!cols.length) continue // 闸门①（＋②：只读 sib.text）
      return {
        ...slot,
        relational: { from: label, hex: cols[0].hex, label: cols[0].label, source: own },
      }
    }
    return slot
  })
}

/**
 * 本组配色串里的**第一个具体色**（10-21 第十三阶段·第一步 §二·3，你拍的板＝"借第一色＋降权＋标出处"）。
 * 上衣那一格认不出任何具体色值时，才拿同一条 recommendation 的 `color_combo`（兜底那条是
 * `outfit_color`，'白+蓝' 这种）的第一个具体色当上衣色用。
 * 三条口径：
 *  ① 只认 `is_specific && hex` 的那几个 ⇒ 工艺词（牛仔／水洗／迷彩）与"深色"这种明度档**不算色**，
 *     拿它们借色就是喂假数（同 §二·1、同硬规矩 2）；
 *  ② 借的是它**在串里的位置**，⛔ 不挑一个"最好看的"：`position` 记它在 `extractColors` 切出来的
 *     全部条目里排第几（从 1 数）。所以 '深色+米+灰' 借到的是 米、`position=2`，
 *     前台要问"凭什么用米色"时这一格能拆账；
 *  ③ 串里一个具体色都没有 ⇒ 回 `null`，这一维继续缺席，照旧吃 `RANK_ALGO_ABSENCE_PENALTY`。
 * @returns {null|{hex:string,label:string,position:number,source:string}}
 */
function firstSpecificColor(comboText) {
  const src = String(comboText === null || comboText === undefined ? '' : comboText)
  if (!src.trim()) return null
  const all = extractColors(src)
  let position = 0
  for (const c of all) {
    position++
    if (c.is_specific && c.hex) return { hex: c.hex, label: c.label, position, source: src }
  }
  return null
}

/**
 * 上衣这一格与肤色的贴合分，外加"借色"那一条支路（§二·3 的唯一实现处，两条候选路径共用）。
 * 判据只有一把尺子：**先用上衣原文算一次 `colorFit`**——它回 `null`（什么色都没认出来）或
 * 回 `basis='lightness-band'`（只认出了深浅档）时，才算"上衣没写色"，此时才允许借。
 * ⚠️ 不在这里另起一套"有没有色"的判断（比如直接问 `resolveColor`）：那把尺子会把工艺词
 *    '牛仔短裤' 读成有 hex，而 `colorFit` 已经拒绝给它出分，两套判据迟早又打一次架（`14` §9.7 那类账）。
 * 借来时以具体色为准，但⛔ 不抹掉原句那一档 ⇒ `color_top_band` 留痕（"basis 记两笔"）。
 * 借来的色**只喂衣服 vs 脸这一侧**，⛔ 不追加进 `outfitColorParts`：那条串本来就已经是呼应侧的
 * 第 4 个槽，再补一遍就是重复计权（`outfitColorParts` 口径④）。
 *
 * §二·4 的 `relational` 支路排在本条**前面**：上衣写的是"与鞋同色"时，鞋那一格写的就是这件上衣
 * 该对的颜色，比"整套配色串的第一个色"更贴这句话 ⇒ 先按被指格取色，取不到才退到配色串第一色。
 * 两条支路都算"不是这一格自己写的色" ⇒ 共用同一个 `color_borrowed` 打折闸门（`COLOR_BORROW_WEIGHT`）。
 * @param {object|null} skinLab 肤色 Lab（拿不到时 colorFit 自己回 null）
 * @param {string|null} topText 上衣那格的自由文本
 * @param {Array} harmonyParts 已经算好的呼应件（借色不许往里加）
 * @param {string|null} comboText 本组配色串原文
 * @param {{hex:string,label:string,from:string,source:string}|null} relational §二·4 展开出来的被指格色
 * @returns {{fit:object|null,harmony:object|null,source:string|null,borrowed:boolean,borrowed_from:string|null,borrowed_position:number|null,top_band:string|null,color_parts:number,relational_from:string|null}}
 */
function scoreTopColor(skinLab, topText, harmonyParts, comboText, relational) {
  const harmony = outfitHarmony(harmonyParts)
  const harmonyArg = harmony ? harmony.score : null
  const direct = colorFit(skinLab, topText, { harmony: harmonyArg })
  const noSpecificColor = !direct || direct.basis === 'lightness-band'
  const topBand = direct && direct.basis === 'lightness-band' ? direct.top_label : null
  const borrow = noSpecificColor && !relational ? firstSpecificColor(comboText) : null
  if (noSpecificColor && relational && relational.hex) {
    return {
      fit: colorFit(skinLab, relational.hex, { harmony: harmonyArg }),
      harmony,
      source: 'relational',
      borrowed: true,
      borrowed_from: relational.source,
      borrowed_position: null, // 被指格不是"串里第几个"那种次序，出处拆账走 relational_from
      top_band: topBand,
      color_parts: harmonyParts.length,
      relational_from: relational.from,
    }
  }
  if (!borrow) {
    return {
      fit: direct,
      harmony,
      // 没借到：原文认得出具体色 ⇒ top_text；只认得出深浅档 ⇒ lightness_band；什么都没认出来 ⇒ null
      source: direct ? (direct.basis === 'lightness-band' ? 'lightness_band' : 'top_text') : null,
      borrowed: false,
      borrowed_from: null,
      borrowed_position: null,
      top_band: null,
      color_parts: harmonyParts.length,
      relational_from: null,
    }
  }
  const borrowedFit = colorFit(skinLab, borrow.hex, { harmony: harmonyArg })
  return {
    fit: borrowedFit,
    harmony,
    source: 'combo_first',
    borrowed: true,
    borrowed_from: borrow.source,
    borrowed_position: borrow.position,
    // 借到具体色时以具体色为准，但原句那一档要留痕：'深色上衣' 借来 米 之后，
    // 报告与后台还得能说清"这句话自己只写了深浅"。
    top_band: topBand,
    color_parts: harmonyParts.length,
    relational_from: null,
  }
}

/**
 * 规则那句文案 → 身体那一维的分（10-21 第十三阶段·第一步 §三·4 的唯一接线处）。
 * 做法＝认出版型档 ⇒ 造一条**只带 `fit_type` 与 `fabric_weight` 两件**的伪上衣行 ⇒
 * 调现成的 `topFitBody(null, 伪行, bodyDev)`（与衣橱那一路同一个调用形状：person 传 null、dev 传现算的那份）。
 * 松量走的是 `ease_src:'fit_type'` 那条已有分支，**"这一格按半格计覆盖率"是 `topFitBody` 自己给的**，
 * ⛔ 排序层不再乘第二个折扣（同一件事两层各折一次＝上面 `COLOR_BORROW_WEIGHT` 那条禁令）。
 * 认不出档（0 档或 ≥2 档冲突）⇒ 回 `null`，这一维继续整块缺席、继续吃 `RANK_ALGO_ABSENCE_PENALTY`，
 * ⛔ 不许为了"让身体维在场"放宽判据（§三·3 第 2 条）。
 * @param {string|null} topText 上衣那一格的文案
 * @param {object} bodyDev 这个人的身材偏差（`bodyDeviation(enriched)` 的返回值）
 * @returns {null|{body_fit:object, fit_type:string|null, fabric_weight:string|null, words:{fit:string[],fabric:string[]}}}
 */
function ruleTextBodyFit(topText, bodyDev) {
  const fit = inferFitType(topText)
  const fab = inferFabricWeight(topText)
  if (!fit && !fab) return null
  const pseudo = {
    name: String(topText === null || topText === undefined ? '' : topText).slice(0, 40),
    fit_type: fit ? fit.fit_type : null,
    fabric_weight: fab ? fab.fabric_weight : null,
  }
  const bf = topFitBody(null, pseudo, bodyDev)
  // 只有面料档、六轴一格都算不出 ⇒ topFitBody 给的总分是 null ⇒ 缺测不出分，这一维照样缺席
  if (!bf || bf.score == null) return null
  bf.inferred_from = 'rule_text'
  bf.inferred_words = { fit: fit ? fit.words : [], fabric: fab ? fab.words : [] }
  return {
    body_fit: bf,
    fit_type: pseudo.fit_type,
    fabric_weight: pseudo.fabric_weight,
    words: bf.inferred_words,
  }
}

/**
 * 获取穿搭推荐
 * @param {string|null} skinTone - 肤色
 * @param {string|null} faceShape - 脸型
 * @param {string} scenario - 场景
 * @returns {Array} 推荐结果列表
 */
function getRecommendations(skinTone, faceShape, scenario) {
  const defaults = {
    通勤: [
      {
        top_style: '白色衬衫',
        bottom_style: '深色西裤',
        color_combo: '白+蓝',
        reason: '简洁干练,职场必备',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '针织开衫',
        bottom_style: '直筒裤',
        color_combo: '米+灰',
        reason: '温柔知性,通勤百搭',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '西装外套',
        bottom_style: '铅笔裙',
        color_combo: '黑+灰',
        reason: '专业大气,会议首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    约会: [
      {
        top_style: 'V领碎花裙',
        bottom_style: '',
        color_combo: '浅粉+白',
        reason: '甜美浪漫,约会首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '修身针织衫',
        bottom_style: 'A字裙',
        color_combo: '白+杏',
        reason: '优雅温柔,展现气质',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    面试: [
      {
        top_style: '翻领大衣',
        bottom_style: '西裤',
        color_combo: '灰+黑',
        reason: '专业稳重,面试首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '衬衫',
        bottom_style: '直筒裙',
        color_combo: '白+深蓝',
        reason: '简洁大方,给人信赖感',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    休闲: [
      {
        top_style: '圆领T恤',
        bottom_style: '牛仔裤',
        color_combo: '白+蓝',
        reason: '舒适百搭,日常首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '卫衣',
        bottom_style: '运动裤',
        color_combo: '灰+黑',
        reason: '休闲舒适,轻松自在',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    聚会: [
      {
        top_style: '亮片上衣',
        bottom_style: '高腰裙',
        color_combo: '金+黑',
        reason: '闪耀吸睛,聚会焦点',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '修身连衣裙',
        bottom_style: '',
        color_combo: '酒红+黑',
        reason: '优雅大气,派对首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
  }

  // scenario 来自请求体（buildRecommendation 里是 profile.scenario），
  // 写 defaults[scenario] 时 scenario='constructor' 会拿到 Object 构造函数，
  // 调用方 `for (const item of fallback)` 立刻 TypeError ⇒ 推荐接口回 500。
  const fallbackList = ownValue(defaults, asText(scenario)) || ownValue(defaults, '休闲')
  return fallbackList
}

// ============================================================
// 规则引擎推荐(基础版)
// 从 Python app/services/rule_engine.py build_recommendation() 翻译
// 完整版(含 enrich_profile / algorithm_analysis)待 Phase 3.5 实现
// ============================================================

// 推荐类别常量
const CATEGORIES = ['穿搭', '妆容', '发型', '配饰', '姿势']

/**
 * 解析规则条件的 value(JSON 字符串)
 */
function parseConditionValue(rawValue) {
  try {
    return JSON.parse(rawValue)
  } catch {
    return rawValue
  }
}

/**
 * 场合别名 → 规范场合
 * 库里有 9 组 personal 规则把 scenario 写成表单原始选项(上班通勤/约会聚会/派对),
 * 而运行时 profile.scenario 已被 profileEnricher 的 OCCASION_TO_SCENARIO 归一成 通勤/约会/聚会,
 * 导致这些规则从写下起永远命中不了。SQL 预筛和条件评估都按这张表放宽一次。
 */
const SCENARIO_ALIASES = {
  通勤: ['上班通勤'],
  约会: ['约会聚会'],
  聚会: ['派对'],
}

// 反转成 别名 → 规范值,给下面的条件值归一用
const SCENARIO_ALIAS_TO_CANON = {}
for (const [canon, list] of Object.entries(SCENARIO_ALIASES)) {
  for (const alias of list) SCENARIO_ALIAS_TO_CANON[alias] = canon
}

/**
 * 条件值别名 → 规范值
 * 种子数据里"姿势"类规则的条件值有两种写法:
 * store 模式 8 组写 posture、personal 模式 8 组写 pose,
 * 而 matchRules 用 CATEGORY_CN_TO_EN 把中文类别统一翻成 posture,
 * 导致 pose 那 8 组(拍照姿势)永远匹配不上。这里做一次归一。
 *
 * body_type 同一种病:库里 {"body_type":"苹果形"} 4 条(组 199/200/206/207)与引擎出的
 * 「苹果型」差一个字,从写下起一次没命中过(10-19 现量,判据见 services/bodyTypes.js 文件头)。
 * 归档词表在 bodyTypes.js,这里把规则侧的存值也归一到那张表——两侧同一把尺子,
 * 迁移脚本(db/migrate_body_type_wording.js)跑与不跑都不再决定这 4 组规则生不生效。
 */
const COND_VALUE_ALIASES = {
  category: { pose: 'posture' },
  scenario: SCENARIO_ALIAS_TO_CANON,
  body_type: BODY_TYPE_ALIASES,
}

/** 检查单个条件是否命中 */
function checkSingleCondition(condition, profile) {
  const parsed = parseConditionValue(condition.value)
  const field = condition.field
  const operator = condition.operator

  // 两处取值都不许顺原型链：condition.field 是库里的自由 TEXT，
  // 一行写成 'constructor' 时 `profile['constructor']` 拿到的是 Object 函数而不是"没填"，
  // 后面所有 String() 比较都拿它当档案值；`field in parsed` 同样会把继承键当成条件值。
  // ownValue 认不出继承键 ⇒ 一律当缺测，与"这个字段顾客没填"同一口径。
  const profileVal = ownValue(profile, field)

  // 从 parsed 中取出匹配值
  let condVal
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    ownValue(parsed, field) !== undefined
  ) {
    condVal = ownValue(parsed, field)
  } else {
    condVal = parsed
  }

  // 别名归一(pose → posture 等)
  const alias = ownValue(COND_VALUE_ALIASES, field)
  if (alias && typeof condVal === 'string') {
    const mapped = ownValue(alias, condVal)
    if (mapped) condVal = mapped
  }

  // "all" 表示不限,始终命中
  if (condVal === 'all') return true

  // profile 中该字段为空时,只有 "all" 才能命中。
  // 空串（表单留空、门店端没录）也必须算空：否则 ne 条件的 `'' !== '无'` 恒真，
  // 库里 allergy_metal ne "无" 这一条会给"没填过敏史"的人当成"有过敏"，凭空推无镍饰品。
  if (profileVal === null || profileVal === undefined) return false
  if (typeof profileVal === 'string' && profileVal.trim() === '') return false

  if (operator === 'eq') {
    return String(profileVal) === String(condVal)
  } else if (operator === 'in') {
    let valList = condVal
    if (typeof valList === 'string') {
      try {
        valList = JSON.parse(valList)
      } catch {
        valList = [valList]
      }
    }
    if (!Array.isArray(valList)) valList = [valList]
    // 兼容逗号/顿号分隔的字符串写法(如 "小麦色,古铜色")
    valList = valList
      .flatMap((v) => (typeof v === 'string' ? v.split(/[、,，]/) : [v]))
      .map((v) => String(v).trim())
      .filter(Boolean)
    return valList.some((v) => String(v) === String(profileVal))
  } else if (operator === 'ne') {
    return String(profileVal) !== String(condVal)
  }

  return false
}

/**
 * 评估一个规则组是否全部命中
 * 返回 [是否命中, 总分, 条件详情列表]
 *   条件详情: { field, operator, value, matched, explanation }
 *   matched=true 表示该条件命中,false 表示未命中
 *   explanation 是 ruleExplainer 翻译的中文描述
 */
function evaluateGroup(group, conditions, profile) {
  if (!conditions || conditions.length === 0) {
    return [true, 0, []]
  }

  let scoredWeight = 0
  let allMatched = true
  const details = []

  for (const cond of conditions) {
    const matched = checkSingleCondition(cond, profile)
    if (matched) {
      // 权重必须收成一个数。weight 列是自由 TEXT：原来 `cond.weight || 1` 只挡 falsy，
      // 'abc' 是 truthy 就一路加进 scoredWeight ⇒ NaN，比较器 `b.score - a.score` 回 NaN
      // （排序退化成"按数据库返回序"），而 JSON.stringify 把 NaN 打成 null，
      // 顾客报告里的"匹配分"直接变 null。另外 weight=0 是合法的"不计分软信号"，
      // 原来被 `|| 1` 抬成 1 分。0 合法 ⇒ 判据只能是"是不是有限数"，不能是 truthy。
      const w = Number(cond.weight)
      scoredWeight += Number.isFinite(w) && w >= 0 ? w : 1
    } else {
      allMatched = false
    }
    details.push({
      field: cond.field,
      operator: cond.operator,
      value: cond.value,
      matched,
    })
  }

  return [allMatched, scoredWeight, details]
}

/**
 * S5（10-19 蓝图短期项，10-23 落）：把一批命中规则组的计数一次写库。
 * 改前每条命中各发一条 `UPDATE … WHERE id = ?` 并重新 prepare，一场 11~14 次写（§3.4 结论二）。
 * 统计列写失败⛔ 不许影响推荐本体——catch 后 warn，与改前同一把尺子。
 * ⛔ 别把它扩成"定时队列"：现在同请求内落库，比蓝图允许的分钟级延迟更强一致，
 *    测试里断言的"领取重放不抬计数"（incrementHitCount=false 那一路）也因此照旧成立。
 * @param {number[]} ids
 * @returns {number} 实际写库的组数
 */
function _flushHitCounts(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const uniq = [...new Set(ids)]
  try {
    db.prepare(
      `UPDATE rule_groups SET hit_count = hit_count + 1, last_hit_at = datetime('now') WHERE id IN (${uniq
        .map(() => '?')
        .join(',')})`,
    ).run(...uniq)
    return uniq.length
  } catch (err) {
    console.warn(`[推荐引擎] 批量命中计数写入失败（${uniq.length} 组）: ${err.message}`)
    return 0
  }
}

/**
 * 匹配规则并打分
 * @param {object} profile - 顾客数据
 * @param {string} mode - 推荐模式 store/personal
 * @param {string|null} category - 推荐类别
 * @param {boolean} incrementHitCount - 是否累加命中次数
 * @param {Array<number>=} hitCollector - S5（10-23）：给了就把命中 id 攒进去、由调用方一次批量落库；
 *                                       不给（外部四参直调、喂源码工装）就本批就地一次写。
 * @returns {Array} 命中的规则组列表
 */
function matchRules(
  profile,
  mode = 'store',
  category = null,
  incrementHitCount = true,
  hitCollector = null,
) {
  // 构建查询
  // mode='all' 表示门店与个人通用(第二批色彩/比例类规则不分两套口径)
  let query = "SELECT * FROM rule_groups WHERE enabled = 1 AND (mode = ? OR mode = 'all')"
  // mode / gender / scenario 都是从请求体一路传下来的自由值：对象、数组绑进 SQL
  // 是 RangeError/TypeError ⇒ 整个推荐接口回 500，而它本该只是"这个筛选项没匹配上"。
  // 统一过 asText（非文本当没填），认不出的值仍按原口径只命中 mode='all' 的规则。
  const params = [asText(mode) || 'store']

  // 按 gender 筛选
  const gender = asText(profile.gender)
  if (gender) {
    query += ' AND (gender = ? OR gender IS NULL)'
    params.push(gender)
  }

  // 按 scenario 筛选(姿势类按拍照场景分档,优先用 photo_scene)
  const scenarioRaw =
    category === '姿势'
      ? asText(profile.photo_scene) || asText(profile.scenario)
      : asText(profile.scenario)
  // 先归一成规范值，再拿它去预筛。原来这里直接用原始值：
  // 顾客传 scenario='上班通勤' 时 aliases=SCENARIO_ALIASES['上班通勤']=undefined ⇒ 只放进
  // scenario='上班通勤' 那 3 组（10-13 现量线上：group.scenario 写成别名的共 10 行，
  // 上班通勤 3／约会聚会 4／派对 3），而这 3 组的条件值同样写 '上班通勤'，
  // 到 checkSingleCondition 里被归成 '通勤' 再和 profile 的 '上班通勤' 比 ⇒ 不等，
  // 于是这一路一条都不命中，整屏退回硬编码的"休闲"套。归一放在入口，两侧才是同一把尺子。
  const scenarioKey = ownValue(SCENARIO_ALIAS_TO_CANON, scenarioRaw) || scenarioRaw
  if (scenarioKey) {
    // 别名一起放行:老规则里把场合写成表单原始选项的,归一后会对不上 SQL 预筛
    // ownValue：scenarioKey 是自由文本，'toString' 这类原型键会查出函数，
    // 下一行的 `...aliases` 展开函数直接 TypeError ⇒ 推荐接口 500。
    const aliases = ownValue(SCENARIO_ALIASES, scenarioKey) || []
    query += ` AND (scenario IS NULL OR scenario = ?${' OR scenario = ?'.repeat(aliases.length)})`
    params.push(scenarioKey, ...aliases)
  }

  // 按 category 筛选
  if (category) {
    query += ' AND category = ?'
    params.push(category)
  }

  const groups = db.prepare(query).all(...params)

  if (groups.length === 0) return []

  // 批量加载所有相关 conditions 和 actions(避免 N+1 查询)
  const groupIds = groups.map((g) => g.id)
  const placeholders = groupIds.map(() => '?').join(',')
  const allConditions = db
    .prepare(`SELECT * FROM rule_conditions WHERE group_id IN (${placeholders})`)
    .all(...groupIds)
  const allActions = db
    .prepare(`SELECT * FROM rule_actions WHERE group_id IN (${placeholders}) ORDER BY sort_order`)
    .all(...groupIds)

  // 按 group_id 分组
  const conditionsByGroup = {}
  for (const c of allConditions) {
    ;(conditionsByGroup[c.group_id] ||= []).push(c)
  }
  const actionsByGroup = {}
  for (const a of allActions) {
    ;(actionsByGroup[a.group_id] ||= []).push(a)
  }

  // 逐组评估
  const matched = []
  // S5（10-19 蓝图短期项，10-23 落）：命中先记在内存里，评估完一次批量落库。
  // 改前每命中一条就同步 UPDATE 一次且每次重新 prepare，一场 11~14 次写（§3.4 结论二现量）。
  const hitIds = []
  for (const group of groups) {
    const conditions = conditionsByGroup[group.id] || []

    // 把 rule_groups.category(中文) 转成英文,与规则条件 category 值(outfit)对齐
    // 修复 bug:之前赋中文 '穿搭' 导致 category 条件永远不匹配,规则引擎从未真正工作
    // scenario 同样用 scenarioKey,保证 SQL 预筛与条件评估用同一个口径(姿势类走 photo_scene)
    const evalProfile = {
      ...profile,
      scenario: scenarioKey,
      category: ownValue(CATEGORY_CN_TO_EN, group.category) || group.category,
    }
    const [hit, score, conditionDetails] = evaluateGroup(group, conditions, evalProfile)

    if (hit) {
      // 使用预加载的 actions
      // 必须用无原型对象：action_type 是库里的自由 TEXT，一行 'x' 写成 __proto__ 时，
      // `actions['__proto__'] = content` 改的是原型而不是自有键 ⇒ 这条动作文案静默消失，
      // 推荐结果和文字报告里都少一项，且不报错、日志无痕。
      const actions = Object.create(null)
      for (const action of actionsByGroup[group.id] || []) {
        actions[action.action_type] = action.content
      }

      // 顾客反馈微调:一条好评 +1、一条不准 -1,最多影响 ±3 分
      // 没收到反馈的规则 feedback=0,分数与排序跟改动前完全一样
      const feedback = Math.max(
        -3,
        Math.min(3, (group.feedback_up || 0) - (group.feedback_down || 0)),
      )

      matched.push({
        group_id: group.id,
        group_name: group.name,
        category: group.category,
        scenario: group.scenario,
        priority: group.priority || 0,
        score: score + feedback,
        feedback,
        // 依据分档 A/B/C/D；NULL＝未标注，展示端按 C 对待（见 services/evidenceLevels.js）
        evidence_level: group.evidence_level ?? null,
        actions,
        // 命中条件详情(含每个条件的命中状态,供生成可解释性说明)
        condition_details: conditionDetails,
      })

      // 累加命中次数（S5，10-23 落）：这里不再逐条 UPDATE——先攒进 hitIds，
      // 出循环后按"有没有 collector"决定本批就地一次写、还是交给 buildRecommendation 跨品类合并写。
      if (incrementHitCount) hitIds.push(group.id)
    }
  }

  // 排序:priority 降序,score 降序,最后按 id 升序兜底。
  // 前两级之后还剩多少并列，10-13 现量线上：enabled=1 的组里 priority=25 就有 79 组、
  // priority=5 有 76 组，而同一个 mode+category+priority 键下最多 68 组同分 ⇒
  // 只排两级时，并列的先后完全由 SELECT 的返回序决定（这条 SQL 没有 ORDER BY），
  // 而报告端只取前 3 条 ⇒ 重建一次库、top3 可能整体换人。id 兜底把顺序定死成建规先后。
  matched.sort((a, b) => b.priority - a.priority || b.score - a.score || a.group_id - b.group_id)

  // S5 落库点①：无人代收时本批一次写完（净效果与改前逐条写相同：每条命中 hit_count+1）。
  if (incrementHitCount) {
    if (Array.isArray(hitCollector)) hitCollector.push(...hitIds)
    else _flushHitCounts(hitIds)
  }

  return matched
}

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

/**
 * 肤色进色彩维的**唯一**取值口（第十阶段·第一步，docs/依据/18-肤色采集输入输出规范-20261021.md §2.5）。
 *
 * 为什么要收成一个（现量，10-21）：改前这里有四个各自拼字符串的读数点
 * （`:1047`/`:1096`/`:1128` 三处喂 `colorFit`，`:1072` 一处喂硬编码兜底），
 * 谁再新增第五处就会多一套口径；而第九阶段那条唯一真样本正是死在这条链的第一环——
 * `face_profiles` 里 `user_id=3` 那行肤色两格逐字 NULL ⇒ `colorFit(null, …)` 回 null ⇒
 * 快照 `color:null` ⇒ 二维回归闸门到不了（`17` §9.4）。
 *
 * 🔴 三条不许改的口径：
 *  ① **深浅（L 与 C）只认档名锚点，⛔ 不吃照片的绝对明度**。合成 Lab 的 L/C 一律取自
 *     `SKIN_TONE_ANCHORS`（10-29 起升 B 档：CIE 汇编华裔 404 人分位子样实测，仍非测色仪逐人实测），照片只贡献色相角 h。
 *     理由＝Alipour 2026 实测非受控成像下固定阈值分型 22.9% ＜ 基线 51.3%（`依据/02` §2 第 4 条），
 *     现量反例：`#E8C4B8` 经 `hexToLab` 得 L=81.89，比华裔 P95＝65.87 高 16 个点（`依据/04` §1.4）。
 *     ⛔ 更不许拿人群 P50（L 58.58／C 20.61）去补一个"看起来像实测"的明度——
 *     那是 `docs/依据/README.md:64` 硬规矩 2 逐字禁止的动作。
 *  ② **深浅档没选 ⇒ 照片那一维不接管**（`source` 永远不等于 `photo_sample`）。
 *     用户只确认冷暖、深浅留空时照样出分：`冷皮/自然/暖皮` 三个词本身就在这张 8 档表里。
 *  ③ 三样都拿不到 ⇒ 返回 `lab:null`，调用方把 null 原样交给 `colorFit` ⇒ 它回 null ⇒
 *     色彩维缺席（缺测不出分），⛔ 不在这里编一个肤色。
 *
 * @param {object} enriched enrichProfile 之后的画像（含档案回填的档名）
 * @param {object} profile 本次请求体原样（`skin_hue` 只可能从这里来，客户端递不进 Lab）
 * @returns {{lab:{L:number,a:number,b:number,C:number,h:number}|null, source:string|null, hue:number|null, undertone:string|null}}
 */
function _skinForColor(enriched, profile) {
  const toneText = enriched.skin_tone_detail || enriched.skin_tone || profile.skin_tone || null
  const depth = skinToneToLab(toneText)
  // SKIN_TONE_ANCHORS 的取值只有 L/a/b（C 是 colorFit 内部现补的），这里同样先算出来再合成，
  // ⛔ 但绝不把 C 写回那张共享表——它是模块级常量，写一次污染之后每一次取色。
  const depthLab = depth ? { L: depth.L, a: depth.a, b: depth.b } : null
  const depthC = depthLab ? Math.hypot(depthLab.a, depthLab.b) : null

  const rawHue = profile.skin_hue !== undefined ? profile.skin_hue : enriched.skin_hue
  const hue = Number(rawHue)
  // 闸门全在 synthesizeSkinLab 里（非有限数／越过 h 闸／档名认不出 ⇒ null），这里不再自己拼条件。
  const synth = synthesizeSkinLab(toneText, hue)
  if (synth)
    return { lab: synth.lab, source: 'photo_sample', hue: synth.lab.h, undertone: synth.undertone }

  return {
    lab: depthLab ? { ...depthLab, C: depthC } : null,
    source: depthLab ? 'manual' : null,
    hue: Number.isFinite(hue) && skinUndertoneFromHue(hue) !== null ? hue : null,
    undertone: Number.isFinite(hue) ? skinUndertoneFromHue(hue) : null,
  }
}

/**
 * 构建完整的推荐结果
 * @param {object} profile - 顾客数据
 * @param {string} mode - 推荐模式 store/personal
 * @param {boolean} incrementHitCount - 是否累加命中次数
 * @param {{sessionId?:string, userId?:number}|null} [identity] - 这个人的身份（第八阶段·一e）。
 *   只用来现算**隐性偏好画像**（穿搭日记 → ±5% 乘子）。⛔ 默认 null＝不查库、乘子恒为 1；
 *   传了身份但日记 0 行也一样是 1（「零样本零影响」那条断言，见 docs/依据/16 §五）。
 * @param {object} [opts] 第十二阶段·第一步（docs/依据/20 §五）的出账开关。⛔ 默认 {}＝与四参数时代逐字节相同，
 *   这条由 `recommendEngine.test.js` 里"默认路径逐字节不变"那一块锁住。两个键：
 *   `deep_analysis` 让 store 档也填 `algorithm_analysis`（**只放开出账，⛔ 绝不改 mode**：
 *     `matchRules` 按 mode 过滤规则（见上面 `:402` 那句 SQL），换模式＝换名单，那会让付费报告
 *     与顾客免费时看到的那 8 条对不上——那是假承诺，比少发一节严重得多）；
 *   `keep_ranked_out` 把被 Top N 截掉的那一尾投影进 `_computed.ranking.beyond_top_n`。
 * @returns {object} 按类别分组的推荐结果
 */
function buildRecommendation(
  profile,
  mode = 'store',
  incrementHitCount = true,
  identity = null,
  opts = {},
) {
  // 1. 画像增强:计算 BMI、体型、腰臀比、肤色匹配、脸型建议等
  const enriched = enrichProfile(profile)
  // 肤色进色彩维的唯一读数口（第十阶段·第一步，docs/依据/18 §2.5）：整次推荐只解一次，
  // 下面三处 colorFit 全用这一个值，⛔ 不许再在别处拼 skin_tone 字符串。
  const skinColor = _skinForColor(enriched, profile)
  // 身材偏差向量整次推荐只算一次(topFitBody 只吃连续量,不吃 body_type 这类离散标签)
  const bodyDev = bodyDeviation(enriched)

  const result = {
    穿搭: [],
    妆容: [],
    发型: [],
    配饰: [],
    姿势: [],
    _mode: mode,
    _computed: {},
    algorithm_analysis: null,
  }

  // 2. 填充 _computed(供前端展示数据概览)
  if (enriched.bmi) {
    result._computed.bmi = enriched.bmi
    result._computed.bmi_level = enriched.bmi_level
  }
  if (enriched.body_shape) {
    result._computed.body_shape = enriched.body_shape
    result._computed.body_shape_key = enriched.body_shape_key
  }
  if (enriched.wh_ratio) {
    result._computed.wh_ratio = enriched.wh_ratio
    result._computed.wh_status = enriched.wh_status
  }
  if (enriched.leg_ratio) {
    result._computed.leg_ratio = enriched.leg_ratio
  }
  if (enriched.shoulder_ratio) {
    result._computed.shoulder_ratio = enriched.shoulder_ratio
  }
  if (enriched.color_match) {
    result._computed.color_match = enriched.color_match
    result._computed.color_avoid = enriched.color_avoid
  }
  // 肤色那一维"是从哪来的"要能拆账（第十阶段·第一步，docs/依据/18 §2.4）。
  // ⛔ 这三格只拆账：不是置信度、不进任何公式、也⛔ 不进回归自变量（18 §三 第 8 条）。
  //    skin_source 只有 photo_sample / manual / null 三种取值——改前规范写的第四种
  //    'archive' 在引擎里判不出来（档案合并发生在 routes/recommend.js，到这儿已经分不开），
  //    这笔订正记在 18 §九。
  result._computed.skin_source = skinColor.source
  result._computed.skin_hue = skinColor.hue
  result._computed.skin_undertone = skinColor.undertone
  if (enriched.color_season) {
    result._computed.color_season = enriched.color_season
  }
  if (enriched.color_season_12) {
    result._computed.color_season_12 = enriched.color_season_12
  }
  if (enriched.kibbe_type) {
    result._computed.kibbe_type = enriched.kibbe_type
  }
  // 上衣身材分那一维的原始材料:这个人的实测数 + 每维想往哪修(+加 / −收,null=没量就不算)
  // 一维都拉不出来时不写这个键 ⇒ 前端显示"还打不了分",而不是拿 0 分当结论
  const hasDeviation =
    Object.values(bodyDev.want).some((v) => v != null) || bodyDev.ease_window != null
  if (hasDeviation) {
    const deviation = { want: bodyDev.want, notes: bodyDev.notes }
    for (const [k, v] of Object.entries(bodyDev.measure)) if (v != null) deviation[k] = v
    if (bodyDev.ease_window) deviation.ease_window_cm = bodyDev.ease_window
    if (enriched.wh_ratio) deviation.wh_ratio = enriched.wh_ratio
    result._computed.body_deviation = deviation
  }
  // 上衣处方:不读衣橱、不给购物建议,只按这个人的身材与肤色出"该选成什么样"
  // 六轴一个都算不出且肤色也认不出 ⇒ 这个键整块缺席(缺测不出处方)
  const spec = topSpec(enriched)
  if (spec) result.top_spec = spec
  // 八字五行(第二条判定依据);没填出生日期时整块缺席
  if (enriched.bazi) {
    result._computed.bazi = enriched.bazi
    result._computed.bazi_today = enriched.bazi_today
  }

  // 3. 填充 algorithm_analysis(个人模式的深度分析报告)
  //    🔴 第十二阶段·第一步（docs/依据/20 §五 第 1 条）：`opts.deep_analysis` 让门店档也出这一节，
  //    这是"付费那份细账"的主要内容物。⛔ 不改 mode：名单由 `matchRules` 按 mode 过滤规则决定，
  //    换 mode 就换了名单，付费报告就会与顾客免费时看到的那 8 条对不上。
  if (mode === 'personal' || opts.deep_analysis) {
    const sections = []
    const metrics = []

    // 数字摘要:身高+体重才有 BMI,三围才有体型/腰臀比
    if (Number.isInteger(enriched.age))
      metrics.push(`年龄 ${enriched.age}${enriched.age_range ? `(${enriched.age_range})` : ''}`)
    if (enriched.bmi) metrics.push(`BMI ${enriched.bmi}(${enriched.bmi_level})`)
    if (enriched.body_shape) metrics.push(`体型 ${enriched.body_shape}`)
    if (enriched.wh_ratio) metrics.push(`腰臀比 ${enriched.wh_ratio}`)
    if (enriched.leg_ratio) metrics.push(`腿身比 ${enriched.leg_ratio}`)
    if (enriched.shoulder_ratio) metrics.push(`肩宽比 ${enriched.shoulder_ratio}`)
    if (enriched.color_season) metrics.push(`色彩 ${enriched.color_season}`)
    if (enriched.color_season_12) metrics.push(`十二型 ${enriched.color_season_12}`)
    if (enriched.kibbe_type) metrics.push(`风格型 ${enriched.kibbe_type}`)
    if (enriched.bazi)
      metrics.push(
        `日主${enriched.bazi.day_master_element}·喜用${enriched.bazi.favorable.join('')}`,
      )

    // 体型分析
    if (enriched.body_shape_key) {
      const outfitAdvice = getBodyShapeOutfitAdvice(enriched.body_shape_key)
      sections.push({
        title: `体型分析:${enriched.body_shape}`,
        advices: [outfitAdvice],
      })
    }

    // 脸型分析
    if (enriched.face_shape) {
      const faceGuide = getFaceShapeGuide(enriched.face_shape)
      sections.push({
        title: `脸型分析:${enriched.face_shape}`,
        advices: [
          faceGuide.face_analysis,
          `发型建议:${faceGuide.hair_advice}`,
          `妆容建议:${faceGuide.makeup_advice}`,
          `修容建议:${faceGuide.contour_advice}`,
          `配饰建议:${faceGuide.accessory_advice}`,
        ],
      })
    }

    // 三庭五眼比例分析
    if (enriched.proportion_analysis) {
      sections.push({
        title: '三庭五眼比例',
        advices: [
          enriched.proportion_analysis,
          `发型建议:${enriched.proportion_hair}`,
          `妆容建议:${enriched.proportion_makeup}`,
          `修容建议:${enriched.proportion_contour}`,
          `配饰建议:${enriched.proportion_accessory}`,
        ].filter(Boolean),
      })
    }

    // 肤色配色建议
    if (enriched.color_match) {
      sections.push({
        title: '肤色配色建议',
        advices: [
          `适合色系:${enriched.color_match}`,
          enriched.color_avoid || '',
          enriched.color_reason || '',
        ].filter(Boolean),
      })
    }

    // 体态建议
    if (enriched.posture_advice) {
      sections.push({
        title: '体态建议',
        advices: [enriched.posture_advice],
      })
    }

    // 八字五行(第二条判定依据;没填出生日期时整块缺席)
    if (enriched.bazi) {
      const b = enriched.bazi
      let missingLine = ''
      if (b.missing.length) {
        const gap = b.missing.filter((e) => b.favorable.includes(e))
        missingLine =
          `命局所缺:${b.missing.join('、')}` +
          (gap.length
            ? `（其中${gap.join('、')}正是你的喜用，宜补）`
            : '（缺的不一定是喜用，补的是喜用）')
      }
      sections.push({
        title: `八字五行:日主${b.day_master}${b.day_master_element}(${b.strength})`,
        advices: [
          `四柱 ${b.pillars.join(' ')}（${b.precision}${b.precision === '三柱' ? '，未填时辰' : ''}）`,
          b.summary,
          `宜用颜色:${b.favorable_colors}`,
          `宜用方位:${b.favorable_direction}`,
          // 两条依据会打架(喜用色与肤色适配色不一定同),这里给出取舍口径
          '两条依据冲突时:大面积的外衣跟肤色与体型走,喜用色放在内搭、配饰、唇色、鞋袜这些小块面积上',
          missingLine,
        ].filter(Boolean),
      })
    }

    // 今日参考(日期依据:当日干支与个人喜用的生克)
    if (enriched.bazi_today) {
      sections.push({
        title: `今日参考:${enriched.bazi_today.ganzhi}日(${enriched.bazi_today.tone})`,
        advices: [enriched.bazi_today.note],
      })
    }

    if (sections.length > 0) {
      result.algorithm_analysis = { sections, metrics }
    }
  }

  // 4. 规则引擎匹配(使用增强后的 profile)
  // S5（10-19 蓝图短期项，10-23 落）：五个品类的命中在内存里攒着，全部评估完一次批量落库。
  // 改前每条命中各发一条独立 UPDATE、每次还重新 prepare ⇒ 一场 11~14 次写（蓝图 §3.4 结论二现量）。
  const hitCollector = []
  for (const cat of CATEGORIES) {
    const matched = matchRules(enriched, mode, cat, incrementHitCount, hitCollector)
    for (const m of matched) {
      const recommendation = {
        group_id: m.group_id,
        group_name: m.group_name,
        priority: m.priority,
        score: m.score,
        feedback: m.feedback,
        evidence_level: m.evidence_level ?? null,
      }
      Object.assign(recommendation, m.actions)
      // 注入可解释性说明:这条推荐命中了哪些条件(中文人话,供前端展示"为什么推荐")
      recommendation.explanation = explainMatchedRecommendation(m, m.condition_details)
      // 色度学贴合分:上衣结论里认得出色名 + 肤色档能给 Lab 锚点,两个都有才出分;
      // 缺任一侧就不写这个字段(空柜不编造)。权重是 C 档手拍值,见 colorMetrics.js 文件头。
      // 上衣字段在规则动作里叫 top_style,兜底硬编码那条叫 outfit_top,两个都认。
      const topText = recommendation.top_style || recommendation.outfit_top
      // 整身呼应（10-19 第一阶段·止血第 4 条建，10-20 第六阶段·第一步接线）：
      // 上衣/下装/鞋三处自由文本 ＋ 规则自带的 color_combo，逐槽 extractColors 切多色后
      // 两两 ΔE00 按面积加权 ⇒ 一个 0~100 的呼应分。色名认不出的那件、以及只有"深色/浅色"
      // 这种没有 hex 的明度档都被丢掉，凑不够两件就不出分（harmony=null ⇒ colorFit 退回纯
      // 对比侧，不拿假数据凑）。面积写法按穿着面积的上衣/下装为主、鞋占小头，combo 与三处
      // 重复的色不重复计权（口径见 outfitColorParts 的①~④）。
      // 面积是 C 档手拍值，与 60-30-10 那类面积律无关（§8.2 已撤回该律）。
      const harmonySlots = resolveRelationalSlots([
        { label: '上衣', text: topText, area: 0.4 },
        {
          label: '下装',
          text: recommendation.bottom_style || recommendation.outfit_bottom,
          area: 0.4,
        },
        { label: '鞋', text: recommendation.shoe_style || recommendation.outfit_shoe, area: 0.2 },
        // ↓ 这一条就是"接线"本身：库里 167 条结构化配色，改前完全不进分
        {
          label: '配色',
          text: recommendation.color_combo || recommendation.outfit_color,
          area: 0.4,
        },
      ])
      const harmonyParts = outfitColorParts(harmonySlots)
      const comboText = recommendation.color_combo || recommendation.outfit_color
      // §二·4：上衣那一格写的是"与鞋同色"这种关系时，展开出来的色走 scoreTopColor 的 relational 支路
      const topRelational = (harmonySlots.find((s) => s.label === '上衣') || {}).relational || null
      const scored = scoreTopColor(skinColor.lab, topText, harmonyParts, comboText, topRelational)
      const { fit, harmony } = scored
      if (fit) recommendation.color_fit = fit
      // 色彩这一维"是怎么来的"要能拆账：basis 区分实测色名／句内扫描／只有明度档，
      // color_parts 是实际参与呼应的件数（0~1 件时 harmony 本来就不出分）。
      recommendation.color_basis = fit ? fit.basis : null
      recommendation.color_parts = scored.color_parts
      // 🔴 §二·3 借色那一条的三笔出处。⛔ 对外措辞受 `21` §一·1 约束：不许写成"系统识别出你的
      //    上衣是驼色"，只能说"按整套搭配的配色串把驼色当上衣色算的（出处：本组配色第一色，权重已打折）"。
      //    §二·4 的关系色走同一个 `color_borrowed` 闸门（都不是这一格自己写的色），出处多一格 `relational_from`。
      recommendation.color_basis_source = scored.source
      if (scored.borrowed) {
        recommendation.color_borrowed = true
        recommendation.color_borrowed_from = scored.borrowed_from
        recommendation.color_borrowed_position = scored.borrowed_position
        recommendation.color_top_band = scored.top_band
        recommendation.color_relational_from = scored.relational_from
      }
      // §二·4 的收口账：哪一格只写了"跟谁同色"、色是从哪一格取来的。
      // 库里现在只有两行吃到这一条（id=1102／1224 的「同色西裤」），⛔ 它不改任何分数——
      // 被指格的色本来就已经在呼应里了，去重那条（口径④）会把展开的这份吃掉，
      // 所以它的唯一作用是让"上下同色"这种人话第一次有可拆的出处（现量见 21 §十二）。
      const relLedger = relationalLedger(harmonySlots)
      if (relLedger) recommendation.color_relational = relLedger
      // 呼应分单独留一份：报告要拆账、第二阶段重排要把它当独立一维用，不能只藏在总分里
      if (harmony) {
        recommendation.color_harmony = harmony.score
        recommendation.color_harmony_pairs = harmony.pairs.length
      }
      // 🔴 第十三阶段·第一步 §三·4：这一维**不再"整块缺席"**，但也不是"量出来了"。
      // 旧口径（10-19 第二阶段）：规则结论给的是"亮色上衣"这种自由文本，一格实测都取不到 ⇒ 身体维整块缺席。
      // 现口径：文案里认得出**恰好一个**版型档（修身／合身／宽松／廓形）时，走 `ruleTextBodyFit`
      //   复用现成的 `topFitBody`——松量按那一档的区间中值估、覆盖率按半格计，都是那一层原有的分支，
      //   ⛔ 排序层不另打折、⛔ 不复辟"从中文猜 cm"（10-19 第二阶段废除的那条）。
      // 认不出（0 档或"合身＋宽松"这种 ≥2 档冲突）⇒ 与改前逐条相同：整块缺席、吃算法缺席惩罚。
      const ruleFit = ruleTextBodyFit(topText, bodyDev)
      if (ruleFit) {
        recommendation.body_fit = ruleFit.body_fit
        recommendation.fit_type_inferred = ruleFit.fit_type
        recommendation.fabric_weight_inferred = ruleFit.fabric_weight
      }
      result[cat].push(recommendation)
    }
  }

  // 5. 兜底:规则引擎未命中时用旧版硬编码推荐
  if (result['穿搭'].length === 0) {
    const scenario = enriched.scenario || profile.scenario || '通勤'
    const fallback = getRecommendations(
      enriched.skin_tone || profile.skin_tone,
      enriched.face_shape || profile.face_shape,
      scenario,
    )
    for (const item of fallback) {
      const entry = {
        group_name: '默认推荐',
        priority: 0,
        score: 0,
        evidence_level: null, // 兜底条目没走规则库,档位留空(后台与前端显示"未标注")
        outfit_top: item.top_style,
        outfit_bottom: item.bottom_style,
        outfit_color: item.color_combo,
        outfit_reason: item.reason,
      }
      // 兜底那几条也只有自由文本 ⇒ 身材这一维同样缺席（口径与规则那一段一致，不再认字）
      const topText = entry.outfit_top
      // 兜底表本身带结构化配色 `color_combo`（'白+蓝' 这类 15 条），与规则那一段同一个口径进呼应
      // 兜底这 15 条写的是"白色衬衫"这种死文案，⛔ 没有一句关系色 ⇒ 这一层今天对它是个空转；
      // 接它只为"取色口径只有一处"，改文案时不必再来这里补一次线。
      const harmonySlots = resolveRelationalSlots([
        { label: '上衣', text: topText, area: 0.4 },
        { label: '下装', text: entry.outfit_bottom, area: 0.4 },
        { label: '配色', text: entry.outfit_color, area: 0.4 },
      ])
      const harmonyParts = outfitColorParts(harmonySlots)
      const topRelational = (harmonySlots.find((s) => s.label === '上衣') || {}).relational || null
      const scored = scoreTopColor(
        skinColor.lab,
        topText,
        harmonyParts,
        entry.outfit_color,
        topRelational,
      )
      const { fit, harmony } = scored
      if (fit) entry.color_fit = fit
      entry.color_basis = fit ? fit.basis : null
      entry.color_parts = scored.color_parts
      // 兜底那几条同样吃 §二·3 的借色口径（'深色西裤' 这类只有明度档的行就是靠这一条出色）
      entry.color_basis_source = scored.source
      if (scored.borrowed) {
        entry.color_borrowed = true
        entry.color_borrowed_from = scored.borrowed_from
        entry.color_borrowed_position = scored.borrowed_position
        entry.color_top_band = scored.top_band
        entry.color_relational_from = scored.relational_from
      }
      // §二·4 的收口账（与规则那一段同一个口径；兜底这 15 条今天没有一句关系色 ⇒ 回 null、不写这个字段）
      const relLedger = relationalLedger(harmonySlots)
      if (relLedger) entry.color_relational = relLedger
      if (harmony) {
        entry.color_harmony = harmony.score
        entry.color_harmony_pairs = harmony.pairs.length
      }
      result['穿搭'].push(entry)
    }
  }

  // 6. 衣橱里量过尺寸的上衣进候选集（10-19 第二阶段「通脉」；10-21 第九阶段·第一步放开门店模式）
  //    规则命中的那几条是"该买什么"的文字结论，身上没有一件实测过的衣服 ⇒ 廓形那一维永远空转。
  //    真正带成品尺寸的只有衣柜里的那几行，所以把它们也当候选：
  //    它们不是规则命中的 ⇒ 不吃规则基础分那一维，由 rankDims 按在场维归一 + 覆盖率折扣。
  //    ⛔ 四格实测一个都没填、版型也没选的行进不来（不是排最后，是不参与排序）。
  //    10-19 第三阶段·模块一把门槛从"必须量到尺"放宽成"至少有一条算得出的依据"：
  //    只选一档版型的那件也进得来，松量由版型区间中值估出来、在覆盖率里只按半格计，
  //    最后仍要过 `topFitBody` 的覆盖率惩罚 ⇒ "选个版型"占不到便宜，但公式照样能跑。
  //
  //    🔴 10-21 改口的这一条（`docs/依据/17` §五 第 1 条）：原来写死 `mode === 'personal'`，
  //    于是**门店模式看不到任何带尺寸的候选**——身体那一维在门店流程里连进场的机会都没有
  //    （现量 10-21 盘外副本：store 传了 wardrobe_items ⇒ `from_wardrobe=0`）。放开成
  //    "profile 里带了 `wardrobe_items` 就进"，两档都开门。
  //    ⛔ 安全性靠上游而不是这里：这些行只可能是**本次会话自己**扫码/录入的那几件
  //    （`routes/recommend.js` 按 session_id 过滤，见 17 §五 第 2 条），
  //    请求不带这一格时候选池与改前逐条相同（17 §七 那条"默认关得住"的回归防线）。
  const wardrobeTops = []
  if (Array.isArray(profile.wardrobe_items) && profile.wardrobe_items.length > 0) {
    const skinForColor = skinColor.lab
    for (const raw of profile.wardrobe_items || []) {
      if (!raw || typeof raw !== 'object') continue
      if (!isTopCategory(raw.category)) continue
      const hasMeasure = [raw.shoulder_cm, raw.bust_cm, raw.length_cm, raw.waistband_cm].some(
        (v) => v !== null && v !== undefined && String(v).trim() !== '',
      )
      const hasFitType = FIT_TYPE_VALUES.includes(
        typeof raw.fit_type === 'string' ? raw.fit_type.trim() : '',
      )
      if (!hasMeasure && !hasFitType) continue
      const bf = topFitBody(null, raw, bodyDev)
      if (!bf) continue
      delete bf.person // 这个人自己的数整份报告只留一份（见 _computed.body_deviation）
      const entry = {
        source: 'wardrobe',
        wardrobe_item_id: raw.id ?? null,
        group_id: null,
        group_name: `衣橱里的：${raw.name || '没填名字的一件'}`,
        priority: null,
        score: null,
        feedback: null,
        evidence_level: null,
        top_style: raw.name || null,
        bottom_style: null,
        dress_style: null,
        color_combo: raw.color || null,
        // 这条不是规则命中的 ⇒ 不写 explanation（那个对象是"命中了哪些规则条件"的口径，
        // 前端按 ✓ 列表渲染并打"匹配分/优先级"，给它一份算分依据会显示成假的东西）。
        // 算分依据放在 reason 这一句人话里 + body_fit.top.signals 里。
        reason: `衣柜实测：${raw.name || '没填名字的一件'}。${(bf.top.signals || [])
          .slice(0, 4)
          .join('；')}。这一分的依据是你自己量出来的成品尺寸，不是规则文本`,
        body_fit: bf,
        // 🔴 10-21 第十一阶段·第一步（`docs/依据/19` §五 第 3 条）：场合与厚薄这两格要进乘子，
        // 就得先出现在这条候选身上——原来这一路只带颜色与身体，`occasion` 升档等于白升（读不到值就逐条隐身）。
        // ⛔ 只认数组（`utils/common.js:374` 投影出来就是数组），非数组当没填；
        // ⛔ 不在这里判词表：`user_wardrobe.occasion_tags` 由 `routes/wardrobe.js` 写入口收口，
        //   这一层只负责"取得到值"，词表那条尺子不抄第二份。
        occasion_tags: Array.isArray(raw.occasion_tags)
          ? raw.occasion_tags.map((t) => asText(t)).filter(Boolean)
          : [],
        // 厚薄有两个来源：投影带的那一格，或 `topFitBody` 算完挂在 `body_fit.top` 上的那一格
        // （`topFitBody.js:703`，没填是 null）。两个都认，⛔ 只认薄/中/厚三个词——判词的事在 `candAxisValue`。
        fabric_weight: asText(raw.fabric_weight) || bf.top.fabric_weight || null,
      }
      // 衣橱这一处的颜色有两个来源：顾客填的「颜色」栏（raw.color，可以直接写 hex）
      // 和商品名（raw.name，「雾霾蓝卫衣」这种把色写在名字里的写法）。改前只读颜色栏一个字段
      // ⇒ 那一栏空着、色写在名字里的行，色彩维整个缺席；口径与 topFitBody 的体量那一格一致：
      // ⛔ 先试颜色栏、取不到才试名字，不许把两串拼一起（拼串会让 '#111111' 不再是纯 hex 串）。
      const colorCandidates = [asText(raw.color), asText(raw.name)].filter(Boolean)
      let fit = null
      entry.color_text = null
      for (const candidate of colorCandidates) {
        fit = colorFit(skinForColor, candidate)
        if (fit) {
          entry.color_text = candidate
          break
        }
      }
      if (fit) entry.color_fit = fit
      entry.color_basis = fit ? fit.basis : null
      entry.color_parts = fit
        ? extractColors(String(entry.color_text || '')).filter((c) => c.is_specific).length
        : 0
      wardrobeTops.push(entry)
    }
  }

  // 7. 算法重排 + Top N（穿搭这一类；见本节开头"算法重排"）
  //    偏好画像整次推荐只现算一次（不在 rankDims 里逐条查库——那是 8×N 次 SELECT）。
  //    ⛔ 没有身份就压根不查：门店模式那条链路（routes/recommend.js）传的是 null，
  //    这一层对它完全透明，Top 8 与改前逐条相同。
  //    🔴 10-21 第十一阶段·第一步：第二参数＝**本次请求带来的天气档**（`19` §五 第 1 条）。
  //    它走的是 `profile` 透传那同一条路（与 `occasion` 一个来路：请求里给、只当这一屏的输入，
  //    ⛔ 不落库、⛔ 不进长期档案），表外值一律当没带（`normalizeWeatherLevel`）——
  //    没带就是"这一轴整块缺席"，⛔ 不许拿 22℃ 那种猜出来的档去乘分（硬规矩 2）。
  const requestWeatherLevel = normalizeWeatherLevel(enriched.weather_level)
  const pref =
    identity && (identity.sessionId || identity.userId)
      ? buildPreference(identity, requestWeatherLevel)
      : null
  // 协同过滤 cohort（`17` §4.1~4.2）：体型向量读 `bodyDeviation().person_cm` 那一份——
  // 实测优先、缺格由第五阶段的估算顶上，出处（measured/estimated）已经在那条链路里带着，
  // ⛔ 这一层不再自己猜第三个数。连身高都没有 ⇒ `buildCohortModel` 返回 null ⇒ 整层隐身。
  const pv = bodyDev.person_cm || {}
  const collabModel = buildCohortModel(
    identity && (identity.sessionId || identity.userId) ? identity : null,
    pv.height != null ? { height: pv.height, bust: pv.bust, shoulder: pv.shoulder } : null,
    asText(enriched.occasion) || null,
    // 🔴 10-21 第十一阶段：温度档同样喂给协同过滤的第二路（`19` §六）——
    // 没带 ⇒ 那一整路缺席（乘子恰好 1），⛔ 不替用户猜一档；星级那一路不受这一格影响。
    requestWeatherLevel,
  )
  result['穿搭'] = rankAndTruncate(result['穿搭'], wardrobeTops, pref, collabModel, opts)
  result._computed.ranking = {
    weights: RANK_WEIGHTS,
    rule_ref: RANK_RULE_REF,
    coverage_floor: RANK_COVERAGE_FLOOR,
    algo_absence_penalty: RANK_ALGO_ABSENCE_PENALTY,
    top_n: RANK_TOP_N,
    min_algo_in_top: RANK_MIN_ALGO_IN_TOP,
    algo: result['穿搭']._algo || null,
    candidates: result['穿搭'].length + (result['穿搭']._ranked_out || 0),
    ranked_out: result['穿搭']._ranked_out || 0,
    from_wardrobe: result['穿搭'].filter((e) => e.source === 'wardrobe').length,
    // 隐性偏好这一层出了账（第八阶段·一e）。⛔ 它不进上面那三个权重，是出完总分之后的一个界内乘子。
    preference: {
      enabled: !!pref,
      ready: !!(pref && pref.factor_ready),
      samples: pref ? pref.samples : 0,
      min_samples: PREF_MIN_SAMPLES,
      range: [PREF_FACTOR_MIN, PREF_FACTOR_MAX],
      lifts: {
        top: PREF_LIFT_TOP,
        seen: PREF_LIFT_SEEN,
        unseen: PREF_LIFT_UNSEEN,
        // 复穿这一条自己一对数（`19` §五 第 2 条）：`lift = min(max, step×ln(1+次数))`，⛔ 只加不减
        reps: { step: PREF_REPS_STEP, max: PREF_REPS_MAX },
      },
      axes: PREF_MULTIPLIER_AXES,
      // 本次请求带来的天气档（归一后；没带＝null＝`warmth` 这一轴整块缺席）。出账要能自证吃了哪一档。
      weather_level_used: pref ? (pref.weather_level_used ?? null) : null,
      // 复穿这一轴的规模（不 dump 整张 id→次数表：那是这个人的明细，出账只要两个数）
      reps: pref && pref.reps ? pref.reps : { counted_items: 0, max_reps: 0 },
      provenance: pref ? pref.provenance : '本次没有身份，不读日记 ⇒ 乘子恒为 1',
      // 前 N 条里实际被这一层动过的有几条（0 就是"这一层今天没参与"，报告里要能自证）
      touched_in_top: result['穿搭'].filter((e) => e.rank && e.rank.preference_factor !== 1).length,
      dims: pref ? pref.dims : null,
    },
    // 协同过滤这一层的账（第九阶段·第一步）。⛔ 对外只说"同组几人、均值几星"（§4.4 隐私红线），
    // 今天 `item_feedback` 全库 0 行 ⇒ 这里的 enabled 可以是 true 但 cohort 是 null、
    // touched_in_top 必然是 0——"上线即隐身"这条要能被读出来，不许藏。
    collab: {
      enabled: COLLAB_CONFIG.enabled,
      cohort: collabModel
        ? {
            size: collabModel.cohort_size,
            min_size: COLLAB_CONFIG.MIN_COHORT,
            global_mean: collabModel.global_mean,
            distance_max: COLLAB_CONFIG.DIST_MAX,
            k_prior: COLLAB_CONFIG.K_PRIOR,
            occasion_requested: collabModel.occasion_requested,
            // null ⇒ 这一屏凑不出同场合的分，退回"不分场合"，话术跟着改口（不许硬说"在这个场合"）
            occasion_used: collabModel.occasion_used,
            items_with_signals: collabModel.byItem.size,
          }
        : null,
      range: [COLLAB_CONFIG.FACTOR_MIN, COLLAB_CONFIG.FACTOR_MAX],
      signals_in_db: countItemFeedback(),
      // 🔴 第十一阶段第二路信号的账（`19` §六 第 6 条）：这一层被关掉、或"本次没带温度档／
      // 这一档凑不满同组日记"时必须是 `null`——"上线即隐身"要能被读出来，
      // ⛔ 不许拿星级样本数或日记总行数冒充它在工作。
      // 里面只出**聚合数**（几人、几套、全局几套），⛔ 永不出日记人、姓名、门店、时间戳（`19` §九）。
      diary_signal:
        collabModel && collabModel.diary
          ? {
              attribute: collabModel.diary.attribute,
              temperature_level: collabModel.diary.temperature_level,
              cohort_diary_sets: collabModel.diary.cohort_diary_sets,
              cohort_people: collabModel.diary.cohort_people,
              pool_diary_sets: collabModel.diary.pool_diary_sets,
              // null ⇒ 这一屏凑不出同场合的日记，退回"不分场合"，话术跟着改口
              occasion_used: collabModel.diary.occasion_used,
              // 三档里今天真的动了乘子（factor≠1）的有几档：0 就是"这一路也在隐身"
              bands_with_signal: [...collabModel.diary.byBand.values()].filter(
                (b) => b.factor !== 1,
              ).length,
            }
          : null,
      // 🔴 第十三阶段第三路信号的账（`21` §五 第 5 条）：形状与前一路同形、同样只出**聚合数**
      // （几人、几套、几个族），⛔ 永不出日记人、姓名、门店、时间戳。
      // 与 `diary_signal` 唯一差别：它**不等温度档**——`21` §五 点名的闸门只有那四个数，
      // 所以"这一屏没带天气"时这里仍然可能非 null，那是设计而不是漏。
      color_signal:
        collabModel && collabModel.color
          ? {
              attribute: collabModel.color.attribute,
              cohort_diary_sets: collabModel.color.cohort_diary_sets,
              cohort_people: collabModel.color.cohort_people,
              pool_diary_sets: collabModel.color.pool_diary_sets,
              occasion_used: collabModel.color.occasion_used,
              // 只数"这一池里真出现过的族"，里面今天真的动了乘子（factor≠1）的有几个：0 就是这一路也在隐身
              families_with_signal: [...collabModel.color.byFamily.values()].filter(
                (f) => f.factor !== 1,
              ).length,
            }
          : null,
      provenance: collabModel
        ? collabModel.provenance
        : COLLAB_CONFIG.enabled
          ? '没身份／没体型／库里没有可用的同组打分、本次也没有可组的温度档、日记里也没有可组的色族 ⇒ 乘子恒为 1'
          : 'COLLAB_FILTER_ENABLED=0 ⇒ 这一层整个关掉，乘子恒为 1',
      touched_in_top: result['穿搭'].filter((e) => e.rank && e.rank.collab_factor !== 1).length,
    },
    note:
      '综合分 = (w1·规则基础分 + w2·色彩贴合分 + w3·廓形贴合分) × 覆盖率折扣 × 算法缺席惩罚 × 偏好乘子 × 协同过滤乘子；' +
      '规则那一刀只决定谁进候选集，名次由这三个分量决定。' +
      '缺的分量按在场权重归一化并整体打折，绝不补 0 分也不补高分；' +
      '规则命中的条目若色彩与廓形任有一维没出分，综合分再乘 0.8（衣橱量出来的那几行不吃这条惩罚）。' +
      `前 ${RANK_TOP_N} 条里至少要留 ${RANK_MIN_ALGO_IN_TOP} 条是有算法分的，凑不出就不硬塞。` +
      `偏好乘子只在这个人自己记下满 ${PREF_MIN_SAMPLES} 套搭配后才生效，最多抬/压 ${Math.round(
        (PREF_FACTOR_MAX - 1) * 100,
      )}%，日记 0 条时恰好是 1。` +
      '它认的四根轴＝色族／版型／场合／温度档厚薄（厚薄那一轴只有本次请求带了天气档才吃，取不到值的候选对它逐条隐身），' +
      `外加"这件衣服你自己记进过几套日记"的复穿那一刀（幅度 = min(${PREF_REPS_MAX}, ${PREF_REPS_STEP}×ln(1+次数))，⛔ 只加不减）；` +
      '四根加起来仍受同一个上下界夹住——轴变多不会让上限变宽。' +
      `协同过滤乘子只在"体型相近的其他人"凑满 ${COLLAB_CONFIG.MIN_COHORT} 人时才生效（三路共用这一道人数闸），` +
      `最多抬/压 ${Math.round((COLLAB_CONFIG.FACTOR_MAX - 1) * 100)}%，` +
      '库里这一件没人打过星、别人的日记也没凑出可比的分布时恰好是 1（上线即隐身，不是待办没做完）。' +
      '这一层今天有三个信号：星级（比"这一件"）＋日记厚薄（比"这个温度档常穿哪一档厚薄"）＋日记色族' +
      '（比"常穿哪一族色"）；后两路⛔ 不比是不是同一件——两个人的"蓝衬衫"不是一个东西。' +
      '三个乘子各算各的、相乘之后只夹紧一次，任一路样本不足那一路恰好 1。' +
      '色族那一路读的是"同组人记的套数里有几套是这个族"这一份额，⛔ 不是那个人的喜好。' +
      '权重、惩罚系数、在场下限、偏好幅度与协同过滤那三个阈值全是 C 档手拍值（产品口径，标定中，未回归）。',
  }
  // 落选池全量拆账（第十二阶段·第一步·付费报告 A 节，docs/依据/20 §五 第 2 条）。
  // ⛔ 默认不写这个键——免费路径的响应必须与改前逐字节相同，"付费才有尾巴"才是真增量，
  // 而把尾巴偷偷塞进免费响应再宣称"这是付费内容"是假的（§一 那条「不裁剪免费响应」同源）。
  if (opts.keep_ranked_out && result['穿搭']._dropped) {
    result._computed.ranking.beyond_top_n = result['穿搭']._dropped
  }

  // S5 落库点②：五个品类的命中跨类合并，一场一次 UPDATE（改前 11~14 次）。
  if (incrementHitCount) _flushHitCounts(hitCollector)

  return result
}

/**
 * 单独取这个人的"身材偏差向量"（供衣橱按身材排序等入口复用，与 buildRecommendation 里同一套口径）。
 * 只读 profile、不写库；没量到任何尺寸 ⇒ want 全为 null，调用方据此判"这个人还打不了分"。
 * @param {object} profile
 * @returns {{measure:object, want:object, ease_window:number[]|null, notes:string[]}}
 */
function recommendationBodyDeviation(profile) {
  return bodyDeviation(enrichProfile(profile || {}))
}

module.exports = {
  getRecommendations,
  buildRecommendation,
  recommendationBodyDeviation,
  // 重排的可调参数＋一个综合分函数：文档、后台、测试都从这里取数，别处不再抄一份
  RANK_WEIGHTS,
  RANK_RULE_REF,
  RANK_COVERAGE_FLOOR,
  RANK_ALGO_ABSENCE_PENALTY,
  RANK_TOP_N,
  RANK_MIN_ALGO_IN_TOP,
  rankDims,
  // 第十三阶段·一 色彩轴的四处理论上唯一的取色口径，出给单测与报告拆账（⛔ 别处不许再抄一份）：
  // `outfitColorParts` 四槽取色、`resolveRelationalSlots`/`relationalTargetsOf` 关系色展开（§二·4）、
  // `firstSpecificColor` 借来的那个色、`scoreTopColor` 贴合分＋借色／关系色两条支路
  COLOR_BORROW_WEIGHT,
  RELATIONAL_WORDS,
  outfitColorParts,
  resolveRelationalSlots,
  relationalTargetsOf,
  relationalLedger,
  firstSpecificColor,
  scoreTopColor,
  // §三·4 版型推断层接到身体维的那唯一一处（测试与工装都从这里取，⛔ 别处不许再造一条尺子）
  ruleTextBodyFit,
  // 名单装配（排序＋强制在场＋截断）：单独出给测试与后台拆账用，
  // 不在这一层挂任何写库动作，纯函数可以脱离数据库直接验（本项目 D5 那条债的还法之一）
  rankAndTruncate,
}
