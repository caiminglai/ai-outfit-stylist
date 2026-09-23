/**
 * 规则引擎专业性审视脚本
 * 分析规则覆盖维度、分布、内容丰富度,找出覆盖空白和薄弱环节
 */
const db = require('../db/init');

try {
  // ============ 1. 基础统计 ============
  const groups = db.prepare('SELECT * FROM rule_groups').all();
  const conditions = db.prepare('SELECT * FROM rule_conditions').all();
  const actions = db.prepare('SELECT * FROM rule_actions').all();

  console.log('========== 规则引擎审视 ==========');
  console.log(`规则组: ${groups.length} | 条件: ${conditions.length} | 动作: ${actions.length}\n`);

  // ============ 2. 按类别分布 ============
  console.log('--- 按推荐类别分布 ---');
  const byCategory = {};
  for (const g of groups) {
    byCategory[g.category] = (byCategory[g.category] || 0) + 1;
  }
  Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v} 条`);
  });

  // ============ 3. 按模式分布(门店/个人) ============
  console.log('\n--- 按模式分布 ---');
  const byMode = {};
  for (const g of groups) {
    byMode[g.mode] = (byMode[g.mode] || 0) + 1;
  }
  Object.entries(byMode).forEach(([k, v]) => console.log(`  ${k}: ${v} 条`));

  // ============ 4. 按性别分布 ============
  console.log('\n--- 按性别分布 ---');
  const byGender = { 女: 0, 男: 0, 通用: 0 };
  for (const g of groups) {
    if (g.gender === '女') byGender.女++;
    else if (g.gender === '男') byGender.男++;
    else byGender.通用++;
  }
  Object.entries(byGender).forEach(([k, v]) => console.log(`  ${k}: ${v} 条`));

  // ============ 5. 条件覆盖的字段维度 ============
  console.log('\n--- 条件覆盖的字段维度(rule_conditions.field) ---');
  const byField = {};
  for (const c of conditions) {
    byField[c.field] = (byField[c.field] || 0) + 1;
  }
  Object.entries(byField).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v} 次`);
  });

  // ============ 6. 动作类型分布(推荐内容丰富度) ============
  console.log('\n--- 动作类型分布(rule_actions.action_type) ---');
  const byAction = {};
  for (const a of actions) {
    byAction[a.action_type] = (byAction[a.action_type] || 0) + 1;
  }
  Object.entries(byAction).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v} 次`);
  });

  // ============ 7. 覆盖空白分析:性别 × 类别 ============
  console.log('\n--- 覆盖矩阵:性别 × 类别(找空白) ---');
  const cats = Object.keys(byCategory);
  const matrix = {};
  for (const g of groups) {
    const genderKey = g.gender || '通用';
    const key = `${genderKey}|${g.category}`;
    matrix[key] = (matrix[key] || 0) + 1;
  }
  console.log('  ' + '性别/类别'.padEnd(8) + cats.map(c => c.padEnd(6)).join(' '));
  ['女', '男', '通用'].forEach(gd => {
    const row = cats.map(c => {
      const cnt = matrix[`${gd}|${c}`] || 0;
      return cnt === 0 ? '  ✗   ' : String(cnt).padStart(3).padEnd(6);
    });
    console.log(`  ${gd.padEnd(6)} ${row.join(' ')}`);
  });

  // ============ 8. 门店模式 vs 个人模式覆盖 ============
  console.log('\n--- 门店模式规则(8字段:性别/肤色/脸型/体型/场景)覆盖情况 ---');
  const storeGroups = groups.filter(g => g.mode === 'store');
  console.log(`  门店规则总数: ${storeGroups.length}`);
  const storeFields = {};
  for (const g of storeGroups) {
    const conds = conditions.filter(c => c.group_id === g.id);
    for (const c of conds) {
      storeFields[c.field] = (storeFields[c.field] || 0) + 1;
    }
  }
  console.log('  门店规则用到的条件字段:');
  Object.entries(storeFields).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`    ${k}: ${v} 次`);
  });

  // ============ 9. 每条规则的平均条件数和动作数 ============
  const avgConds = (conditions.length / groups.length).toFixed(1);
  const avgActions = (actions.length / groups.length).toFixed(1);
  console.log(`\n--- 规则密度 ---`);
  console.log(`  平均每条规则: ${avgConds} 个条件, ${avgActions} 个动作`);

  // 条件数为0的规则(无门槛,全命中)
  const noCondGroups = groups.filter(g => !conditions.some(c => c.group_id === g.id));
  console.log(`  无条件规则(全命中): ${noCondGroups.length} 条`);
  if (noCondGroups.length > 0) {
    noCondGroups.slice(0, 5).forEach(g => console.log(`    id=${g.id} ${g.name} [${g.category}]`));
  }

  // ============ 10. 抽样:穿搭类规则的专业性(看 action 内容) ============
  console.log('\n--- 穿搭类规则抽样(前5条的推荐内容) ---');
  const outfitGroups = groups.filter(g => g.category === '穿搭').slice(0, 5);
  for (const g of outfitGroups) {
    const acts = actions.filter(a => a.group_id === g.id);
    console.log(`\n  规则: ${g.name} (性别:${g.gender || '通用'}, 场景:${g.scenario || '通用'})`);
    acts.forEach(a => {
      const preview = (a.content || '').substring(0, 80);
      console.log(`    ${a.action_type}: ${preview}`);
    });
  }

  process.exit(0);
} catch (err) {
  console.error('[错误]', err);
  process.exit(1);
}
