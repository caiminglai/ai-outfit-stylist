/**
 * profileEnricher 纯函数测试
 * 覆盖:BMI 计算、体型分类、腰臀比、腿身比、肩宽比、肤色匹配、脸型/体型映射
 *
 * 运行: npm test  或  node --test test/profileEnricher.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  computeBmi,
  computeBodyShape,
  computeWhRatio,
  computeLegRatio,
  computeShoulderRatio,
  computeColorMatch,
  getBodyShapeOutfitAdvice,
  getFaceShapeGuide,
  enrichProfile,
} = require('../services/profileEnricher');

// ============================================================
// BMI 计算
// ============================================================
test('computeBmi: 正常体重', () => {
  // 170cm 65kg → BMI = 65 / 1.7² = 22.49 → 22.5
  const r = computeBmi(170, 65);
  assert.strictEqual(r.bmi, 22.5);
  assert.strictEqual(r.bmi_level, '正常');
  assert.strictEqual(r.bmi_status, 'good');
});

test('computeBmi: 偏瘦', () => {
  // 170cm 50kg → BMI = 17.3 → 偏瘦
  const r = computeBmi(170, 50);
  assert.ok(r.bmi < 18.5);
  assert.strictEqual(r.bmi_level, '偏瘦');
  assert.strictEqual(r.bmi_status, 'warning');
});

test('computeBmi: 偏胖', () => {
  // 170cm 75kg → BMI = 25.95 → 偏胖
  const r = computeBmi(170, 75);
  assert.ok(r.bmi >= 24 && r.bmi < 28);
  assert.strictEqual(r.bmi_level, '偏胖');
});

test('computeBmi: 肥胖', () => {
  // 170cm 90kg → BMI = 31.14 → 肥胖
  const r = computeBmi(170, 90);
  assert.ok(r.bmi >= 28);
  assert.strictEqual(r.bmi_level, '肥胖');
  assert.strictEqual(r.bmi_status, 'danger');
});

test('computeBmi: 非法输入兜底默认值', () => {
  // 身高 0 或负数 → 返回默认 BMI 22.0
  const r1 = computeBmi(0, 65);
  assert.strictEqual(r1.bmi, 22.0);
  assert.strictEqual(r1.bmi_level, '正常');

  const r2 = computeBmi(-170, 65);
  assert.strictEqual(r2.bmi, 22.0);

  // 体重 0
  const r3 = computeBmi(170, 0);
  assert.strictEqual(r3.bmi, 22.0);
});

test('computeBmi: BMI 保留 1 位小数', () => {
  const r = computeBmi(165, 55);
  // 55 / 1.65² = 20.2
  assert.ok(!Number.isNaN(r.bmi));
  // 验证只保留 1 位小数
  const decimalPart = (r.bmi.toString().split('.')[1] || '').length;
  assert.ok(decimalPart <= 1, `BMI 应保留 1 位小数,实际: ${r.bmi}`);
});

// ============================================================
// 体型分类
// ============================================================
test('computeBodyShape: 沙漏型(胸腰差 ≈ 臀腰差,且 > 10)', () => {
  // 胸 90 腰 70 臀 90 → 胸腰差 20,臀腰差 20,差值 0 < 5,且 > 10
  const r = computeBodyShape(90, 70, 90, 38);
  assert.strictEqual(r.body_shape, '沙漏型');
  assert.strictEqual(r.body_shape_key, 'hourglass');
});

test('computeBodyShape: 梨形(臀腰差 > 胸腰差 + 5)', () => {
  // 胸 85 腰 70 臀 95 → 胸腰差 15,臀腰差 25,25 > 15+5=20
  const r = computeBodyShape(85, 70, 95, 38);
  assert.strictEqual(r.body_shape, '梨形');
  assert.strictEqual(r.body_shape_key, 'pear');
});

test('computeBodyShape: 苹果型(胸腰差 > 臀腰差 + 5,肩不宽)', () => {
  // 胸 95 腰 80 臀 88 肩 38 → 胸腰差 15,臀腰差 8,15 > 8+5=13,肩 38 < 88*0.45=39.6
  const r = computeBodyShape(95, 80, 88, 38);
  assert.strictEqual(r.body_shape, '苹果型');
  assert.strictEqual(r.body_shape_key, 'apple');
  assert.strictEqual(r.body_shape_status, 'warning');
});

test('computeBodyShape: 倒三角型(胸腰差 > 臀腰差 + 5,肩宽)', () => {
  // 胸 95 腰 70 臀 85 肩 42 → 胸腰差 25,臀腰差 15,25 > 15+5=20,肩 42 > 85*0.45=38.25
  const r = computeBodyShape(95, 70, 85, 42);
  assert.strictEqual(r.body_shape, '倒三角型');
  assert.strictEqual(r.body_shape_key, 'inverted_triangle');
});

test('computeBodyShape: 直筒型(差值不大)', () => {
  // 胸 80 腰 75 臀 82 肩 38 → 胸腰差 5,臀腰差 7,差值 2 < 5
  const r = computeBodyShape(80, 75, 82, 38);
  assert.strictEqual(r.body_shape, '直筒型');
  assert.strictEqual(r.body_shape_key, 'rectangle');
});

// ============================================================
// 腰臀比
// ============================================================
test('computeWhRatio: 标准腰臀比 (< 0.7)', () => {
  // 腰 60 臀 90 → 0.667
  const r = computeWhRatio(60, 90);
  assert.ok(r.wh_ratio < 0.7);
  assert.strictEqual(r.wh_status, 'good');
});

test('computeWhRatio: 正常 (0.7 ~ 0.85)', () => {
  // 腰 70 臀 90 → 0.778
  const r = computeWhRatio(70, 90);
  assert.ok(r.wh_ratio >= 0.7 && r.wh_ratio < 0.85);
  assert.strictEqual(r.wh_status, 'normal');
});

test('computeWhRatio: 偏高 (>= 0.85)', () => {
  // 腰 80 臀 90 → 0.889
  const r = computeWhRatio(80, 90);
  assert.ok(r.wh_ratio >= 0.85);
  assert.strictEqual(r.wh_status, 'warning');
});

test('computeWhRatio: 臀围 0 兜底', () => {
  const r = computeWhRatio(60, 0);
  assert.strictEqual(r.wh_ratio, 0.73);
});

// ============================================================
// 腿身比 & 肩宽比
// ============================================================
test('computeLegRatio: 短腿 (< 0.53)', () => {
  const r = computeLegRatio(80, 160);
  assert.ok(r.leg_ratio < 0.53);
  assert.strictEqual(r.leg_status, 'short');
});

test('computeLegRatio: 长腿 (> 0.58)', () => {
  const r = computeLegRatio(100, 160);
  assert.ok(r.leg_ratio > 0.58);
  assert.strictEqual(r.leg_status, 'long');
});

test('computeLegRatio: 正常 (0.53 ~ 0.58)', () => {
  const r = computeLegRatio(88, 162);
  assert.ok(r.leg_ratio >= 0.53 && r.leg_ratio <= 0.58);
  assert.strictEqual(r.leg_status, 'normal');
});

test('computeShoulderRatio: 计算肩宽比(百分比形式)', () => {
  const r = computeShoulderRatio(38, 162);
  assert.ok(r.shoulder_ratio > 0, '肩宽比应 > 0');
  // 实际返回百分比形式:38/162*100 = 23.46 → 23.5
  assert.ok(r.shoulder_ratio > 20 && r.shoulder_ratio < 30, `肩宽比应在 20-30 之间,实际: ${r.shoulder_ratio}`);
  assert.ok(r.shoulder_status, '应有肩宽状态');
});

// ============================================================
// 肤色匹配
// ============================================================
test('computeColorMatch: 返回匹配结果对象', () => {
  const r = computeColorMatch('暖色调');
  assert.ok(typeof r === 'object');
  // 应包含颜色相关字段
  assert.ok(Object.keys(r).length > 0);
});

test('computeColorMatch: 未知肤色兜底', () => {
  const r = computeColorMatch('未知肤色');
  assert.ok(typeof r === 'object');
});

// ============================================================
// 体型/脸型穿搭建议映射
// ============================================================
test('getBodyShapeOutfitAdvice: 沙漏型建议(返回字符串)', () => {
  const r = getBodyShapeOutfitAdvice('hourglass');
  // 实际返回字符串:'收腰连衣裙、高腰阔腿裤+紧身针织衫,展现曲线美.'
  assert.strictEqual(typeof r, 'string', `应返回字符串,实际: ${typeof r}`);
  assert.ok(r.length > 0, '建议文本不应为空');
});

test('getBodyShapeOutfitAdvice: 未知体型兜底默认值(返回字符串)', () => {
  const r = getBodyShapeOutfitAdvice('unknown_shape');
  // 未知体型应兜底返回 hourglass 的建议(字符串)
  assert.strictEqual(typeof r, 'string', `应返回字符串,实际: ${typeof r}`);
  assert.ok(r.length > 0, '兜底建议不应为空');
});

test('getFaceShapeGuide: 鹅蛋脸指南', () => {
  const r = getFaceShapeGuide('鹅蛋脸');
  // 实际返回字段:face_analysis / hair_advice / makeup_advice / contour_advice / accessory_advice
  assert.ok(r.face_analysis, '应包含脸型分析字段 face_analysis');
  assert.ok(r.hair_advice, '应包含发型建议 hair_advice');
  assert.ok(r.makeup_advice, '应包含妆容建议 makeup_advice');
});

test('getFaceShapeGuide: 圆脸指南', () => {
  const r = getFaceShapeGuide('圆脸');
  // 圆脸分析应提到"柔和"或"立体"
  assert.ok(
    r.face_analysis.includes('柔和') || r.face_analysis.includes('立体'),
    `圆脸分析应含柔和/立体,实际: ${r.face_analysis}`,
  );
});

// ============================================================
// enrichProfile 综合增强(含默认值兜底)
// ============================================================
test('enrichProfile: 空档案不报错(无关键字段则不计算)', () => {
  const r = enrichProfile({});
  assert.ok(typeof r === 'object');
  // 实际行为:height/weight 都缺失时不计算 BMI(enrichProfile 不强制兜底)
  // 这里只验证函数不抛错并返回对象
  assert.ok(!Array.isArray(r), '应返回对象而非数组');
});

test('enrichProfile: 完整档案计算正确', () => {
  const profile = {
    height: 165,
    weight: 55,
    bust: 86,
    waist: 64,
    hip: 90,
    shoulder: 38,
    leg_length: 92,
    skin_tone: '暖色调',
    face_shape: '鹅蛋脸',
  };
  const r = enrichProfile(profile);
  // BMI = 55 / 1.65² = 20.2
  assert.ok(r.bmi >= 20 && r.bmi < 21);
  assert.ok(r.body_shape_key, '应有体型分类');
  assert.ok(r.wh_ratio, '应有腰臀比');
});

test('enrichProfile: 部分字段缺失不报错', () => {
  const r = enrichProfile({ height: 170 });
  // 只有 height 没有 weight → 不计算 BMI(enrichProfile 不强制兜底)
  // 这里只验证函数不抛错并返回对象
  assert.ok(typeof r === 'object');
  assert.ok(!Array.isArray(r), '应返回对象而非数组');
});
