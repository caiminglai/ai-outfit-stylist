/**
 * 穿搭规则去重:按 conditions 签名找完全重复,保留最优,删除其余
 *
 * 签名 = 排除 category 条件后,按 field+value 排序拼接
 * 同签名 = 条件完全相同 = 重复
 * 保留策略:priority 最高 → 条件数最多 → actions 数最多 → id 最小
 */
const db = require('../db/init');

try {
  // 查所有穿搭规则
  const outfits = db.prepare("SELECT * FROM rule_groups WHERE category='穿搭' ORDER BY id").all();
  console.log(`[分析] 穿搭规则总数: ${outfits.length}\n`);

  // 计算每条规则的签名
  const sigMap = {};
  for (const g of outfits) {
    const conds = db.prepare('SELECT field, value FROM rule_conditions WHERE group_id = ?').all(g.id);
    // 排除 category 条件(都是 outfit,无区分度)
    const sigConds = conds.filter(c => c.field !== 'category')
      .map(c => `${c.field}:${c.value}`)
      .sort().join('|');
    const sig = sigConds || '无条件';
    if (!sigMap[sig]) sigMap[sig] = [];
    sigMap[sig].push(g);
  }

  // 找重复组
  const dupGroups = Object.entries(sigMap).filter(([_, arr]) => arr.length > 1);
  console.log(`[分析] 重复组数: ${dupGroups.length}`);

  let totalToDelete = 0;
  let totalToKeep = 0;
  const deleteIds = [];

  console.log('\n=== 重复组详情 ===');
  for (const [sig, arr] of dupGroups) {
    console.log(`\n签名: ${sig} (${arr.length}条)`);
    // 排序:priority 降序 → 条件数降序 → actions数降序 → id 升序
    const withMeta = arr.map(g => {
      const condCnt = db.prepare('SELECT COUNT(*) c FROM rule_conditions WHERE group_id=?').get(g.id).c;
      const actCnt = db.prepare('SELECT COUNT(*) c FROM rule_actions WHERE group_id=?').get(g.id).c;
      return { g, condCnt, actCnt };
    });
    withMeta.sort((a, b) =>
      (b.g.priority || 0) - (a.g.priority || 0) ||
      b.condCnt - a.condCnt ||
      b.actCnt - a.actCnt ||
      a.g.id - b.g.id
    );
    const keep = withMeta[0];
    const dels = withMeta.slice(1);
    console.log(`  保留: id=${keep.g.id} ${keep.g.name} (priority=${keep.g.priority}, ${keep.condCnt}条件, ${keep.actCnt}动作)`);
    dels.forEach(d => {
      console.log(`  删除: id=${d.g.id} ${d.g.name} (priority=${d.g.priority}, ${d.condCnt}条件, ${d.actCnt}动作)`);
      deleteIds.push(d.g.id);
    });
    totalToDelete += dels.length;
    totalToKeep++;
  }

  console.log(`\n[统计] 保留 ${totalToKeep} 组, 删除 ${totalToDelete} 条重复规则`);

  if (deleteIds.length === 0) {
    console.log('[完成] 无重复规则,无需删除');
    process.exit(0);
  }

  // 执行删除(级联删除 conditions + actions)
  const tx = db.transaction((ids) => {
    const placeholders = ids.map(() => '?').join(',');
    const c1 = db.prepare(`DELETE FROM rule_actions WHERE group_id IN (${placeholders})`).run(...ids).changes;
    const c2 = db.prepare(`DELETE FROM rule_conditions WHERE group_id IN (${placeholders})`).run(...ids).changes;
    const c3 = db.prepare(`DELETE FROM rule_groups WHERE id IN (${placeholders})`).run(...ids).changes;
    return { groups: c3, conditions: c2, actions: c1 };
  });

  const result = tx(deleteIds);
  console.log(`\n[删除完成] 规则组:${result.groups} 条件:${result.conditions} 动作:${result.actions}`);

  // 验证
  const after = db.prepare("SELECT COUNT(*) c FROM rule_groups WHERE category='穿搭'").get().c;
  const total = db.prepare('SELECT COUNT(*) c FROM rule_groups').get().c;
  console.log(`[验证] 穿搭规则: ${outfits.length} → ${after} | 总规则: ${total}`);

  process.exit(0);
} catch (err) {
  console.error('[错误]', err);
  process.exit(1);
}
