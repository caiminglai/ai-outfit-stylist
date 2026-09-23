/**
 * 调优规则优先级:维度越精准 priority 越高,让最贴合用户特征的推荐排第一
 *
 * 维度条件(排除 gender/category/scenario 这三个基础条件):
 *   body_type, face_shape, skin_tone, region, age_range, bmi_level,
 *   body_type_detail, skin_tone_detail, height_range, shoulder_type 等
 *
 * priority 设置:
 *   0 个维度条件(通用规则): priority 5
 *   1 个维度条件(单维度专项): priority 8
 *   2+ 个维度条件(多维度精准): priority 11
 */
const db = require('../db/init');

// 维度条件字段(区分于基础条件 gender/category/scenario)
const DIMENSION_FIELDS = new Set([
  'body_type', 'face_shape', 'skin_tone', 'region', 'age_range', 'bmi_level',
  'body_type_detail', 'skin_tone_detail', 'height_range', 'shoulder_type',
  'neck_length', 'eye_size', 'eye_shape', 'nose_height', 'lip_thickness',
  'preferred_style', 'occasion', 'season', 'budget', 'allergy_metal',
  'skin_type', 'main_goal', 'posture', 'height_wish', 'weight_wish',
  'nose_bridge',
]);

try {
  const groups = db.prepare('SELECT id, name, category FROM rule_groups').all();
  console.log(`[调优] 规则总数: ${groups.length}\n`);

  let cnt0 = 0, cnt1 = 0, cnt2 = 0;
  const update = db.prepare('UPDATE rule_groups SET priority = ? WHERE id = ?');

  const tx = db.transaction(() => {
    for (const g of groups) {
      const conds = db.prepare('SELECT field FROM rule_conditions WHERE group_id = ?').all(g.id);
      const dimCount = conds.filter(c => DIMENSION_FIELDS.has(c.field)).length;

      let priority;
      if (dimCount === 0) { priority = 5; cnt0++; }
      else if (dimCount === 1) { priority = 8; cnt1++; }
      else { priority = 11; cnt2++; }

      update.run(priority, g.id);
    }
  });
  tx();

  console.log('[调优完成] priority 分布:');
  console.log(`  通用规则(0维度, priority=5): ${cnt0} 条`);
  console.log(`  单维度专项(1维度, priority=8): ${cnt1} 条`);
  console.log(`  多维度精准(2+维度, priority=11): ${cnt2} 条`);

  // 验证:测试推荐排序
  const { buildRecommendation } = require('../services/recommendEngine');
  const result = buildRecommendation({ gender: '女', scenario: '通勤', body_type: '梨形', skin_tone: '暖皮', face_shape: '圆脸' }, 'store', false);
  console.log('\n[验证] 女-通勤-梨形-暖皮-圆脸 推荐排序:');
  console.log(`  穿搭命中 ${result.穿搭.length} 条,前3条:`);
  result.穿搭.slice(0, 3).forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.group_name} (priority=${r.priority}) ${r.top_style ? '上装:' + r.top_style : ''}`);
  });

  process.exit(0);
} catch (err) {
  console.error('[错误]', err);
  process.exit(1);
}
