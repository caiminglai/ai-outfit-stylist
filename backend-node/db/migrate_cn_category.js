/**
 * 彻底汉化规则系统：将所有英文 category/name/action_type 替换为中文
 * 映射：outfit→穿搭, makeup→妆容, hairstyle→发型, accessory→配饰, pose→姿势
 */
const Database = require('better-sqlite3')
const path = require('path')
const db = new Database(path.join(__dirname, 'styleai.db'))

console.log('=== 规则系统全面汉化 ===\n')

// ===== 1. rule_groups.category =====
const catMap = {
  outfit: '穿搭',
  makeup: '妆容',
  hairstyle: '发型',
  accessory: '配饰',
  pose: '姿势',
}

let catChanged = 0
for (const [en, cn] of Object.entries(catMap)) {
  const result = db.prepare('UPDATE rule_groups SET category = ? WHERE category = ?').run(cn, en)
  if (result.changes > 0) console.log(`  category: ${en} → ${cn} (${result.changes}条)`)
  catChanged += result.changes
}
console.log(`  ✓ category 总共更新 ${catChanged} 条\n`)

// ===== 2. rule_groups.name — 替换嵌入的英文单词 =====
// 精确替换 name 中的英文部分
let nameChanged = 0
const nameReplacements = [
  ['-outfit-', '-穿搭-'],
  ['-outfit', '-穿搭'],
  ['-makeup-', '-妆容-'],
  ['-makeup', '-妆容'],
  ['-hairstyle-', '-发型-'],
  ['-hairstyle', '-发型'],
  ['-accessory-', '-配饰-'],
  ['-accessory', '-配饰'],
]

for (const [en, cn] of nameReplacements) {
  // SQLite 的 REPLACE 函数
  const result = db
    .prepare(
      `UPDATE rule_groups SET name = REPLACE(name, '${en}', '${cn}') WHERE name LIKE '%${en}%'`,
    )
    .run()
  if (result.changes > 0) console.log(`  name: "${en}" → "${cn}" (${result.changes}条)`)
  nameChanged += result.changes
}
console.log(`  ✓ name 总共更新 ${nameChanged} 条\n`)

// ===== 3. rule_actions.action_type — 替换分类相关的 action_type =====
const actionMap = {
  hairstyle: '发型',
  accessory: '配饰',
  accessory_key: '配饰要点',
  outfit_key: '穿搭要点',
  makeup_key: '妆容要点',
  makeup_style: '妆容风格',
}

let actionChanged = 0
for (const [en, cn] of Object.entries(actionMap)) {
  const result = db
    .prepare('UPDATE rule_actions SET action_type = ? WHERE action_type = ?')
    .run(cn, en)
  if (result.changes > 0) console.log(`  action_type: ${en} → ${cn} (${result.changes}条)`)
  actionChanged += result.changes
}
console.log(`  ✓ action_type ���共更新 ${actionChanged} 条\n`)

// ===== 4. 验证 =====
console.log('=== 验证结果 ===')
const cats = db.prepare('SELECT DISTINCT category FROM rule_groups ORDER BY category').all()
console.log('category: ' + cats.map((r) => r.category).join(', '))

const types = db.prepare('SELECT DISTINCT action_type FROM rule_actions ORDER BY action_type').all()
const englishTypes = types.filter((r) => /[a-zA-Z]/.test(r.action_type))
if (englishTypes.length > 0) {
  console.log('仍有英文 action_type: ' + englishTypes.map((r) => r.action_type).join(', '))
} else {
  console.log('action_type: 全部汉化完成 ✓')
}

// 检查 name 中是否还有残留
const remaining = db
  .prepare(
    "SELECT id, name FROM rule_groups WHERE name LIKE '%outfit%' OR name LIKE '%hairstyle%' OR name LIKE '%makeup%' OR name LIKE '%accessory%' LIMIT 5",
  )
  .all()
if (remaining.length > 0) {
  console.log('⚠ name 中仍有残留英文:')
  remaining.forEach((r) => console.log('  #' + r.id + ': ' + r.name))
} else {
  console.log('name: 全部汉化完成 ✓')
}

console.log('\n=== 最终统计 ===')
console.log('规则组: ' + db.prepare('SELECT COUNT(*) as c FROM rule_groups').get().c)
console.log('规则条件: ' + db.prepare('SELECT COUNT(*) as c FROM rule_conditions').get().c)
console.log('规则动作: ' + db.prepare('SELECT COUNT(*) as c FROM rule_actions').get().c)
console.log('\n✅ 数据库汉化完成！')

db.close()
