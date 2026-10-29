'use strict'

/**
 * 版型推断层（10-21 第十三阶段·第一步 §三；规范＝docs/依据/21 §三，词表依据＝§〇·5 的本库实测命中数）。
 *
 * 这一层只干一件事：**从这句中文文案里认出它属于库里已有的那一档**，⛔ 不估任何 cm 级数值。
 * 10-19 第二阶段废掉的是"从中文猜尺寸"（'宽松' ⇒ 胸围 +15cm 这种），那条债由 `topFitBody` 还；
 * 本层不复辟它——它出的是一个**离散档位串**（`fit_type`／`fabric_weight`），
 * 与顾客在衣橱里一格一格手选出来的那个值是同一个值域（`topFitBody.js` 的 `FIT_TYPE_VALUES`
 * 与 `FABRIC_WEIGHT_VALUES`），拿到 `topFitBody` 那里走的是它本来就有的那条分支。
 *
 * 三条硬口径（§三·3）：
 *  1. 命中 0 档 ⇒ `null`（调用方按"这一维没数据"处理，与改前逐条相同）；
 *  2. 命中 ≥2 档 ⇒ `null`。⛔ 取第一个命中词、⛔ 多数表决、⛔ 按词长优先。
 *     现量代价：`bottom_style` 有 38 行（24.2%）走这条分支——"合身＋宽松"这类"适度宽松"的写法最多；
 *  3. 命中恰好 1 档 ⇒ 出 `{fit_type, words, basis:'inferred_from_text'}`。
 *
 * ⚠️ 这些档位是**从文案词推出来的**，⛔ 不许对顾客说成"量化了你的体型"；
 *    要说依据只能说到款式词那一条（`21` §一·2 的措辞红线）。
 */

// 唯一真相源在这里，⛔ 值域由 topFitBody 给（本层不许加第五档、不许回数值）
const { FIT_TYPE_VALUES, FABRIC_WEIGHT_VALUES } = require('./topFitBody')

/**
 * 档位 → 款式词。每词后面括号里的数＝该词在本库 `rule_actions.content` 全语料里的命中行数
 * （现量工装 census-fit.cjs／census-fit-slots.cjs，2026-10-21 跑在盘外副本库上）；
 * ⛔ 命中数就是这张表的依据，不是从别处抄的。
 * 0 行的词（罗纹／弹力／勾勒／露腰／松身／结构感／茧型／oversized）也留着：
 * 它们是顾客自己写文案时用得上的词形，不是给今天这 1879 行凑数的。
 */
const FIT_INFER_WORDS = {
  修身: [
    '修身', // 35
    '紧身', // 17
    '收腰', // 12
    '显瘦', // 13
    '贴合', // 0
    '包臀', // 0
    // ⛔ 裸词「打底」（全库 19 行）不进这张表：现量 15 行是眼影/妆前（'浅色系打底'），
    //   `top_style` 槽里唯一那 1 行是「以中性色打底,一件有版型的外套…」——说的是**底色用法**不是款式，
    //   留着它这一句会被认成"修身"（工装 probe-dadi.cjs／probe-dadi2.cjs，172 行里就这 1 行、且是假命中）。
    //   真的紧身件写的是「打底裤」，而那些行全在 `bottom_style` 槽，§三·4 这一层根本不读它。
    '罗纹', // 0
    '弹力', // 0
    '勾勒', // 0
    '露腰', // 0
  ],
  合身: ['合身', '合体', '直筒', '正肩', '剪裁利落', '西装裤', '标准码'], // 合身/合体/直筒/西装裤/标准: 20/13/85/0/7
  宽松: ['宽松', 'oversize', 'oversized', '落肩', '茧型', '阔腿', '垂坠', '松身'], // 48/落肩/阔腿: 2/34/10
  廓形: [
    '廓形', // 20
    '伞裙',
    'a字', // 27
    '蓬', // 11
    '泡泡袖', // 7
    '荷叶边', // 10
    '层叠', // 12
    '量感',
    '膨胀', // 11
    '挺括', // 5
    '硬挺', // 5
    '垫肩', // 7
    '结构感',
  ],
}

/**
 * 面料词 → 厚薄三档（值域＝`FABRIC_WEIGHT_VALUES`）。
 * ⚠️ 「挺括／硬挺」在库里 5/5 行，说的是**手感**不是克重 ⇒ 只当廓形线索（见上表），⛔ 不进这三档。
 *    这条已列进 `21` §七 待裁，他点头前不改。
 */
const FABRIC_WEIGHT_WORDS = {
  厚: ['羊毛', '羊绒', '毛呢', '羽绒', '灯芯绒', '大衣', '厚重', '厚实'], // 15/12/7/6/3/18/4/0
  薄: ['雪纺', '真丝', '丝绸', '缎', '蕾丝', '薄纱', '冰丝', '莫代尔', '亚麻', '棉麻', '轻薄'], // 6/8/0/0/3/0/0/0/8/10/11
  中: ['针织', '卫衣', '牛仔', '帆布', '皮革', '醋酸', '天丝', '纯棉'], // 58/30/47/20/0/0/0/0
}

/** 逐档收集命中词（大小写不敏感，'A字' 与 'a字' 同一档） */
function _gradesBy(table, text) {
  const t = String(text === null || text === undefined ? '' : text).toLowerCase()
  if (!t.trim()) return []
  const hits = []
  for (const [grade, words] of Object.entries(table)) {
    const hit = words.filter((w) => t.includes(String(w).toLowerCase()))
    if (hit.length) hits.push({ grade, words: hit })
  }
  return hits
}

/** 恰好一档才出结果；0 档与 ≥2 档都是 `null`（§三·3 的第 1、2 条） */
function _singleGrade(table, text) {
  const hits = _gradesBy(table, text)
  if (hits.length !== 1) return null
  return hits[0]
}

/**
 * 文案 → 版型档。
 * @param {string|null} text 候选文案（上衣那一格，或任何一句款式描述）
 * @returns {null|{fit_type:string, words:string[], basis:'inferred_from_text'}}
 */
function inferFitType(text) {
  const g = _singleGrade(FIT_INFER_WORDS, text)
  if (!g) return null
  // 认出来的档必须真的在库里的值域里（这一层不该造出第五档，但值域变了要在这里先炸）
  if (!FIT_TYPE_VALUES.includes(g.grade)) return null
  return { fit_type: g.grade, words: g.words, basis: 'inferred_from_text' }
}

/**
 * 文案 → 面料厚薄档。与 `inferFitType` 同一把尺子（0 档／≥2 档都是判不出）。
 * @param {string|null} text
 * @returns {null|{fabric_weight:'薄'|'中'|'厚', words:string[], basis:'inferred_from_text'}}
 */
function inferFabricWeight(text) {
  const g = _singleGrade(FABRIC_WEIGHT_WORDS, text)
  if (!g) return null
  if (!FABRIC_WEIGHT_VALUES.includes(g.grade)) return null
  return { fabric_weight: g.grade, words: g.words, basis: 'inferred_from_text' }
}

module.exports = {
  FIT_INFER_WORDS,
  FABRIC_WEIGHT_WORDS,
  inferFitType,
  inferFabricWeight,
}
