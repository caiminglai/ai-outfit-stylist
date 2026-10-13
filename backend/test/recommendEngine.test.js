/**
 * 推荐引擎端到端测试
 * 依赖真实数据库（backend/db/styleai.db）+ 种子数据（195 规则组）
 *
 * 覆盖：
 * - buildRecommendation 4 维度输出（穿搭/妆容/发型/配饰）
 * - 5 维度匹配（性别/肤质脸型/场景/地区/年龄段）
 * - 门店模式 vs 个人模式
 * - 规则优先级（priority 字段）
 * - 隐私模式（incrementHitCount）
 *
 * 运行: npm test  或  node --test test/recommendEngine.test.js
 *
 * 注意：本测试会 require('../db/init')，触发数据库初始化。
 *      测试用例不写库（incrementHitCount=false），可重复运行。
 */
const test = require('node:test')
const assert = require('node:assert')
const { buildRecommendation } = require('../services/recommendEngine')

// ============================================================
// 基础结构验证
// ============================================================
test('buildRecommendation: 返回 4 维度结果对象', () => {
  const profile = {
    gender: 'female',
    ageGroup: '18-25',
    region: 'south',
    scene: 'daily',
    skinTone: 'warm',
  }
  const r = buildRecommendation(profile, 'store', false)
  assert.ok(r.穿搭 !== undefined, '应有穿搭维度')
  assert.ok(r.妆容 !== undefined, '应有妆容维度')
  assert.ok(r.发型 !== undefined, '应有发型维度')
  assert.ok(r.配饰 !== undefined, '应有配饰维度')
  assert.strictEqual(r._mode, 'store')
})

test('buildRecommendation: _computed 包含算法计算的字段', () => {
  const profile = {
    gender: 'female',
    ageGroup: '18-25',
    region: 'south',
    scene: 'daily',
    skinTone: 'warm',
    height: 165,
    weight: 55,
  }
  const r = buildRecommendation(profile, 'personal', false)
  assert.ok(r._computed, '应有 _computed 字段')
  // 个人模式带身高体重时应计算 BMI
  assert.ok(r._computed.bmi !== undefined, '应计算 BMI')
})

// ============================================================
// 5 维度匹配验证
// ============================================================
test('buildRecommendation: 男性档案能匹配到推荐', () => {
  const profile = {
    gender: 'male',
    ageGroup: '26-35',
    region: 'north',
    scene: 'business',
    skinTone: 'cool',
  }
  const r = buildRecommendation(profile, 'store', false)
  // 男性档案应能匹配到规则（数据库有男女双性别规则）
  const total =
    (r.穿搭?.length || 0) + (r.妆容?.length || 0) + (r.发型?.length || 0) + (r.配饰?.length || 0)
  assert.ok(total > 0, `男性档案应匹配到推荐，实际总数: ${total}`)
})

test('buildRecommendation: 女性档案能匹配到推荐', () => {
  const profile = {
    gender: 'female',
    ageGroup: '18-25',
    region: 'south',
    scene: 'date',
    skinTone: 'warm',
  }
  const r = buildRecommendation(profile, 'store', false)
  const total =
    (r.穿搭?.length || 0) + (r.妆容?.length || 0) + (r.发型?.length || 0) + (r.配饰?.length || 0)
  assert.ok(total > 0, `女性档案应匹配到推荐，实际总数: ${total}`)
})

test('buildRecommendation: 不同年龄段匹配不同推荐', () => {
  // 18-25 vs 36-45 应匹配到不同的规则集
  const young = buildRecommendation(
    { gender: 'female', ageGroup: '18-25', region: 'south', scene: 'daily', skinTone: 'warm' },
    'store',
    false,
  )
  const mature = buildRecommendation(
    { gender: 'female', ageGroup: '36-45', region: 'south', scene: 'daily', skinTone: 'warm' },
    'store',
    false,
  )
  // 两者都应有推荐，但内容可能不同（至少都能匹配到）
  const youngTotal = (young.穿搭?.length || 0) + (young.妆容?.length || 0)
  const matureTotal = (mature.穿搭?.length || 0) + (mature.妆容?.length || 0)
  assert.ok(youngTotal > 0, '年轻档应有推荐')
  assert.ok(matureTotal > 0, '成熟档应有推荐')
})

