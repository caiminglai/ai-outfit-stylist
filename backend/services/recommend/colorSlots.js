/**
 * 色彩槽位层（10-29 从 recommendEngine.js 拆出，行为不变；原文 :59-301）。
 * 职责：整身呼应件的取色（outfitColorParts）、关系色就地展开（resolveRelationalSlots／
 * relationalTargetsOf／relationalLedger）、配色串第一具体色（firstSpecificColor）、
 * 上衣贴合分＋借色／关系色两条支路（scoreTopColor）。
 * 口径原文：docs/依据/14 §二、docs/依据/21。⛔ 这层不碰库、不读写文件。
 */
const { colorFit, outfitHarmony, extractColors } = require('../colorMetrics')

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

module.exports = {
  outfitColorParts,
  RELATIONAL_WORDS,
  relationalTargetsOf,
  relationalLedger,
  resolveRelationalSlots,
  firstSpecificColor,
  scoreTopColor,
}
