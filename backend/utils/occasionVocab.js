/**
 * 场合受控词表（唯一真相源）
 * ============================================================
 * 从 `routes/wardrobe.js` 的 `outfitOccasionValues()` 原样搬过来（2026-10-21 第九阶段·第一步）。
 * 搬的原因不是洁癖：`docs/依据/17-协同过滤输入输出规范-20261021.md` §二·2.2 第 3 条要求
 * `item_feedback.occasion` 也**只收规则库在用的那一组词**，抄第二份值表就会留下
 * "改了那边忘了这边"——本项目反复清扫的那类病灶（两层各算一遍算出两个答案）。
 * 现在日记（`routes/wardrobe.js`）与人×衣服评分（`services/itemFeedback.js`）共用这一个函数。
 *
 * ⚠️ 取不到词（老库这一格为空）时**只许留空**，不收自由文本——宁缺不猜，缺测不出分那条
 * （`docs/依据/README.md:61`，硬规矩 2）。
 */
const db = require('../db/init')

/**
 * 场合值域＝**规则库在用的那一组词**，每次现从库里取。
 *
 * 为什么不在这里抄一份常量表：`rule_conditions` 里 `field='occasion'` 的 `value` 存的是 JSON 串
 * （现量 10-20 本机库：`"上班通勤" / "约会聚会" / "婚礼宴会" / "运动健身" / "居家休闲"` 五个词），
 * 规则命中的就是那个串。下游若收了表外的词，采下来也命不中任何一条规则 ⇒ 白采
 * （docs/依据/16 §〇 说的"造了新词规则侧命不上"）。
 * @returns {string[]} 去重并排序后的词表；查不到返回 []
 */
function occasionValues() {
  let rows = []
  try {
    rows = db.prepare("SELECT DISTINCT value FROM rule_conditions WHERE field = 'occasion'").all()
  } catch {
    // 老库没有 rule_conditions 这一列/这张表：当成"词表为空"，不炸推荐
    return []
  }
  const out = []
  for (const r of rows) {
    let v = r.value
    try {
      v = JSON.parse(v)
    } catch {
      v = typeof v === 'string' ? v.replace(/^["']|["']$/g, '') : ''
    }
    const s = typeof v === 'string' ? v.trim() : ''
    if (s && !out.includes(s)) out.push(s)
  }
  return out.sort()
}

module.exports = { occasionValues }