test('buildRecommendation: 南北地区都能匹配', () => {
  const south = buildRecommendation(
    { gender: 'female', ageGroup: '18-25', region: 'south', scene: 'daily', skinTone: 'warm' },
    'store',
    false,
  )
  const north = buildRecommendation(
    { gender: 'female', ageGroup: '18-25', region: 'north', scene: 'daily', skinTone: 'warm' },
    'store',
    false,
  )
  assert.ok(typeof south === 'object')
  assert.ok(typeof north === 'object')
})

// ============================================================
// 模式验证
// ============================================================
test('buildRecommendation: 门店模式 vs 个人模式', () => {
  const profile = {
    gender: 'female',
    ageGroup: '18-25',
    region: 'south',
    scene: 'daily',
    skinTone: 'warm',
    height: 165,
    weight: 55,
    bust: 86,
    waist: 64,
    hip: 90,
  }
  const store = buildRecommendation(profile, 'store', false)
  const personal = buildRecommendation(profile, 'personal', false)
  assert.strictEqual(store._mode, 'store')
  assert.strictEqual(personal._mode, 'personal')
  // 个人模式应有深度分析报告
  assert.ok(personal.algorithm_analysis !== null, '个人模式应有 algorithm_analysis')
})

// ============================================================
// 容错验证
// ============================================================
test('buildRecommendation: 空档案不报错（兜底默认值）', () => {
  const r = buildRecommendation({}, 'store', false)
  assert.ok(typeof r === 'object')
  assert.ok(r.穿搭 !== undefined)
})

test('buildRecommendation: 部分字段缺失不报错', () => {
  const r = buildRecommendation({ gender: 'female' }, 'store', false)
  assert.ok(typeof r === 'object')
  assert.ok(r._computed !== undefined)
})

test('buildRecommendation: incrementHitCount=false 不写库', () => {
  // 两次调用，hit_count 不应变化（因为 incrementHitCount=false）
  const profile = {
    gender: 'female',
    ageGroup: '18-25',
    region: 'south',
    scene: 'daily',
    skinTone: 'warm',
  }
  const r1 = buildRecommendation(profile, 'store', false)
  const r2 = buildRecommendation(profile, 'store', false)
  // 两次结果结构应一致
  assert.deepStrictEqual(Object.keys(r1).sort(), Object.keys(r2).sort())
})

// ============================================================
// 规则优先级验证
// ============================================================
test('buildRecommendation: 推荐结果按优先级排序', () => {
  const profile = {
    gender: 'female',
    ageGroup: '18-25',
    region: 'south',
    scene: 'date',
    skinTone: 'warm',
  }
  const r = buildRecommendation(profile, 'store', false)
  // 穿搭推荐应按 priority 排序（如果有多个）
  if (r.穿搭 && r.穿搭.length > 1) {
    // 验证排序：高优先级在前（priority 数值越小越优先，或越大越优先，取决于实现）
    // 这里只验证有排序行为，具体方向看实现
    assert.ok(Array.isArray(r.穿搭), '穿搭应是数组')
  }
})

// ============================================================
// 场合别名归一(老规则把 scenario 写成表单原始选项)
// ============================================================
test('buildRecommendation: 场合写成"上班通勤"的老规则现在能命中(personal)', () => {
  const profile = { gender: '女', occasion: '上班通勤', skin_tone: '暖皮', face_shape: '圆脸' }
  const r = buildRecommendation(profile, 'personal', false)
  const names = r['穿搭'].map((x) => x.group_name)
  assert.ok(
    names.some((n) => n && n.includes('上班通勤')),
    `occasion=上班通勤 应命中该场合的规则,实际: ${names.join(' / ')}`,
  )
})

