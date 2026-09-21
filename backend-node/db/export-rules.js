/**
 * 规则导出工具:从数据库导出规则三表到 db/seed/rules.json
 *
 * 用途:规则引擎优化后,把数据库最新规则持久化到 seed 文件,
 *       保证重建数据库时规则不丢失.
 *
 * 用法:node db/export-rules.js
 */
const db = require('./init');
const fs = require('fs');
const path = require('path');

try {
  const rule_groups = db.prepare('SELECT * FROM rule_groups ORDER BY id').all();
  const rule_conditions = db.prepare('SELECT * FROM rule_conditions ORDER BY group_id, id').all();
  const rule_actions = db.prepare('SELECT * FROM rule_actions ORDER BY group_id, sort_order, id').all();

  const data = { rule_groups, rule_conditions, rule_actions };
  const outputPath = path.join(__dirname, 'seed', 'rules.json');
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');

  const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(0);
  console.log(`[导出成功] ${outputPath}`);
  console.log(`  规则组: ${rule_groups.length} | 条件: ${rule_conditions.length} | 动作: ${rule_actions.length}`);
  console.log(`  文件大小: ${sizeKB} KB`);

  process.exit(0);
} catch (err) {
  console.error('[导出失败]', err);
  process.exit(1);
}
