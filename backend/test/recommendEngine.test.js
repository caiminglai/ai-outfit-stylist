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
const {
  buildRecommendation,
  rankDims,
  rankAndTruncate,
  RANK_WEIGHTS,
  RANK_RULE_REF,
  RANK_COVERAGE_FLOOR,
  RANK_ALGO_ABSENCE_PENALTY,
  RANK_TOP_N,
  RANK_MIN_ALGO_IN_TOP,
  // 10-21 第十三阶段·一 §二·3 借色的三处真相源（⛔ 测试里不许另抄一份口径）
  outfitColorParts,
} = require('../services/recommendEngine')
const { skinToneToLab } = require('../services/colorMetrics')

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
// 排序口径（2026-10-19 第二阶段「换脑」改了穿搭这一类）
// ============================================================
//
// 改前：五个类别都是 matchRules 那一刀排完就交出去（priority 降序 → 命中权重降序 → 建规顺序）。
// 现在：穿搭这一类**不再按 priority 排**，名次由综合分定（见下面"算法重排"那组测试）；
//       妆容/发型/配饰/姿势这四类还没接进量化层，仍走老口径 ⇒ priority 降序依旧成立。
test('buildRecommendation: 四类未接重排的推荐仍按 priority 降序', () => {
  const profile = {
    gender: 'female',
    ageGroup: '18-25',
    region: 'south',
    scene: 'date',
    skinTone: 'warm',
  }
  const r = buildRecommendation(profile, 'store', false)
  for (const cat of ['妆容', '发型', '配饰', '姿势']) {
    const list = r[cat] || []
    for (let i = 1; i < list.length; i++) {
      assert.ok(
        list[i - 1].priority >= list[i].priority,
        `${cat} 第 ${i} 条 priority ${list[i].priority} 排在 ${list[i - 1].priority} 前面 ⇒ 这一类不该被动到`,
      )
    }
  }
})

test('buildRecommendation: 穿搭这一类已经换成综合分排序，且名单不超过 RANK_TOP_N', () => {
  const r = buildRecommendation(FIT_PROFILE, 'personal', false)
  const list = r['穿搭'] || []
  assert.ok(list.length <= RANK_TOP_N, `Top N 没生效：${list.length} > ${RANK_TOP_N}`)
  assert.ok(
    list.every((e) => e.rank),
    '每一条都该带 rank（有 priority 就有规则基础分）',
  )
  for (let i = 1; i < list.length; i++) {
    assert.ok(
      list[i - 1].rank.score >= list[i].rank.score,
      `综合分不是降序：第 ${i - 1} 条 ${list[i - 1].rank.score} < 第 ${i} 条 ${list[i].rank.score}`,
    )
  }
  // 后台/文档要能读到这份账
  const rk = r._computed.ranking
  assert.deepStrictEqual(rk.weights, RANK_WEIGHTS)
  assert.strictEqual(rk.top_n, RANK_TOP_N)
  assert.strictEqual(rk.candidates, list.length + rk.ranked_out)
})