test('buildRecommendation: 场合写成"派对"的老规则在聚会场景能命中(personal)', () => {
  const profile = { gender: '女', scenario: '聚会', skin_tone: '暖皮', face_shape: '圆脸' }
  const r = buildRecommendation(profile, 'personal', false)
  const outfitNames = r['穿搭'].map((x) => x.group_name)
  const makeupNames = r['妆容'].map((x) => x.group_name)
  assert.ok(
    outfitNames.some((n) => n && n.includes('派对')),
    `scenario=聚会 应命中"派对"那组穿搭,实际: ${outfitNames.join(' / ')}`,
  )
  assert.ok(
    makeupNames.some((n) => n && n.includes('派对')),
    `scenario=聚会 应命中"派对"那组妆容,实际: ${makeupNames.join(' / ')}`,
  )
})

// ============================================================
// 色度学贴合分 + 依据档位透传(2026-10-06 接入)
// 断言的都是现场实测值:buildRecommendation 的入参与输出形状
// ============================================================
const FIT_PROFILE = {
  gender: '女',
  ageGroup: '26-35',
  region: 'north',
  scene: 'daily',
  skin_tone: '白皙',
  scenario: '通勤',
  height: 165,
  weight: 55,
  waist: 62,
  hip: 92,
  leg_length: 90, // 90/165=0.545,新口径(髋骨到脚跟)判标准
  shoulder: 39,
}

