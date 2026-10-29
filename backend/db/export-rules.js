/**
 * 规则导出工具:从数据库导出规则三表到 db/seed/rules.json
 *
 * 用途:规则引擎优化后,把数据库最新规则持久化到 seed 文件,
 *       保证重建数据库时规则不丢失.
 *
 * 用法:node db/export-rules.js
 *
 * ★ 这里必须自己开只读句柄，不能 require('./init')。init.js 在模块加载时就跑 initAll()：
 *   重扫 models/ 并删掉"文件不存在"的模型行、按 env 重置管理员口令、清过期顾客会话、
 *   还会把 seed 里缺的规则增量补进库。也就是说"我只是想导出一份规则"这件事，
 *   原来会在活库上先动一轮写。仓里其余五个脚本(seed.js / add-rules.js / 两个 migrate / applyRuleSeeds)
 *   走的都是 `new Database(DB_PATH)`，本文件是唯一的例外，现在统一到那条口径上。
 *   readOnly:true 是第二道保险：手滑写一句就当场抛，不会静默改库。
 */
const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')
const { DB_PATH } = require('./paths')

try {
  const db = new Database(DB_PATH, { readonly: true })
  const rule_groups = db.prepare('SELECT * FROM rule_groups ORDER BY id').all()
  const rule_conditions = db.prepare('SELECT * FROM rule_conditions ORDER BY group_id, id').all()
  const rule_actions = db
    .prepare('SELECT * FROM rule_actions ORDER BY group_id, sort_order, id')
    .all()
  db.close()

  const data = { rule_groups, rule_conditions, rule_actions }
  const outputPath = path.join(__dirname, 'seed', 'rules.json')
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')

  const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(0)
  console.log(`[导出成功] ${outputPath}`)
  console.log(
    `  规则组: ${rule_groups.length} | 条件: ${rule_conditions.length} | 动作: ${rule_actions.length}`,
  )
  console.log(`  文件大小: ${sizeKB} KB`)

  process.exit(0)
} catch (err) {
  console.error('[导出失败]', err)
  process.exit(1)
}