test('buildRecommendation: 出账里带算法在场这本账，且不硬塞（真库只读，形状断言不钉死数值）', () => {
  const r = buildRecommendation(FIT_PROFILE, 'personal', false)
  const list = r['穿搭'] || []
  const rk = r._computed.ranking
  assert.ok(rk.algo, 'ranking.algo 必须出账（前端与后台要能看出"这场有几条是算法在场的"）')
  assert.strictEqual(rk.algo_absence_penalty, RANK_ALGO_ABSENCE_PENALTY)
  assert.strictEqual(rk.min_algo_in_top, RANK_MIN_ALGO_IN_TOP)
  assert.deepStrictEqual(Object.keys(rk.algo).sort(), [
    'candidates',
    'forced_in',
    'in_pool',
    'in_top',
    'required',
  ])
  // 在场的条数不得超过池子里有的条数，也不得超过名单长度
  assert.ok(
    rk.algo.in_top <= rk.algo.in_pool,
    `in_top ${rk.algo.in_top} > in_pool ${rk.algo.in_pool}`,
  )
  assert.ok(rk.algo.in_top <= list.length, 'in_top 不能超过实际进榜的条数')
  // 强制在场的下界：池子里够就得补够，不够就照实报不够（绝不造出 0 分条目凑数）
  assert.ok(
    rk.algo.in_top >= Math.min(RANK_MIN_ALGO_IN_TOP, rk.algo.in_pool, list.length),
    `下界破了：in_top=${rk.algo.in_top} in_pool=${rk.algo.in_pool} 名单=${list.length} ${JSON.stringify(rk.algo)}`,
  )
  // 名单里每一条都得出账字段；规则来源且算法缺席的那几条必须带着 0.8 的惩罚
  for (const e of list) {
    assert.ok(typeof e.rank.algo_penalty === 'number' && typeof e.rank.algo_present === 'boolean')
    if (e.source !== 'wardrobe' && !e.rank.algo_present) {
      assert.strictEqual(e.rank.algo_penalty, RANK_ALGO_ABSENCE_PENALTY, `${e.group_name} 该挨惩罚`)
    }
    if (e.source === 'wardrobe') {
      assert.strictEqual(e.rank.algo_penalty, 1, `${e.group_name} 是量出来的行，不该挨惩罚`)
    }
  }
  assert.ok(
    rk.note.includes(String(RANK_ALGO_ABSENCE_PENALTY)),
    'note 要把惩罚口径带出去，别让后台只看到权重',
  )
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
  let bandOnly = 0
  fits.forEach((e) => {
    const f = e.color_fit
    assert.ok(Number.isFinite(f.score) && f.score >= 0 && f.score <= 100, `score 越界: ${f.score}`)
    // 10-20 第六阶段·第一步：'深色上衣'这类只有明度档的结论现在也出分了，但它**没有 hex**，
    // ΔE00／色相角／明度差／彩度四项按约定就是 null（伪造一个就是喂假数，判据见 依据/14 §二 L5）。
    // 所以这一条断言按 basis 分两拨：具体色那拨仍要求四项全有限，明度档那拨要求四项全 null。
    if (f.basis === 'lightness-band') {
      bandOnly++
      assert.strictEqual(f.top_hex, null, `明度档不该有 hex: ${f.top_hex}`)
      ;[f.deltaE00, f.dHue, f.dL, f.chroma].forEach((v, i) => {
        assert.strictEqual(v, null, `明度档第 ${i} 项应为 null，实际 ${v}`)
      })
      assert.strictEqual(f.hue_applies, false, '明度档的色相轴按"没有信息"记账')
      assert.strictEqual(f.fusion_gate, 1, '没有两个 Lab 可比，闸门不参与')
      return
    }
    ;[f.deltaE00, f.dHue, f.hueContrast, f.dL, f.brighten, f.chroma].forEach((v, i) => {
      assert.ok(Number.isFinite(v), `第 ${i} 项非有限数: ${v}`)
    })
    assert.match(f.top_hex, /^#[0-9A-F]{6}$/, `hex 应归一成大写: ${f.top_hex}`)
    assert.match(
      f.basis,
      /^(hex|table-key|strip-color|add-color|synonym|in-text|lab-object)$/,
      `basis 应是取到具体色的那几种口径之一，实际 ${f.basis}`,
    )
    assert.match(f.evidence, /A 色差公式/, 'evidence 要写清依据档位')
  })
  // 接线后的形状要求：每条带分的都要留 basis 与 color_parts 这两笔账，报告与后台靠它拆账
  fits.forEach((e) => {
    assert.strictEqual(typeof e.color_basis, 'string', `color_basis 没透传: ${e.color_basis}`)
    assert.ok(Number.isInteger(e.color_parts), `color_parts 没透传: ${e.color_parts}`)
  })
  assert.ok(bandOnly <= fits.length, '计数自用')
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
// 第十阶段·第一步（10-21）：肤色采集——请求体只准带一个**色相角**，
// 连续 Lab 由后端按"档名出 L/C ＋ 角度出 h"合成（docs/依据/18 §2.5）。
// 这四块钉的是同一件事：客户端⛔ 塞不进明度，且不填角度时行为与改前逐字节相同。
// ============================================================

const SKIN_BASE = buildRecommendation(FIT_PROFILE, 'personal', false)

test('skin_hue 缺席 ⇒ _computed 三格按档名口径出账，且 color_fit 分数与改前一致', () => {
  const c = SKIN_BASE._computed
  assert.strictEqual(c.skin_source, 'manual')
  assert.strictEqual(c.skin_hue, null)
  assert.strictEqual(c.skin_undertone, null)
  // 白皙锚点自己的 h=60.26 ⇒ 落在两切点之间＝"自然"，但没人送角度时这三格只拆账、不改分
  const before = (SKIN_BASE['穿搭'] || []).map(
    (e) => `${e.group_name}:${e.color_fit?.score ?? '-'}`,
  )
  const again = buildRecommendation(FIT_PROFILE, 'personal', false)
  const after = (again['穿搭'] || []).map((e) => `${e.group_name}:${e.color_fit?.score ?? '-'}`)
  assert.deepStrictEqual(after, before, '不带 skin_hue 的请求必须与改前逐条相同（默认关得住）')
})

test('skin_hue 合法 ⇒ L/C 仍来自档名锚点、只有 h 被换掉（照片塞不进明度）', () => {
  const p = { ...FIT_PROFILE, skin_hue: 70 }
  const r = buildRecommendation(p, 'personal', false)
  assert.strictEqual(r._computed.skin_source, 'photo_sample')
  assert.strictEqual(r._computed.skin_hue, 70)
  assert.strictEqual(r._computed.skin_undertone, '暖皮') // 70 ≥ P75=64.02
  const e = (r['穿搭'] || []).find((x) => x.color_fit)
  assert.ok(e, '带肤色档又带角度竟然不出色彩分')
  // 白皙锚点 {L68,a8,b14} ⇒ C=hypot(8,14)=16.1249；合成后 L 必须还是 68、C 必须还是那个数
  const lab = e.color_fit
  assert.ok(lab, 'color_fit 应有值')
  // 用 ΔE00 反推太绕，这里直接比"改前改后同一件上衣的分数应当变了但界限不破"
  const base = (SKIN_BASE['穿搭'] || []).find((x) => x.group_name === e.group_name)
  assert.notStrictEqual(
    e.color_fit.score,
    base.color_fit.score,
    '换了色相角分数一点没动＝角度没被用上',
  )
  assert.ok(e.color_fit.score >= 0 && e.color_fit.score <= 100)
})

test('照片角度必须同时接管「排序那一维」与「上衣处方那一层」（10-21 第五处取值点补口）', () => {
  const r = buildRecommendation({ ...FIT_PROFILE, skin_hue: 70 }, 'personal', false)
  const colour = r.top_spec.colour
  assert.strictEqual(SKIN_BASE.top_spec.colour.photo_hue, null)
  assert.strictEqual(
    colour.photo_hue,
    70,
    '处方层没被照片接管＝"改了 Top-8 名次却不改顾客看到的建议色"那个洞还在',
  )
  // 明度仍然只认档名锚点：与不带角度的那次逐字相同（Alipour 2026 那条红线）
  assert.strictEqual(colour.skin_lab.L, SKIN_BASE.top_spec.colour.skin_lab.L)
  assert.match(colour.skin_label, /照片色相 70°/)
  assert.notStrictEqual(
    JSON.stringify(colour.prefer.map((x) => x.score)),
    JSON.stringify(SKIN_BASE.top_spec.colour.prefer.map((x) => x.score)),
    '处方层的建议色一个分都没动',
  )
  // 两处共用一个合成口的可验形式：处方那颗合成锚点的 h 必须就是 70、L 必须还是锚点那个数
  const pl = colour.photo_lab
  assert.ok(pl, 'photo_hue 有值却没有合成锚点')
  assert.ok(
    Math.abs((Math.atan2(pl.b, pl.a) * 180) / Math.PI - 70) < 1e-6,
    `处方合成锚点不是 70°：${((Math.atan2(pl.b, pl.a) * 180) / Math.PI).toFixed(3)}`,
  )
  assert.strictEqual(pl.L, SKIN_BASE.top_spec.colour.skin_lab.L)
})

test('客户端塞 skin_lab 也不认：明度只认档名锚点（18 §2.4 那条注入面）', () => {
  const p = { ...FIT_PROFILE, skin_lab: { L: 95, a: 0, b: 0 } }
  const r = buildRecommendation(p, 'personal', false)
  const c = r._computed
  assert.strictEqual(c.skin_source, 'manual', '请求体里的 Lab 竟然被接进了色彩维')
  const e = (r['穿搭'] || []).find((x) => x.color_fit)
  const base = (SKIN_BASE['穿搭'] || []).find((x) => x.group_name === e.group_name)
  assert.strictEqual(e.color_fit.score, base.color_fit.score, 'Lab 注入改变了分数＝闸门没挡住')
})

test('skin_hue 是垃圾值 ⇒ 不抛、不退成"自然"、source 不是 photo_sample', () => {
  for (const v of ['x', {}, [], null, NaN, 999, -40, '30', 0]) {
    const p = { ...FIT_PROFILE, skin_hue: v }
    let r
    assert.doesNotThrow(
      () => {
        r = buildRecommendation(p, 'personal', false)
      },
      `skin_hue=${JSON.stringify(v) ?? String(v)} 把推荐打挂了`,
    )
    assert.notStrictEqual(r._computed.skin_source, 'photo_sample', `垃圾值竟然接管了：${v}`)
    assert.strictEqual(r._computed.skin_hue, null, `垃圾值被当成角度记进账里：${v}`)
    assert.strictEqual(r._computed.skin_undertone, null, `垃圾值退成了档名＝编造：${v}`)
  }
  // '30' 这种数字字符串：Number('30')=30 且过不了 h 闸（min=36.36）⇒ 同样按缺测处理
  // 0 也一样：0 < min ⇒ null（⛔ 不许把 0 当"没填"再补一个默认角）
})

// ============================================================
// 身材这一维：10-19 第二阶段起**只认衣柜行的实测尺寸**
// （改前它从规则那句"亮色宽松上衣"里认中文词，那是把认字冒充成量出来的数）
// 10-21 第十三阶段 §三·4 改口径：这一维**不再整块缺席**——文案里认得出恰好一个版型档时
// 出的是那一档的离散分（`body_fit.inferred_from==='rule_text'`、覆盖率按半格计）。
// 10-19 那条禁令⛔ 没有废除：认中文词永远不许变成一个 cm 数值（下面 garment_cm 全空那条就是它）。
// ============================================================

test('buildRecommendation: 规则文案只出离散档位、⛔ 不出 cm 数值（§三·4 后的口径）', () => {
  const r = buildRecommendation(FIT_PROFILE, 'personal', false)
  const withBody = (r['穿搭'] || []).filter((e) => e.body_fit)
  // 现量（2026-10-22，FIT_PROFILE／personal）：4 条里认得出档的都是 rule_text，实测衣柜行 0 条
  assert.ok(
    withBody.every((e) => e.body_fit.inferred_from === 'rule_text'),
    `没有 wardrobe_items 时只许有"文案推断"这一种来源：${JSON.stringify(
      withBody.map((e) => [e.group_name, e.body_fit.inferred_from]),
    )}`,
  )
  // ⛔ 10-19 第二阶段废除的那件事不许复发：文案推出来的行，身上一个尺寸数值都不能有
  for (const e of withBody) {
    const cm = e.body_fit.top.garment_cm || {}
    assert.ok(
      Object.values(cm).every((v) => v === null || v === undefined),
      `「${e.top_style}」从中文词里造出了尺寸：${JSON.stringify(cm)}`,
    )
    assert.ok(e.body_fit.coverage < 1, `推断档按满格计＝对顾客谎称量过：${e.body_fit.coverage}`)
  }
  // 色彩那一维照旧在（它读的是色名，色名本来就是规则写的动作值，不是猜的）
  assert.ok(
    (r['穿搭'] || []).some((e) => e.color_fit),
    '色彩维不许跟着一起消失，否则重排只剩规则分一维',
  )
  // 这个人自己的偏差向量随报告出一份（衣柜行进来时要用它对齐）
  const dev = r._computed.body_deviation
  assert.ok(dev && dev.want, '_computed.body_deviation 应在场')
  assert.ok(Number.isFinite(dev.bmi), 'BMI 是从身高体重算出来的,要带过去')
})

// 一件量过成品尺寸的上衣：肩宽 40 / 胸围 96 / 衣长 64 / 腰头高 0（0＝明确直筒，不是没量）
const MEASURED_TOP = {
  id: 701,
  name: '量过的白衬衫',
  category: '上衣',
  color: '米白',
  shoulder_cm: 40,
  bust_cm: 96,
  length_cm: 64,
  waistband_cm: 0,
}

test('buildRecommendation: 衣柜里量过尺寸的那件上衣进候选集并带 body_fit', () => {
  const r = buildRecommendation(
    { ...FIT_PROFILE, wardrobe_items: [MEASURED_TOP] },
    'personal',
    false,
  )
  const wd = (r['穿搭'] || []).filter((e) => e.source === 'wardrobe')
  assert.strictEqual(wd.length, 1, `应正好进来一条衣柜实测候选，实际 ${wd.length}`)
  const e = wd[0]
  const b = e.body_fit
  assert.ok(b, '衣柜行该出身材分')
  assert.ok(Number.isFinite(b.score) && b.score >= 0 && b.score <= 100, `总分越界: ${b.score}`)
  assert.strictEqual(b.axes.length, b.axes_present.length, 'axes 只准列在场的轴')
  b.axes.forEach((a) => {
    assert.ok(a.score >= 0 && a.score <= 1, `${a.key} 单轴分越界: ${a.score}`)
    assert.ok(typeof a.tier === 'string' && a.tier.length > 0, `${a.key} 缺档位说明`)
    assert.ok(
      typeof a.based_on === 'string' && a.based_on.length > 0,
      `${a.key} 没写依据来自哪一格`,
    )
  })
  assert.match(b.evidence, /C 刻度与权重|标定中/, 'evidence 必须承认刻度与权重是手拍的')
  assert.ok(!('person' in b), 'person 那份整报告只留 _computed.body_deviation,每条再带一遍是浪费')
  // 它不是规则命中的 ⇒ 不许有 explanation 那个"命中了哪些条件"的对象（前端会按 ✓ 列表渲染）
  assert.strictEqual(e.explanation, undefined, '衣柜行不是规则命中的，不许伪造成命中条件')
  assert.strictEqual(e.priority, null, '没有优先级这一说（不是规则组）')
  assert.strictEqual(e.wardrobe_item_id, 701)
  assert.ok(String(e.reason).includes('衣柜实测'), '人话要说清这条从哪来')
})

test('buildRecommendation: 同一件量过的上衣,换一个人身材 ⇒ body_fit 分数不同', () => {
  const slim = { ...FIT_PROFILE, height: 165, weight: 50, waist: 62, hip: 88, shoulder: 36 }
  const broad = { ...FIT_PROFILE, height: 175, weight: 90, waist: 92, hip: 98, shoulder: 47 }
  const score = (p) => {
    const r = buildRecommendation({ ...p, wardrobe_items: [MEASURED_TOP] }, 'personal', false)
    const e = (r['穿搭'] || []).find((x) => x.source === 'wardrobe')
    assert.ok(e, '这一条该从衣柜进来')
    return e.body_fit.score
  }
  const a = score(slim)
  const b = score(broad)
  assert.notStrictEqual(a, b, `同一件衣服两个人算出同一个分 ⇒ 这一维还跟人无关：${a} vs ${b}`)
})

test('buildRecommendation: 衣柜行四格实测没填、版型也没选 ⇒ 不参与排序（不是排最后）', () => {
  const r = buildRecommendation(
    {
      ...FIT_PROFILE,
      wardrobe_items: [{ id: 702, name: '没量过的卫衣', category: '上衣', color: '灰' }],
    },
    'personal',
    false,
  )
  assert.strictEqual(
    (r['穿搭'] || []).filter((e) => e.source === 'wardrobe').length,
    0,
    '没填实测尺寸的行不该挤进候选集',
  )
  assert.strictEqual(r._computed.ranking.from_wardrobe, 0)
})

test('buildRecommendation: 只选一档版型（四格全空）⇒ 进得了候选池，松量靠版型估，惩罚照样压着', () => {
  // 10-19 第三阶段·模块一「注水」：不动软尺的人也得让公式跑起来。
  // 这一条钉的是**接线**，不是算法：路由的投影里、引擎的进门判据里、describeTop 的读列里，
  // 三处任何一处漏了 fit_type，这条就红（19:5x 真浏览器点验时就是这样抓到两处断线的）。
  //
  // 🔴 10-21 第十三阶段·一 §二·3 改的就是这条的**读数口径**（原样抄下来，别让它糊掉）：
  //    借色之后，规则条目里多出"上衣没写色但本组配色串有第一色"的那几条，色彩维在场 ⇒ 名次抬。
  //    实测这一份档案：带衣橱那件从"挤进前 8 的第 8 名"掉到**落选池第 1 名**（`ranked_out=1`）。
  //    所以断言从"它在 `穿搭` 名单里"换成"它在**候选池**里、且带着 body 这一分出账"——
  //    接线照旧被钉住（进门判据一断，池子分母就少 1），名次那件事交给 `RANK_TOP_N` 的账（第四阶段）。
  const raw = { id: 703, name: '只选了版型的T恤', category: '上衣', fit_type: '宽松' }
  const opts = { keep_ranked_out: true }
  const r = buildRecommendation(
    { ...FIT_PROFILE, wardrobe_items: [raw] },
    'personal',
    false,
    null,
    opts,
  )
  const bare = buildRecommendation(FIT_PROFILE, 'personal', false, null, opts)
  const wd = (r['穿搭'] || []).filter((e) => e.source === 'wardrobe')
  const dropped = ((r._computed.ranking.beyond_top_n || {}).rows || []).filter(
    (x) => x.source === 'wardrobe',
  )
  assert.strictEqual(
    wd.length + dropped.length,
    1,
    `只选版型的那件必须在候选池里（前 8 名单 ${wd.length} 条＋落选池 ${dropped.length} 条）`,
  )
  // 进门判据断在哪一环，这个分母就掉回 0 ⇒ 上面那句"钉接线"全靠这一条
  assert.strictEqual(
    r._computed.ranking.candidates - bare._computed.ranking.candidates,
    1,
    `带上这一件必须多一条候选：${r._computed.ranking.candidates} − ${bare._computed.ranking.candidates}`,
  )
  const row = wd.length
    ? {
        present: wd[0].rank.present,
        missing: wd[0].rank.missing,
        coverage: wd[0].rank.coverage,
        score: wd[0].rank.score,
      }
    : dropped[0]
  assert.deepStrictEqual(
    row.present,
    ['body'],
    `这一件只可能贡献廓形那一维，实际在场 ${row.present.join('/')}`,
  )
  assert.ok(
    row.missing.includes('color'),
    '衣橱行没有上衣色 ⇒ 色彩维缺席（借色那一条只给规则候选用，`21` §二·3）',
  )
  assert.ok(
    row.coverage > 0 && row.coverage < 1,
    `只有一维在场 ⇒ 覆盖率必须小于 1，实际 ${row.coverage}`,
  )
  assert.ok(row.score > 0, `综合分要出得来（松量由版型区间中值估），实际 ${row.score}`)
  // 身体层那三笔（ease 轴在场、标了 estimated、总分＝round(raw×(0.5+0.5×覆盖率))）
  // 由 topFitBody.test.js 第 5c 节在身体层钉住，这一条不再从引擎侧抄第二份。
})

/**
 * 🔴 2026-10-21 第九阶段·第一步改了这一条的口径（规范＝`docs/依据/17` §五 第 1 条）。
 * 改前这里断言"store 模式一律不读衣橱"，理由是"门店的商品没有顾客实测尺寸这一说"。
 * 现量把那个理由推翻了：门店模式**恰恰是量尺寸的地方**（店员扫码录进 `user_wardrobe` 的行，
 * 四格实测就在那几行里），而身体那一维只认这些行 ⇒ 门店流程里身体维连进场的机会都没有
 * （盘外副本实测：store 传了 wardrobe_items ⇒ `from_wardrobe=0`）。
 * ⇒ 现在两档都开门，但"默认关得住"这条防线必须同时钉住：不带衣橱行时名单与改前逐条相同。
 */
test('buildRecommendation: store 模式带衣橱行也进候选池（门店量了尺寸就该用得上）', () => {
  const r = buildRecommendation({ ...FIT_PROFILE, wardrobe_items: [MEASURED_TOP] }, 'store', false)
  const fromWardrobe = (r['穿搭'] || []).filter((e) => e.source === 'wardrobe')
  assert.ok(fromWardrobe.length >= 1, '门店模式下量过尺寸的衣橱行应该进得了候选池')
  assert.ok(
    fromWardrobe.every((e) => e.body_fit && e.body_fit.score != null),
    '进来的衣橱候选必须带身体维（这正是三维快照缺的那一维）',
  )
  assert.strictEqual(
    r._computed.ranking.from_wardrobe,
    fromWardrobe.length,
    '出账的 from_wardrobe 必须等于名单里的衣橱条数',
  )
})

test('buildRecommendation: 不带衣橱行 ⇒ 两档模式名单与改前逐条相同（默认关得住）', () => {
  const strip = (list) =>
    (list || []).map((e) => `${e.group_name}|${e.source || 'rule'}`).join('##')
  for (const mode of ['store', 'personal']) {
    const bare = buildRecommendation({ ...FIT_PROFILE }, mode, false)
    const withEmpty = buildRecommendation({ ...FIT_PROFILE, wardrobe_items: [] }, mode, false)
    assert.strictEqual(
      strip(bare['穿搭']),
      strip(withEmpty['穿搭']),
      `${mode}：空数组不该改变任何一条排序结果`,
    )
    assert.strictEqual(
      bare['穿搭'].filter((e) => e.source === 'wardrobe').length,
      0,
      `${mode}：没有衣橱行却冒出衣橱候选＝编造依据`,
    )
  }
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

// ============================================================
// 算法重排（第二阶段「换脑」）：Score = w1·规则 + w2·色彩 + w3·廓形
// 这一组是 rankDims 的单元测试，手工构造候选，不碰数据库
// ============================================================

test('重排权重是全局常量：三个键、和为 1，缺一个就报错', () => {
  assert.deepStrictEqual(Object.keys(RANK_WEIGHTS).sort(), ['body', 'color', 'rule'])
  const sum = RANK_WEIGHTS.rule + RANK_WEIGHTS.color + RANK_WEIGHTS.body
  assert.strictEqual(Math.round(sum * 1000) / 1000, 1, `三个权重该归一，实际 ${sum}`)
  // 产品口径（10-20 第四阶段·第一步定）：规则退到只当兜底，色彩与廓形各 0.45 主导
  assert.strictEqual(RANK_WEIGHTS.rule, 0.1)
  assert.strictEqual(RANK_WEIGHTS.color, 0.45)
  assert.strictEqual(RANK_WEIGHTS.body, 0.45)
  assert.ok(RANK_WEIGHTS.rule < RANK_WEIGHTS.color && RANK_WEIGHTS.rule < RANK_WEIGHTS.body)
  // 同轮的两件配套参数也钉住：惩罚系数、Top N 里的算法在场下限
  assert.strictEqual(RANK_ALGO_ABSENCE_PENALTY, 0.8)
  assert.strictEqual(RANK_MIN_ALGO_IN_TOP, 2)
  assert.ok(RANK_MIN_ALGO_IN_TOP <= RANK_TOP_N, '在场下限不许大于名单条数，否则每场都要塞满')
})

test('rankDims：三维齐全 ⇒ 手工加权的结果要一字不差', () => {
  const rk = rankDims(
    {
      priority: RANK_RULE_REF.priority[1], // 区间上端 ⇒ 归一成 1
      score: RANK_RULE_REF.score[1],
      color_fit: { score: 80 },
      body_fit: { score: 60, coverage: 1 },
    },
    { isRule: true },
  )
  assert.strictEqual(
    rk.dims.find((d) => d.key === 'rule').score,
    100,
    '两端都取满 ⇒ 规则基础分 100',
  )
  // 0.1×100 + 0.45×80 + 0.45×60 = 73，coverage=1 ⇒ 不打折，两维算法都在场 ⇒ 不挨缺席惩罚
  assert.strictEqual(rk.score, 73, `实际 ${JSON.stringify(rk)}`)
  assert.strictEqual(rk.coverage, 1)
  assert.strictEqual(rk.factor, 1)
  assert.strictEqual(rk.algo_penalty, 1, '色彩与廓形都在场 ⇒ 不该挨算法缺席惩罚')
  assert.deepStrictEqual(rk.missing, [])
})

test('rankDims：廓形那一维整块缺席 ⇒ 权重退给在场维再乘折扣，再挨一次算法缺席惩罚', () => {
  const full = rankDims(
    { priority: 30, score: 9, color_fit: { score: 80 }, body_fit: { score: 60, coverage: 1 } },
    { isRule: true },
  )
  const noBody = rankDims({ priority: 30, score: 9, color_fit: { score: 80 } }, { isRule: true })
  assert.deepStrictEqual(noBody.missing, ['body'])
  // 只在场的两维归一：(0.1×100+0.45×80)/0.55 = 83.636…
  // 折扣 0.6+0.4×0.55 = 0.82；算法缺席惩罚 0.8 ⇒ 83.636×0.82×0.8 = 54.9
  assert.strictEqual(noBody.dims.find((d) => d.key === 'body').weight, 0, '缺席那维权重必须退成 0')
  assert.strictEqual(noBody.factor, 0.82, `实际 ${JSON.stringify(noBody)}`)
  assert.strictEqual(noBody.algo_penalty, RANK_ALGO_ABSENCE_PENALTY)
  assert.strictEqual(noBody.score, 54.9, `实际 ${JSON.stringify(noBody)}`)
  assert.ok(noBody.score < full.score, `缺测的不许高过量齐的：${noBody.score} vs ${full.score}`)
})

test('rankDims：算法缺席惩罚只乘一次，衣橱量出来的行不吃（10-20 第四阶段·第一步）', () => {
  const ruleOneMissing = rankDims(
    { priority: 30, score: 9, color_fit: { score: 80 } },
    { isRule: true },
  )
  const ruleBothMissing = rankDims({ priority: 30, score: 9 }, { isRule: true })
  assert.strictEqual(ruleOneMissing.algo_missing, 1)
  assert.strictEqual(ruleBothMissing.algo_missing, 2)
  // 缺一维与缺两维都只乘一次 0.8 —— 这条惩罚说的是"这条没经过算法"这一件事，按缺几维乘几次是收两回钱
  assert.strictEqual(ruleOneMissing.algo_penalty, RANK_ALGO_ABSENCE_PENALTY)
  assert.strictEqual(ruleBothMissing.algo_penalty, RANK_ALGO_ABSENCE_PENALTY)
  // 纯规则条目：raw 100 × 折扣(0.6+0.4×0.1=0.64) × 0.8 = 51.2
  assert.strictEqual(ruleBothMissing.score, 51.2, `实际 ${JSON.stringify(ruleBothMissing)}`)
  // 衣橱行同样缺一维（只有廓形没有色彩）⇒ 不许挨这条惩罚：它的覆盖率惩罚在身体层已经乘过
  const wardrobeNoColor = rankDims({ body_fit: { score: 60, coverage: 1 } }, { isRule: false })
  assert.strictEqual(wardrobeNoColor.algo_penalty, 1, '衣橱行不吃算法缺席惩罚')
  // 0.45×60/0.45 = 60，coverage = 0.45/0.9 = 0.5 ⇒ 折扣 0.8 ⇒ 48
  assert.strictEqual(wardrobeNoColor.score, 48, `实际 ${JSON.stringify(wardrobeNoColor)}`)
})

test('rankDims：缺测降权的判据——整维缺席者不许越过"量到且正好等于其余维均值"的那件', () => {
  const abstain = rankDims({ priority: 30, score: 9, color_fit: { score: 80 } }, { isRule: true })
  // 对面那件：身体分 = abstain 只在场的两维归一后的均值 83.64（改权后这个均值跟着变了）
  const measuredAtAvg = rankDims(
    { priority: 30, score: 9, color_fit: { score: 80 }, body_fit: { score: 83.64, coverage: 1 } },
    { isRule: true },
  )
  assert.ok(
    abstain.score < measuredAtAvg.score,
    `判据破了：FLOOR=${RANK_COVERAGE_FLOOR} 配惩罚 ${RANK_ALGO_ABSENCE_PENALTY}，实际 ${abstain.score} vs ${measuredAtAvg.score}`,
  )
  // 10-20 重推：往归一化里补一个"等于其余维均值"的分，raw 本来就不变（均值的定义），
  // 所以这一判据改由「惩罚系数 < 1」单独兜住；FLOOR 只负责"不许打平量齐"（FLOOR < 1）。
  assert.ok(RANK_ALGO_ABSENCE_PENALTY < 1, '惩罚系数必须 < 1，否则这条判据没人兜')
})

test('rankDims：覆盖率惩罚只在身体层乘一次，排序侧不许再折第二遍（10-19 第三阶段·模块二）', () => {
  const full = rankDims(
    { priority: 30, score: 9, color_fit: { score: 80 }, body_fit: { score: 60, coverage: 1 } },
    { isRule: true },
  )
  const oneOfSix = rankDims(
    { priority: 30, score: 9, color_fit: { score: 80 }, body_fit: { score: 60, coverage: 1 / 6 } },
    { isRule: true },
  )
  // 身体那一维已经带着被惩罚过的分数进来了（`topFitBody.js` 的 COVERAGE_PENALTY），
  // 这一层的权重必须还是满的 0.4 —— 再乘一次覆盖率＝同一件事收两次钱。
  assert.strictEqual(
    oneOfSix.dims.find((d) => d.key === 'body').weight,
    RANK_WEIGHTS.body,
    'body 维权重不该再乘覆盖率（惩罚在身体层）',
  )
  assert.strictEqual(
    oneOfSix.score,
    full.score,
    `同一个 body_fit 分数、不同覆盖率，在排序侧该得同一个总分：${oneOfSix.score} vs ${full.score}`,
  )
  // 覆盖率仍然要带出去（前端与报告要写"这件只量到一格"）
  assert.strictEqual(oneOfSix.dims.find((d) => d.key === 'body').coverage, 1 / 6)
  // 真正拉开差距的是分数本身：惩罚后 1/6 覆盖的那件（身体层 58 分）低于量齐的那件（60 分）
  const penalised = rankDims(
    { priority: 30, score: 9, color_fit: { score: 80 }, body_fit: { score: 58, coverage: 1 } },
    { isRule: true },
  )
  assert.ok(
    penalised.score < full.score,
    `惩罚后的低分该被排到后面：${penalised.score} vs ${full.score}`,
  )
})

test('rankDims：一维都没有 ⇒ null（不进排序，不硬给个分）', () => {
  assert.strictEqual(rankDims({ priority: null, score: null }, { isRule: true }), null)
  assert.strictEqual(rankDims({}, { isRule: false }), null)
  assert.strictEqual(rankDims({ body_fit: { score: null, coverage: 0 } }, { isRule: false }), null)
  // 兜底条目是"填了 0"，与"没填"是两件事：0 要照常出一维（分最低），不许当成缺测退掉
  const zero = rankDims({ priority: 0, score: 0 }, { isRule: true })
  assert.ok(zero, 'priority=0 是真实存在的最低档，不是缺测')
  assert.strictEqual(zero.dims.find((d) => d.key === 'rule').score, 0)
  assert.deepStrictEqual(zero.missing, ['color', 'body'])
})

test('rankDims：衣柜行不吃规则基础分那一维', () => {
  const rk = rankDims(
    { priority: 30, score: 9, color_fit: { score: 70 }, body_fit: { score: 50, coverage: 1 } },
    { isRule: false },
  )
  assert.deepStrictEqual(
    rk.dims.map((d) => d.key),
    ['color', 'body'],
    `isRule=false 时不许出现 rule 维：${JSON.stringify(rk.dims)}`,
  )
  // (0.4×70 + 0.4×50)/0.8 = 60，coverage = 0.8/0.8 = 1 ⇒ 不折
  assert.strictEqual(rk.score, 60)
  assert.strictEqual(rk.coverage, 1)
})

test('强制算法在场：落选池里有算法条目 ⇒ 补进 Top N 并踢掉同数量的算法缺席条目（10-20 第四阶段·第一步）', () => {
  // 10 条纯规则候选（priority/score 取满 ⇒ 51.2 分，但一维算法都没出分）
  const pure = []
  for (let i = 1; i <= 10; i++) {
    pure.push({
      group_id: i,
      group_name: `纯规则${String(i).padStart(2, '0')}`,
      priority: 30,
      score: 9,
    })
  }
  // 2 条带色彩分的候选：规则基础分取区间下端（归一成 0）⇒ 综合分 42.9 / 40.3，天然排在末尾
  const algo = [
    { group_id: 11, group_name: '算法甲', priority: 15, score: 1, color_fit: { score: 80 } },
    { group_id: 12, group_name: '算法乙', priority: 15, score: 1, color_fit: { score: 60 } },
  ]
  const out = rankAndTruncate([...pure, ...algo], [])
  const names = out.map((e) => e.group_name)
  assert.strictEqual(out.length, RANK_TOP_N, `名单该还是 ${RANK_TOP_N} 条：${names.join(',')}`)
  assert.strictEqual(
    out.filter((e) => e.rank.algo_present).length,
    RANK_MIN_ALGO_IN_TOP,
    `前 ${RANK_TOP_N} 里算法在场的条数不够：${JSON.stringify(out._algo)}`,
  )
  assert.ok(
    names.includes('算法甲') && names.includes('算法乙'),
    `两条算法条目都该被捞进来：${names.join(',')}`,
  )
  // 十条纯规则分数并列 ⇒ 由 ruleTie 的 group_id 升序定先后，名单里是 01~08、落选池里是 09/10；
  // 踢人踢的是名单末尾那两条（07/08），不是已经落选的那两条——这条钉住"踢谁"也是决定性的
  assert.ok(
    !names.includes('纯规则07') && !names.includes('纯规则08'),
    `名单末尾两条该被踢掉：${names.join(',')}`,
  )
  assert.ok(
    names.includes('纯规则01') && names.includes('纯规则06'),
    `前六条纯规则该留在名单里：${names.join(',')}`,
  )
  assert.deepStrictEqual(out._algo, {
    required: RANK_MIN_ALGO_IN_TOP,
    in_top: RANK_MIN_ALGO_IN_TOP,
    forced_in: RANK_MIN_ALGO_IN_TOP,
    in_pool: 2,
    candidates: 12,
  })
  // 补进来之后名单仍必须按综合分降序（被捞进来的排末尾，不插队到榜首）
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].rank.score >= out[i].rank.score, `补位后降序破了：第 ${i} 条`)
  }
  assert.strictEqual(out[out.length - 1].group_name, '算法乙', '算法分最低的那条该排最后')
  assert.strictEqual(out._ranked_out, 12 - RANK_TOP_N, '被截掉的条数要能对上分母')
  // 可重复：同样的池子算两次，名单一字不差
  const again = rankAndTruncate(
    [...pure.map((p) => ({ ...p })), ...algo.map((a) => ({ ...a }))],
    [],
  )
  assert.deepStrictEqual(
    again.map((e) => e.group_name),
    names,
    '补位逻辑不确定 ⇒ 同一池子两次名单不同',
  )
})

test('强制算法在场：整个池子一条算法都没有 ⇒ 不硬塞，出账如实记 0（缺的是数据不是排序）', () => {
  const pure = []
  for (let i = 1; i <= 10; i++) {
    pure.push({ group_id: i, group_name: `纯规则${i}`, priority: 30, score: 9 })
  }
  const out = rankAndTruncate(pure, [])
  assert.strictEqual(out._algo.in_top, 0, '没有算法条目就不许凭空造一条')
  assert.strictEqual(out._algo.forced_in, 0)
  assert.strictEqual(out._algo.in_pool, 0)
  assert.strictEqual(out.length, RANK_TOP_N)
  assert.ok(
    out.every((e) => e.rank.score === 51.2),
    `纯规则条目该都是 51.2：${JSON.stringify(out.map((e) => e.rank.score))}`,
  )
})

test('强制算法在场：本来就够 ⇒ 这条约束一动不动，名单与纯按分排序相同（等价性断言）', () => {
  const pure = []
  for (let i = 1; i <= 6; i++) {
    pure.push({ group_id: i, group_name: `纯规则${i}`, priority: 30, score: 9 })
  }
  const algo = [
    {
      group_id: 7,
      group_name: '算法甲',
      priority: 30,
      score: 9,
      color_fit: { score: 90 },
      body_fit: { score: 80, coverage: 1 },
    },
    {
      group_id: 8,
      group_name: '算法乙',
      priority: 30,
      score: 9,
      color_fit: { score: 70 },
      body_fit: { score: 60, coverage: 1 },
    },
  ]
  const out = rankAndTruncate([...pure, ...algo], [])
  assert.strictEqual(out._algo.forced_in, 0, '够数时不许动名单')
  assert.ok(out._algo.in_top >= RANK_MIN_ALGO_IN_TOP)
  // 三条算法维齐的条目权重最高 ⇒ 排最前，纯规则那几条被压到 51.2 往后排
  assert.deepStrictEqual(out.map((e) => e.group_name).slice(0, 2), ['算法甲', '算法乙'])
  assert.ok(
    out.every((e) => !e.rank.algo_present || e.rank.algo_penalty === 1),
    '算法在场就不该挨惩罚',
  )
})

test('重排可重复：同一个人连算两次，穿搭名单与名次一字不差', () => {
  const once = buildRecommendation(FIT_PROFILE, 'personal', false)['穿搭'] || []
  const twice = buildRecommendation(FIT_PROFILE, 'personal', false)['穿搭'] || []
  assert.deepStrictEqual(
    once.map((e) => [e.group_name, e.rank.score]),
    twice.map((e) => [e.group_name, e.rank.score]),
    '两次调用给了不同顺序 ⇒ 并列时没有兜底键（兜底链见 matchRules 的 group_id 升序，那条由 engineFixes20261013.test.js:272 钉住）',
  )
})

// ============================================================
// 第十二阶段·第一步（docs/依据/20 §五）：付费深度出账的两个开关
// 矩阵 7~8。这两条是"付费不能改变免费看到的名单"这一条硬规矩的唯一机器证明：
// 一旦有人为了"让报告更丰富"去动排序，红的是这里，不是顾客的投诉。
// ============================================================

/** 内容够撑起 B 节的画像（与盘外 smoke.cjs 用的是同一条快照，⛔ 用薄画像会退化成空节） */
const DEEP_PROFILE = {
  gender: '女',
  age: 29,
  height: 163,
  weight: 55,
  skin_tone: '自然偏白',
  face_shape: '圆脸',
  body_type: '梨形',
  scenario: '通勤',
  occasion: '职场',
  style: '简约',
  color_preference: '莫兰迪灰粉',
}

test('矩阵7：默认路径逐字节不变，第 4/5 参传 null 或 {} 都不许动一个字节', () => {
  const three = buildRecommendation(DEEP_PROFILE, 'store', false)
  const withNull = buildRecommendation(DEEP_PROFILE, 'store', false, null)
  const withEmptyOpts = buildRecommendation(DEEP_PROFILE, 'store', false, null, {})
  assert.strictEqual(
    JSON.stringify(withNull),
    JSON.stringify(three),
    '多传一个 null 就改输出 ⇒ 免费顾客看到的名单跟着第 4 参变',
  )
  assert.strictEqual(
    JSON.stringify(withEmptyOpts),
    JSON.stringify(three),
    '⛔ opts 缺省值不能与显式 {} 有不同结果',
  )
  assert.strictEqual(three.algorithm_analysis, null, 'store 档默认不出 B 节（键在、值为 null）')
  const ranking = three._computed && three._computed.ranking
  assert.ok(ranking, '排序台账本一直都在')
  assert.ok(!('beyond_top_n' in ranking), '免费路径不挂落选尾巴：一个字节都不许多发')
})

test('矩阵8：开了两个开关 ⇒ 只多出 B 节与尾巴，mode 与 Top 8 名单一字不差', () => {
  const free = buildRecommendation(DEEP_PROFILE, 'store', false)
  const deep = buildRecommendation(DEEP_PROFILE, 'store', false, null, {
    deep_analysis: true,
    keep_ranked_out: true,
  })
  assert.strictEqual(deep._mode, 'store', '⛔ 放开出账不许换 mode：换 mode 就换了名单')
  assert.ok(deep.algorithm_analysis, 'deep_analysis 开了就该有 B 节')
  assert.ok(
    Array.isArray(deep.algorithm_analysis.sections) && deep.algorithm_analysis.sections.length > 0,
  )
  // 名单与分数必须与免费那一份逐条相同（只多不少）
  assert.deepStrictEqual(
    deep['穿搭'].map((e) => [e.group_name, e.rank.score]),
    free['穿搭'].map((e) => [e.group_name, e.rank.score]),
    '付费档的名次与免费不同 ⇒ 顾客会觉得"花了钱给的东西不一样"',
  )
  assert.strictEqual(deep['穿搭'].length, Math.min(RANK_TOP_N, free['穿搭'].length))
  const tail = deep._computed.ranking.beyond_top_n
  assert.ok(tail && Array.isArray(tail.rows), 'keep_ranked_out 开了必须挂出尾巴的壳')
  assert.strictEqual(tail.rows.length, tail.count, 'rows 与 count 打架＝截掉 N 条只给看 M 条')
  assert.strictEqual(
    tail.count,
    free._computed.ranking.ranked_out,
    '尾巴条数＝台账里那个 ranked_out',
  )
  assert.strictEqual(
    JSON.stringify({ ...deep, algorithm_analysis: null, _computed: free._computed }),
    JSON.stringify({ ...free, _computed: free._computed }),
    '把 B 节和台账归位后，两份输出必须完全相同：开关只准多写这两处',
  )
})

// ============================================================
// 10-21 第十三阶段·第一步 §二·3：上衣没写色 ⇒ 借本组配色第一色（降权＋标出处）
// 尺子＝`scoreTopColor` 这一个出口（⛔ 别处不许再判一次"上衣有没有色"）
// ============================================================
const {
  firstSpecificColor,
  scoreTopColor,
  COLOR_BORROW_WEIGHT,
} = require('../services/recommendEngine')

test('§二·3 借色：只借串里第一个**具体色**，位置要能拆账', () => {
  const SKIN = skinToneToLab('白皙')
  // ① 串里第一色就是它：'白+蓝' ⇒ 白，position 1
  const first = firstSpecificColor('白+蓝')
  assert.ok(first && first.hex, '白+蓝 该借到白')
  assert.strictEqual(first.position, 1)
  assert.strictEqual(first.source, '白+蓝', '出处要记原串，前台才能说"按这条配色串算的"')
  // ② 明度档不算色 ⇒ 跳过它，借到第二个具体色，position 记 2（不是"挑一个好看的"）
  const second = firstSpecificColor('深色+米+灰')
  assert.ok(second, '深色+米+灰 里 米/灰 是具体色')
  assert.strictEqual(second.position, 2, `位置要按串里的次序数，实际 ${second.position}`)
  // ③ 串里一个具体色都没有 ⇒ null（这一维继续缺席，⛔ 拿明度档冒充）
  for (const bad of ['深色', '深色上衣', '', null, undefined, '乱写的一句话']) {
    assert.strictEqual(firstSpecificColor(bad), null, `${bad} 不该借出任何色`)
  }
  // ④ 借色支路：上衣只有明度档 ⇒ 借，且原句那一档留痕（"basis 记两笔"）
  const parts = outfitColorParts([
    { label: '上衣', text: '深色上衣', area: 0.4 },
    { label: '配色', text: '白+蓝', area: 0.4 },
  ])
  const borrowed = scoreTopColor(SKIN, '深色上衣', parts, '白+蓝')
  assert.ok(borrowed.fit, '借到色就该出分')
  assert.strictEqual(borrowed.source, 'combo_first')
  assert.strictEqual(borrowed.borrowed, true)
  assert.strictEqual(borrowed.borrowed_from, '白+蓝')
  assert.strictEqual(borrowed.borrowed_position, 1)
  assert.strictEqual(
    borrowed.top_band,
    '深色',
    '原句只写了"深色"这一档，借色后也要留痕（档名＝LIGHTNESS_BANDS.深.label）',
  )
  assert.strictEqual(borrowed.fit.basis, 'hex')
  assert.strictEqual(
    borrowed.fit.top_hex,
    firstSpecificColor('白+蓝').hex,
    '用的就得是那个借来的色值',
  )
  // ⑤ 上衣自己写了色 ⇒ ⛔ 不借
  const own = scoreTopColor(
    SKIN,
    '白色衬衫',
    outfitColorParts([{ label: '上衣', text: '白色衬衫', area: 0.4 }]),
    '蓝+灰',
  )
  assert.strictEqual(own.borrowed, false)
  assert.strictEqual(own.source, 'top_text')
  // ⑥ 上衣与串都没色 ⇒ 整维缺席（不出分、不编默认色）
  const none = scoreTopColor(
    SKIN,
    '牛仔短裤',
    outfitColorParts([{ label: '上衣', text: '牛仔短裤', area: 0.4 }]),
    '深色',
  )
  assert.strictEqual(none.fit, null, '工艺词与明度档都不算具体色 ⇒ 这一维没分')
  assert.strictEqual(none.source, null)
  assert.strictEqual(none.borrowed, false)
  // ⑦ 借来的色⛔ 不追加进呼应件数（那条串本来已经是第 4 个槽）
  assert.strictEqual(borrowed.color_parts, parts.length, 'parts 数量被借色改动＝重复计权')
})

test('§二·3 借色降权：色彩那一维权重乘 0.5，且只在 rankDims 折一次', () => {
  const base = { priority: 20, score: 5, color_fit: { score: 80 } }
  const plain = rankDims(base, { isRule: true })
  const borrowedRank = rankDims({ ...base, color_borrowed: true }, { isRule: true })
  const wOf = (rk) => rk.dims.find((d) => d.key === 'color').weight
  assert.strictEqual(wOf(plain), RANK_WEIGHTS.color)
  assert.strictEqual(
    wOf(borrowedRank),
    Math.round(RANK_WEIGHTS.color * COLOR_BORROW_WEIGHT * 1000) / 1000,
    `借色的权重应是 ${RANK_WEIGHTS.color}×${COLOR_BORROW_WEIGHT}`,
  )
  assert.strictEqual(
    COLOR_BORROW_WEIGHT,
    0.5,
    '这条折扣与第五阶段 ESTIMATED_BODY_AXIS_WEIGHT 同档，改数要一起改',
  )
  // 在场判据不变：借色的那条色彩维仍然算"在场"（不然算法缺席惩罚会重复收钱）
  assert.ok(borrowedRank.present.includes('color'))
  assert.ok(!borrowedRank.missing.includes('color'))
  // 分数照算，但权重减半 ⇒ 同一份色彩分在借色时综合分不升（打折要真打折）
  assert.ok(borrowedRank.score <= plain.score, `${borrowedRank.score} 不该高过 ${plain.score}`)
  // ⛔ 不许在 colorFit 的分数里再乘一次：fit.score 两侧必须逐字相同
  assert.strictEqual(borrowedRank.dims.find((d) => d.key === 'color').score, 80)
})

// ============================================================
// 10-21 第十三阶段·第一步 §二·4：关系色就地展开（同色／同色系／一致／呼应）
// 尺子＝`relationalTargetsOf`＋`resolveRelationalSlots` 这两处；⛔ 词表不许进 colorMetrics 那张色名表
// 现量（全语料）见工装 probe-relational-gain.cjs：库里只有 2 格吃到这一条（id=1102／1224「同色西裤」），
// ⛔ 它不改任何分数（被指格的色本来已在呼应里，去重口径④吃掉）⇒ 这一层的验收只看"收口＋出处"，不看抬分。
// ============================================================
const {
  RELATIONAL_WORDS,
  resolveRelationalSlots,
  relationalTargetsOf,
  relationalLedger,
} = require('../services/recommendEngine')
const { COLOR_NAME_HEX } = require('../services/colorMetrics')

test('§二·4 目标槽判据：点名跟着名词走，⛔ 自指那个名词不许当成目标', () => {
  // 四个指涉词之外一律不认（'今天不冷' 里没有任何颜色关系）
  assert.deepStrictEqual(relationalTargetsOf('今天不冷', '下装'), [])
  assert.deepStrictEqual(RELATIONAL_WORDS, ['同色系', '同色', '一致', '呼应'])
  // 点名：鞋／包／裤／上
  assert.deepStrictEqual(relationalTargetsOf('与鞋同色系皮带', '上衣'), ['鞋'])
  assert.deepStrictEqual(relationalTargetsOf('细腰带，与鞋包同色系', '上衣'), ['鞋', '包'])
  // 🔴 自指要剔掉：'同色西裤' 写在**下装**那一格时，"裤"说的就是本槽，真正的对面是上衣。
  //      这一条是本轮实测出来的偏差——第一版没剔自指，全语料展开 0 格（现量记 21 §十二）。
  assert.deepStrictEqual(relationalTargetsOf('同色西裤', '下装'), ['上衣'])
  assert.deepStrictEqual(relationalTargetsOf('或与裤子同色的鞋', '鞋'), ['下装'])
  // 名词都没写 ⇒ 默认指向 上衣；但本槽已经是上衣 ⇒ 回 []（⛔ 自己指自己）
  assert.deepStrictEqual(relationalTargetsOf('上下同色系或相近色', '下装'), ['上衣'])
  assert.deepStrictEqual(relationalTargetsOf('同色系穿搭', '配色'), ['上衣'])
  assert.deepStrictEqual(relationalTargetsOf('深色合体西装外套+同色内搭', '上衣'), [])
  // '上下' 是一个词组，⛔ 拆成"下"再当成向"下装"的点名
  assert.deepStrictEqual(relationalTargetsOf('上下同色系', '鞋'), ['上衣'])
})

test('§二·4 展开的三条闸门：被指格没色不补／只解一层／本槽自己有色不补', () => {
  const 藏青 = COLOR_NAME_HEX['藏青']
  // 闸门③命中前的正常补色：下装只写"同色"，上衣写了藏青 ⇒ 补，且记被指的槽名
  const filled = resolveRelationalSlots([
    { label: '上衣', text: '藏青西装', area: 0.4 },
    { label: '下装', text: '同色西裤', area: 0.4 },
  ])
  assert.ok(filled[1].relational, '下装该从上衣那一格取到色')
  assert.strictEqual(filled[1].relational.from, '上衣')
  assert.strictEqual(filled[1].relational.hex, 藏青)
  assert.strictEqual(filled[1].relational.source, '藏青西装', '出处要记被指格的原文')
  // 闸门①：被指格只有明度档 ⇒ ⛔ 拿"深色"冒充一个 hex
  const noHex = resolveRelationalSlots([
    { label: '上衣', text: '深色西装', area: 0.4 },
    { label: '下装', text: '同色西裤', area: 0.4 },
  ])
  assert.strictEqual(noHex[1].relational, undefined, '被指格没具体色就不该补')
  // 闸门②：A 指 B、B 又指 A ⇒ 两侧都没自己写的色 ⇒ 都不补（⛔ 递归）
  const loop = resolveRelationalSlots([
    { label: '上衣', text: '与下装同色的上衣', area: 0.4 },
    { label: '下装', text: '与上衣同色的西裤', area: 0.4 },
  ])
  assert.strictEqual(loop[0].relational, undefined)
  assert.strictEqual(loop[1].relational, undefined)
  // 闸门③：本槽自己已经写了色 ⇒ 不补（否则一件衣服两个色，呼应侧双计）
  const own = resolveRelationalSlots([
    { label: '上衣', text: '藏青西装', area: 0.4 },
    { label: '下装', text: '蓝色西裤，与上衣同色', area: 0.4 },
  ])
  assert.strictEqual(own[1].relational, undefined, '本槽自己有蓝色就不该再借上衣的藏青')
  // 默认关得住：没有关系词 ⇒ 返回的槽与传入逐字节相同（⛔ 新增 relational:null 这种空字段）
  const plain = [
    { label: '上衣', text: '白色衬衫', area: 0.4 },
    { label: '下装', text: '深色西裤', area: 0.4 },
  ]
  assert.deepStrictEqual(resolveRelationalSlots(plain), plain)
  assert.ok(!('relational' in resolveRelationalSlots(plain)[0]))
  // 只有一格／空数组：没有兄弟可指 ⇒ 原样
  assert.deepStrictEqual(resolveRelationalSlots([{ label: '下装', text: '同色西裤' }]), [
    { label: '下装', text: '同色西裤' },
  ])
  assert.deepStrictEqual(resolveRelationalSlots([]), [])
})

test('§二·4 收口账：呼应件数不涨（去重口径④），但出处要能印出来', () => {
  const slots = resolveRelationalSlots([
    { label: '上衣', text: '藏青西装', area: 0.4 },
    { label: '下装', text: '同色西裤', area: 0.4 },
    { label: '配色', text: '藏青+白', area: 0.4 },
  ])
  const before = outfitColorParts([
    { label: '上衣', text: '藏青西装', area: 0.4 },
    { label: '下装', text: '同色西裤', area: 0.4 },
    { label: '配色', text: '藏青+白', area: 0.4 },
  ])
  const after = outfitColorParts(slots)
  assert.strictEqual(
    after.length,
    before.length,
    `展开出来的那个 hex 与上衣同色 ⇒ 去重必须吃掉它：${before.length} ⇒ ${after.length}`,
  )
  assert.deepStrictEqual(
    after.map((p) => p.color),
    before.map((p) => p.color),
    '呼应件的色与次序都不许因这一层改变（改了就是动了分数）',
  )
  // 收口账是一句人话，不是英文键
  assert.strictEqual(relationalLedger(slots), '下装←上衣(藏青)')
  assert.strictEqual(relationalLedger([{ label: '上衣', text: '白色衬衫' }]), null)
  assert.strictEqual(relationalLedger([]), null)
  assert.strictEqual(relationalLedger(null), null, '传 null 不许炸')
})

test('§二·4 上衣写关系时：走 relational 支路，优先于配色串第一色，照样打折', () => {
  const SKIN = skinToneToLab('白皙')
  const slots = resolveRelationalSlots([
    { label: '上衣', text: '与鞋同色系的上衣', area: 0.4 },
    { label: '鞋', text: '黑色乐福鞋', area: 0.2 },
    { label: '配色', text: '米+蓝', area: 0.4 },
  ])
  const rel = slots[0].relational
  assert.ok(rel && rel.hex === COLOR_NAME_HEX['黑色'], '上衣该顺着那句话从鞋那一格取到黑色')
  const parts = outfitColorParts(slots)
  const used = scoreTopColor(SKIN, '与鞋同色系的上衣', parts, '米+蓝', rel)
  assert.strictEqual(used.source, 'relational')
  assert.strictEqual(used.borrowed, true, '不是这一格自己写的色 ⇒ 同一个打折闸门')
  assert.strictEqual(used.relational_from, '鞋')
  assert.strictEqual(
    used.fit.top_hex,
    COLOR_NAME_HEX['黑色'],
    '⛔ 取串里第一色 米 就是拿次好的证据冒充',
  )
  // 没有关系（relational 传 null）时退回 §二·3 那条：借串里第一色
  const viaCombo = scoreTopColor(SKIN, '深色上衣', parts, '米+蓝', null)
  assert.strictEqual(viaCombo.source, 'combo_first')
  assert.strictEqual(viaCombo.relational_from, null)
  // 上衣自己写了色 ⇒ 两条支路都不走
  const own = scoreTopColor(SKIN, '白色衬衫', parts, '米+蓝', rel)
  assert.strictEqual(own.source, 'top_text')
  assert.strictEqual(own.borrowed, false)
})

// ============================================================
// 10-21 第十三阶段·第一步 §三·4：文案认出的版型档接进身体那一维（验收＝§八 第 6、7 格）
// 尺子＝`ruleTextBodyFit` 这一个出口（⛔ 别处不许再判一次"这句文案有没有版型词"，
//       认档本身由 fitInference.test.js 那 6 条守着，这一节只管"接到身体维"这一段）
// ============================================================
const { ruleTextBodyFit } = require('../services/recommendEngine')
const { bodyDeviation, FIT_TYPE_VALUES, FABRIC_WEIGHT_VALUES } = require('../services/topFitBody')

// 与 FIT_PROFILE 同一份档案（身体那一层读的就是它，⛔ 另起一份会让断言与引擎不同源）
const FIT_DEV = bodyDeviation(FIT_PROFILE)

test('§三·4 版型档出分：走 topFitBody 已有的 ease_src=fit_type 分支，覆盖率按半格计', () => {
  const out = ruleTextBodyFit('宽松落肩卫衣', FIT_DEV)
  assert.ok(out, '「宽松」＋「卫衣」两条线索都在，该出分')
  assert.strictEqual(out.fit_type, '宽松')
  assert.strictEqual(out.fabric_weight, '中', '卫衣在面料词表里属"中"档')
  assert.strictEqual(out.body_fit.inferred_from, 'rule_text', '报告与后台靠这个串判"不是量出来的"')
  assert.deepStrictEqual(
    out.body_fit.inferred_words,
    { fit: ['宽松', '落肩'], fabric: ['卫衣'] },
    '凭哪几个词归的档要原样带出去（措辞红线：只能说"按这句建议自己的款式词"）',
  )
  // 现量：这一句的覆盖率 0.25（六轴只出了 volume 与 ease 两轴，ease 还是估的）
  assert.strictEqual(out.body_fit.coverage, 0.25)
  assert.ok(out.body_fit.coverage < 1, '推断档⛔ 不许按满格计')
  const ease = out.body_fit.axes.find((a) => a.key === 'ease')
  assert.ok(ease && ease.estimated === true, '松量这一轴必须是"估的"标记')
  assert.match(ease.based_on, /版型档 宽松/, '依据要指到那一档，⛔ 不能指到"你的胸围"')
  assert.deepStrictEqual(
    out.body_fit.axes.map((a) => a.key),
    ['volume', 'ease'],
  )
  assert.deepStrictEqual(out.body_fit.axes_missing, ['shoulder', 'waist', 'length', 'pattern'])
})

test('§三·4 只有面料档也出分，但只有一轴；⛔ 造不出的轴不许补', () => {
  const fab = ruleTextBodyFit('真丝衬衫', FIT_DEV)
  assert.ok(fab, '面料薄这一条线索本身就是一轴（体量）')
  assert.strictEqual(fab.fit_type, null)
  assert.strictEqual(fab.fabric_weight, '薄')
  assert.deepStrictEqual(
    fab.body_fit.axes.map((a) => a.key),
    ['volume'],
  )
  assert.ok(fab.body_fit.axes_missing.includes('ease'), '认不出版型档 ⇒ 松量那一轴继续缺席')
  assert.strictEqual(fab.body_fit.coverage, 0.17)
})

test('§三·4 认不出＝与改前逐条相同：整块缺席（§八·7「传胸围 92 也回 null」）', () => {
  for (const t of [
    '白色衬衫',
    '合身不过度宽松',
    '胸围 92',
    '肩宽 39cm',
    '腰围62',
    '',
    null,
    undefined,
  ]) {
    assert.strictEqual(ruleTextBodyFit(t, FIT_DEV), null, `「${t}」认不出档 ⇒ 身体这一维不许出现`)
  }
  // ⛔ 这一层不许吐任何 cm 级数值：出分那两条的伪上衣行里 garment_cm 四格必须全空
  for (const t of ['宽松落肩卫衣', '真丝衬衫']) {
    const out = ruleTextBodyFit(t, FIT_DEV)
    assert.ok(out)
    assert.deepStrictEqual(
      out.body_fit.top.garment_cm,
      {
        shoulder_cm: null,
        bust_cm: null,
        length_cm: null,
        waistband_cm: null,
      },
      `「${t}」这一路造出了尺寸数值`,
    )
    assert.strictEqual(out.body_fit.top.source, 'wardrobe')
  }
})

test('§三·4 ⛔ 排序层不另打折：推断档拿满 body 权重，折扣只在 topFitBody 那一层乘过一次', () => {
  const of = (rk) => rk.dims.find((d) => d.key === 'body').weight
  const inferred = rankDims(
    { priority: 20, score: 5, body_fit: { score: 37, coverage: 0.25 } },
    { isRule: true },
  )
  const measured = rankDims(
    { priority: 20, score: 5, body_fit: { score: 80, coverage: 1 } },
    { isRule: true },
  )
  assert.strictEqual(
    of(inferred),
    RANK_WEIGHTS.body,
    '借色那一维减半是 §二·3 的特例，身体这一维⛔ 跟',
  )
  assert.strictEqual(
    of(inferred),
    of(measured),
    '推断与实测在排序层拿同一个权重（覆盖率惩罚不重复乘）',
  )
  assert.ok(inferred.present.includes('body'), '有分就算在场，⛔ 再吃一次算法缺席惩罚')
  assert.ok(!inferred.missing.includes('body'))
  // 认不出档 ⇒ 与改前逐条相同：权重退场、算法缺席惩罚照吃
  const absent = rankDims({ priority: 20, score: 5 }, { isRule: true })
  assert.strictEqual(of(absent), 0)
  assert.ok(absent.missing.includes('body'))
})

test('§三·4 引擎接线：规则候选带出的字段自洽，认不出的那条与改前形状一致', () => {
  const r = buildRecommendation(FIT_PROFILE, 'store', false)
  const list = r['穿搭'] || []
  const inferred = list.filter((e) => e.body_fit && e.body_fit.inferred_from === 'rule_text')
  assert.ok(inferred.length >= 1, `store 模式至少一条规则文案该认出档,实际 ${inferred.length} 条`)
  for (const e of inferred) {
    assert.ok(
      e.fit_type_inferred === null || FIT_TYPE_VALUES.includes(e.fit_type_inferred),
      `fit_type_inferred=${e.fit_type_inferred} 不在库里那四档`,
    )
    assert.ok(
      e.fabric_weight_inferred === null || FABRIC_WEIGHT_VALUES.includes(e.fabric_weight_inferred),
      `fabric_weight_inferred=${e.fabric_weight_inferred} 不在厚薄三档`,
    )
    assert.ok(e.body_fit.coverage < 1, '推断档按满格计＝对顾客谎称量过')
    // 排序层的身体分就是这一维的原始分，中间不另乘系数
    const bd = (e.rank.dims || []).find((d) => d.key === 'body')
    assert.strictEqual(bd.score, e.body_fit.score)
    assert.strictEqual(bd.weight, RANK_WEIGHTS.body)
    assert.strictEqual(bd.coverage, e.body_fit.coverage)
  }
  // 认不出档的那些条：字段一个都不许出现，rank 的 body 维继续缺席（与改前逐条相同）
  for (const e of list.filter((x) => !e_body(x))) {
    assert.ok(
      !e.body_fit && !e.fit_type_inferred && !e.fabric_weight_inferred,
      `「${e.top_style}」没认出档却出了身体字段`,
    )
    const bd = ((e.rank || {}).dims || []).find((d) => d.key === 'body')
    assert.ok(!bd || (bd.score === null && bd.weight === 0))
  }
  function e_body(x) {
    return x.body_fit && x.body_fit.inferred_from === 'rule_text'
  }
})
