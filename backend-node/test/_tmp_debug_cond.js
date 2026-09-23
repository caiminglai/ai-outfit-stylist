// 临时调试:查规则组1的条件,手动验证每个条件匹配,验证后删除
const db = require('../db/init')

const profile = {
  gender: '女',
  age_range: '18-25',
  region: '南方',
  scenario: '通勤',
  skin_tone: '暖皮',
  face_shape: '圆脸',
  body_type: '梨形',
}
// 模拟 matchRules 里给 evalProfile 赋的 category(英文)
const evalProfile = { ...profile, category: 'outfit' }

// 查规则组1的条件
const conditions = db.prepare('SELECT * FROM rule_conditions WHERE group_id=1').all()
console.log('=== 规则组1的条件 ===')
conditions.forEach((c) => {
  let parsed
  try { parsed = JSON.parse(c.value) } catch { parsed = c.value }
  let condVal
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && c.field in parsed) {
    condVal = parsed[c.field]
  } else {
    condVal = parsed
  }
  const profileVal = evalProfile[c.field]
  const matched = condVal === 'all' ? true : (profileVal !== null && profileVal !== undefined && String(profileVal) === String(condVal))
  console.log(`field=${c.field} op=${c.operator} value=${c.value} → condVal=${JSON.stringify(condVal)} profileVal=${JSON.stringify(profileVal)} matched=${matched}`)
})

// 直接查 matchRules 的查询结果
console.log('\n=== matchRules 查询的规则组(category=穿搭) ===')
const groups = db.prepare("SELECT id,name,gender,scenario,category FROM rule_groups WHERE enabled=1 AND mode='store' AND (gender='女' OR gender IS NULL) AND (scenario='通勤' OR scenario IS NULL) AND category='穿搭'").all()
console.log('查询到规则组数:', groups.length)
groups.forEach((g) => console.log(' -', g.id, g.name))

// 对每个查到的规则组,检查条件是否全匹配
console.log('\n=== 每个规则组的条件全匹配检查 ===')
for (const g of groups.slice(0, 3)) {
  const conds = db.prepare('SELECT * FROM rule_conditions WHERE group_id=?').all(g.id)
  let allMatched = true
  for (const c of conds) {
    let parsed
    try { parsed = JSON.parse(c.value) } catch { parsed = c.value }
    let condVal
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && c.field in parsed) {
      condVal = parsed[c.field]
    } else {
      condVal = parsed
    }
    const profileVal = evalProfile[c.field]
    const m = condVal === 'all' ? true : (profileVal !== null && profileVal !== undefined && String(profileVal) === String(condVal))
    if (!m) {
      console.log(`  规则组${g.id} 条件未匹配: field=${c.field} condVal=${JSON.stringify(condVal)} profileVal=${JSON.stringify(profileVal)}`)
      allMatched = false
    }
  }
  console.log(`规则组${g.id} (${g.name}): allMatched=${allMatched}`)
}
