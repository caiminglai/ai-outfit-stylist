// 11-03 大文件拆分轮：这一段从 services/recommendEngine.js 逐字搬来（规则文案 → 身体维）。
// 函数体与口径注释一处未改；⛔ 对外出口仍只走 recommendEngine.js 那份再导出。
const { topFitBody } = require('../topFitBody')
const { inferFitType, inferFabricWeight } = require('../fitInference')

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

module.exports = {
  ruleTextBodyFit,
}