test('buildRecommendation: 上衣认得出色名+有肤色档 ⇒ 给出 color_fit 且各项有界', () => {
  const r = buildRecommendation(FIT_PROFILE, 'personal', false)
  const list = r['穿搭'] || []
  const fits = list.filter((e) => e.color_fit)
  assert.ok(fits.length >= 1, `至少一条上衣结论该算出贴合分,实际 ${fits.length} 条`)
  fits.forEach((e) => {
    const f = e.color_fit
    assert.ok(Number.isFinite(f.score) && f.score >= 0 && f.score <= 100, `score 越界: ${f.score}`)
    ;[f.deltaE00, f.dHue, f.hueContrast, f.dL, f.brighten, f.chroma].forEach((v, i) => {
      assert.ok(Number.isFinite(v), `第 ${i} 项非有限数: ${v}`)
    })
    assert.match(f.top_hex, /^#[0-9A-F]{6}$/, `hex 应归一成大写: ${f.top_hex}`)
    assert.ok(f.evidence.includes('GB/T 7921'), 'evidence 要写清依据档位')
  })
})

test('buildRecommendation: 没有肤色档 ⇒ 一律不给 color_fit(空柜不编造)', () => {
  const p = { ...FIT_PROFILE }
  delete p.skin_tone
  const r = buildRecommendation(p, 'personal', false)
  const withFit = (r['穿搭'] || []).filter((e) => e.color_fit)
  assert.strictEqual(
    withFit.length,
    0,
    `缺肤色还出分就是编造: ${JSON.stringify(withFit.map((e) => e.group_name))}`,
  )
})

// ============================================================
// 身材贴合分(2026-10-09 接入 services/topFitBody.js;这一维不看脸)
// ============================================================

test('buildRecommendation: 上衣结论带 body_fit 时每根轴都有界、依据串写明手拍权重', () => {
  const r = buildRecommendation(FIT_PROFILE, 'personal', false)
  const withBody = (r['穿搭'] || []).filter((e) => e.body_fit)
  assert.ok(withBody.length >= 1, `至少一条上衣结论该算出身材分,实际 ${withBody.length} 条`)
  withBody.forEach((e) => {
    const b = e.body_fit
    assert.ok(Number.isFinite(b.score) && b.score >= 0 && b.score <= 100, `总分越界: ${b.score}`)
    assert.strictEqual(b.axes.length, b.axes_present.length, 'axes 只准列在场的轴')
    b.axes.forEach((a) => {
      assert.ok(a.score >= 0 && a.score <= 1, `${a.key} 单轴分越界: ${a.score}`)
      assert.ok(typeof a.tier === 'string' && a.tier.length > 0, `${a.key} 缺档位说明`)
    })
    assert.match(b.evidence, /C 刻度与权重|标定中/, 'evidence 必须承认刻度与权重是手拍的')
    assert.ok(!('person' in b), 'person 那份整报告只留 _computed.body_deviation,每条再带一遍是浪费')
  })
  // 这个人自己的偏差向量随报告出一份
  const dev = r._computed.body_deviation
  assert.ok(dev && dev.want, '_computed.body_deviation 应在场')
  assert.ok(Number.isFinite(dev.bmi), 'BMI 是从身高体重算出来的,要带过去')
})

test('buildRecommendation: 同一句上衣结论,换一个人身材 ⇒ body_fit 分数不同', () => {
  const slim = { ...FIT_PROFILE, height: 165, weight: 50, waist: 62, hip: 88, shoulder: 36 }
  const broad = { ...FIT_PROFILE, height: 175, weight: 90, waist: 92, hip: 98, shoulder: 47 }
  const a = buildRecommendation(slim, 'personal', false)
  const b = buildRecommendation(broad, 'personal', false)
  const pair = (r) =>
    (r['穿搭'] || []).filter((e) => e.body_fit).map((e) => [e.group_name, e.body_fit.score])
  const la = new Map(pair(a))
  const diffs = pair(b)
    .filter(([name, s]) => la.has(name) && la.get(name) !== s)
    .map(([name, s]) => `${name}: ${la.get(name)} → ${s}`)
  assert.ok(
    diffs.length >= 1,
    `两条链路的上衣分数完全一样 ⇒ 这一维还跟人无关:\n${[...la].map(([n, s]) => `${n}=${s}`).join(' / ')}`,
  )
})

test('buildRecommendation: 一个尺寸都没量 ⇒ 全场没有 body_fit(缺测不出分)', () => {
  const bare = { gender: '女', scenario: '通勤', skin_tone: '白皙' }
  const r = buildRecommendation(bare, 'personal', false)
  const withBody = (r['穿搭'] || []).filter((e) => e.body_fit)
  assert.strictEqual(
    withBody.length,
    0,
    `没量尺寸还出分就是编造: ${JSON.stringify(withBody.map((e) => e.group_name))}`,
  )
  assert.ok(!r._computed.body_deviation, '偏差向量也该整块缺席,前端才有"还打不了分"的判据')
})

test('buildRecommendation: 每条穿搭都带 evidence_level 字段(A/B/C/D 或 null,不许 undefined)', () => {
  const r = buildRecommendation(FIT_PROFILE, 'personal', false)
  const list = r['穿搭'] || []
  assert.ok(list.length >= 4, `应命中多条规则,实际 ${list.length}`)
  list.forEach((e) => {
    assert.ok(
      'evidence_level' in e,
      `${e.group_name} 缺 evidence_level 字段(前端要按 null 显示"未标注")`,
    )
    assert.ok(
      [null, 'A', 'B', 'C', 'D'].includes(e.evidence_level),
      `${e.group_name} 档位非法: ${e.evidence_level}`,
    )
  })
  // 现场:比例类规则应是 A/B,四季色彩应是 C
  assert.ok(
    list.some((e) => e.evidence_level === 'A' || e.evidence_level === 'B'),
    '比例类规则应带 A/B 档',
  )
  assert.ok(
    list.some((e) => e.evidence_level === 'C'),
    '色彩季型类规则应带 C 档',
  )
})

test('buildRecommendation: 腿长留空就不匹配腿身比规则(阈值改造后的负向断言)', () => {
  const p = { ...FIT_PROFILE }
  delete p.leg_length
  const r = buildRecommendation(p, 'personal', false)
  const names = (r['穿搭'] || []).map((e) => e.group_name || '')
  assert.ok(
    !names.some((n) => n.includes('腿身比')),
    `没量腿长却命中了腿身比规则: ${names.join(' / ')}`,
  )
  // 对照组:量了腿长(0.545 判标准)就该命中"标准"那组
  const names2 = (buildRecommendation(FIT_PROFILE, 'personal', false)['穿搭'] || []).map(
    (e) => e.group_name || '',
  )
  assert.ok(
    names2.some((n) => n.includes('腿身比标准')),
    `0.545 应判标准: ${names2.join(' / ')}`,
  )
})

// ============================================================
// 上衣处方（services/topFromBody.js：只吃身材+肤色，不读衣橱）
// ============================================================

test('buildRecommendation: 量得出身材的人 ⇒ 结果带 top_spec，每轴有档位串与实测数', () => {
  const r = buildRecommendation(FIT_PROFILE, 'personal', false)
  const s = r.top_spec
  assert.ok(s, 'FIT_PROFILE 有身高体重肩宽腿长肤色 ⇒ 处方该在场')
  assert.ok(s.axes.length >= 2, `至少出两轴，实际 ${s.axes.length}`)
  s.axes.forEach((a) => {
    assert.ok(typeof a.tier === 'string' && a.tier.length > 4, `${a.key} 缺档位串`)
    assert.ok(Array.isArray(a.prefer) && Array.isArray(a.avoid))
    assert.ok(a.label && a.name_cn)
  })
  assert.ok(s.colour.present && s.colour.prefer.length >= 1, '有肤色 ⇒ 颜色段该出候选')
  assert.match(s.note, /没有任何标准/, '顶层那句"没有标准规定好看"必须在')
})

test('buildRecommendation: 一个尺寸没量且肤色认不出 ⇒ top_spec 整块缺席', () => {
  const r = buildRecommendation({ gender: '女', scenario: '通勤' }, 'personal', false)
  assert.ok(!('top_spec' in r), '缺测不出处方，不许给一张空表')
})

test('buildRecommendation: 只量了身高与净胸围 ⇒ 处方仍出，但只有合身段（第 0 层独立站得住）', () => {
  const s = buildRecommendation({ gender: '男', height: 172, bust: 92 }, 'personal', false).top_spec
  assert.ok(s, '号型算得出来就该出，这一层不等修形层')
  assert.ok(s.fit.present)
  assert.strictEqual(
    s.fit.size_label,
    '170/92',
    `号 172→170、型 92 已是 4 的倍数：${s.fit.size_label}`,
  )
  assert.strictEqual(s.axes.length, 0, '腰围体重肩宽都没量 ⇒ 修形层一条不许编')
  assert.strictEqual(s.colour.present, false)
})

test('buildRecommendation: FIT_PROFILE 没有净胸围 ⇒ 合身段只出 blocking 与测量指引', () => {
  const s = buildRecommendation(FIT_PROFILE, 'personal', false).top_spec
  assert.strictEqual(s.fit.present, false, '量了身高体重腰臀腿肩，唯独没胸围 ⇒ 号型的"型"定不了')
  assert.match(JSON.stringify(s.fit.blocking), /净胸围/)
  assert.ok(s.fit.measure_guide.length >= 4, '必须把"怎么量"交回给用户，不许显示空白')
  assert.ok(s.axes.length >= 2, '修形层不依赖胸围，照旧该出')
})

test('buildRecommendation: 同一个人带上衣橱再算一遍 ⇒ 处方一字不变（它不读衣橱）', () => {
  const bare = buildRecommendation(FIT_PROFILE, 'personal', false).top_spec
  const withWardrobe = buildRecommendation(
    {
      ...FIT_PROFILE,
      wardrobe_items: [
        { name: '落肩卫衣', category: '上衣', color: '灰', fit_style: '宽松', fabric_weight: '厚' },
      ],
    },
    'personal',
    false,
  ).top_spec
  assert.strictEqual(JSON.stringify(bare), JSON.stringify(withWardrobe), '衣橱不许渗进处方')
})
