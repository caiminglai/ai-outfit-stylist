/**
 * 权重回归脚本的行为测试（10-19 第三阶段·模块三）
 * ============================================================
 * 这个脚本现在的常态是「样本不够，不可回归」，所以测试的重点不在"回归得准不准"，
 * 而在四件必须钉死的事：
 *   1. 造一批已知真权的合成数据，它必须能把那三个权重**收回来**（否则整条管道是摆设）；
 *   2. 数据不够／快照缺格／因变量无方差 ⇒ 必须报"不可回归"并说清原因，**不许猜一个权重**；
 *   3. 缺的那一维不能被当成 0 分（`Number(null)===0` 这类坑）；
 *   4. 脚本只读：不 require db/init、自己开 readonly 句柄、源码里没有任何库写入。
 * 全程不打开任何库文件——require 脚本本身也不会开（连库动作在 main() 里，测试只调纯函数）。
 * 运行: node --test test/regressRankWeights.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'regress-rank-weights.js')
const R = require(SCRIPT_PATH)
const {
  DIM_KEYS,
  CURRENT_WEIGHTS,
  MIN_SAMPLES,
  collectSamples,
  analyze,
  analyzeAll,
  projectOntoSimplex,
} = R

/** 与项目其它脚本测试同一口径：剥掉注释再判源码，别让说明文字把自己打红 */
function codeOf(file) {
  return fs
    .readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** 可复现的伪随机（LCG）：回归结果要能被别人复算，测试数据更不能每次不一样 */
function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

/**
 * 造 n 条"真权为 trueW"的反馈行：三维分随机、星级按 Σwᵢxᵢ 折出来再抖动。
 * @param {number[]} trueW 与 DIM_KEYS 同序的真权重（和为 1）
 * @param {object} [opt] { star: 是否给星, signal: 是否给二分类, snapshotBody: 覆盖快照内容 }
 */
function genRows(trueW, n, opt = {}) {
  const rand = rng(opt.seed || 20261019)
  const rows = []
  for (let i = 0; i < n; i++) {
    const x = [rand() * 100, rand() * 100, rand() * 100]
    const mix = trueW[0] * x[0] + trueW[1] * x[1] + trueW[2] * x[2]
    const norm = mix / 100
    const star = Math.max(1, Math.min(5, Math.round(norm * 4 + 1 + (rand() - 0.5) * 0.5)))
    rows.push({
      group_id: i + 1,
      user_id: (i % 12) + 1,
      signal: norm > 0.5 ? 'useful' : 'inaccurate',
      aesthetic_score: opt.noStar ? null : star,
      fit_score: opt.noFit ? null : star,
      rank_snapshot:
        opt.rawSnapshot !== undefined
          ? opt.rawSnapshot
          : JSON.stringify({ rule: x[0], color: x[1], body: x[2], total: mix / 10, coverage: 1 }),
    })
  }
  return rows
}

test('漂移哨兵：脚本里复制的现权必须与 ranker.js 的 RANK_WEIGHTS 一字不差', () => {
  // 脚本不 require 引擎（那会顺带把 db/init 拉进来开活库），所以这里只能靠源码比对钉住；
  // 10-29 拆分后 RANK_WEIGHTS 的唯一定义处在 services/recommend/ranker.js
  const src = codeOf(path.join(__dirname, '..', 'services', 'recommend', 'ranker.js'))
  const m = src.match(/const RANK_WEIGHTS = \{([^}]*)\}/)
  assert.ok(m, 'recommend/ranker.js 里要能找到 RANK_WEIGHTS 那一行')
  const live = {}
  for (const pair of m[1].split(',')) {
    const [k, v] = pair.split(':').map((s) => (s || '').trim())
    if (k) live[k] = Number(v)
  }
  for (const k of DIM_KEYS) {
    assert.strictEqual(
      CURRENT_WEIGHTS[k],
      live[k],
      `${k} 维：脚本复制的是 ${CURRENT_WEIGHTS[k]}，线上是 ${live[k]}`,
    )
  }
})

test('合成数据：真权 0.6/0.2/0.2 能被收回来，并判成「值得改」', () => {
  const r = analyze(genRows([0.6, 0.2, 0.2], 200), { target: 'aesthetic', minSamples: MIN_SAMPLES })
  assert.ok(r.ok, r.reason)
  // 三维各自离真值不到 0.06——收不回真权的回归没有存在价值
  const truth = { rule: 0.6, color: 0.2, body: 0.2 }
  for (const k of DIM_KEYS)
    assert.ok(
      Math.abs(r.suggested[k] - truth[k]) < 0.06,
      `${k} 收回 ${r.suggested[k]}，真值 ${truth[k]}`,
    )
  assert.strictEqual(r.worth_changing, true)
  assert.ok(r.loss_fitted <= r.loss_current, '拟合完的损失不许比现权还差')
})

test('合成数据：与现权一致的真权 ⇒ 判「不值得改」，不许为了小数点折腾线上', () => {
  // 夹具直接取脚本里那份现权，不写死数字：10-20 第四阶段·第一步改权重时，
  // 写死 [0.2,0.4,0.4] 的这条立刻假失败（真权与现权不再一致 ⇒ 判成"值得改"），
  // 而它要验的是"一致时不许折腾"这件事本身，与具体是哪三个数无关。
  const truth = DIM_KEYS.map((k) => CURRENT_WEIGHTS[k])
  const r = analyze(genRows(truth, 200), { target: 'aesthetic' })
  assert.ok(r.ok, r.reason)
  assert.ok(r.max_shift < 0.05, `最大单维偏移 ${r.max_shift} 本应低于 0.05 阈值`)
  assert.strictEqual(r.worth_changing, false)
})

test('闸门一：样本不够 ⇒ 不可回归，原因里带上实际条数与闸门', () => {
  const r = analyze(genRows([0.2, 0.4, 0.4], 12), { target: 'aesthetic' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.samples, 12)
  assert.match(r.reason, /12 条/)
  assert.match(r.reason, new RegExp(String(MIN_SAMPLES) + ' 条'))
  // 关键：不够时一个建议数字都不许出
  assert.strictEqual(r.suggested, undefined)
})

test('闸门二：快照为 NULL／坏 JSON 的行逐条计数，不参与回归', () => {
  const rows = genRows([0.2, 0.4, 0.4], 40)
  rows.push({
    group_id: 901,
    user_id: 1,
    signal: 'useful',
    aesthetic_score: 4,
    fit_score: 4,
    rank_snapshot: null,
  })
  rows.push({
    group_id: 902,
    user_id: 2,
    signal: 'useful',
    aesthetic_score: 4,
    fit_score: 4,
    rank_snapshot: '{坏 JSON',
  })
  const { samples, dropped } = collectSamples(rows, 'aesthetic')
  assert.strictEqual(samples.length, 40)
  assert.strictEqual(dropped.no_snapshot, 2)
})

test('闸门三：快照里缺那一维不能被当成 0 分（Number(null)===0 那类坑）', () => {
  const snap = { rule: 60, color: 70, body: null, total: 65, coverage: 1 }
  const rows = [
    {
      group_id: 1,
      user_id: 1,
      signal: 'useful',
      aesthetic_score: 5,
      fit_score: 5,
      rank_snapshot: JSON.stringify(snap),
    },
    {
      group_id: 2,
      user_id: 2,
      signal: 'useful',
      aesthetic_score: 5,
      fit_score: 5,
      rank_snapshot: JSON.stringify({ rule: 60, color: 70 }),
    },
    {
      group_id: 3,
      user_id: 3,
      signal: 'useful',
      aesthetic_score: 5,
      fit_score: 5,
      rank_snapshot: JSON.stringify({ rule: 60, color: 70, body: 900 }),
    },
  ]
  const { samples, dropped } = collectSamples(rows, 'aesthetic')
  assert.strictEqual(
    samples.length,
    0,
    'null／缺键／越界三种都必须整条剔除，不许折成 0 分或 900 分',
  )
  assert.strictEqual(dropped.incomplete_dims, 3)
})

test('闸门四：因变量全是同一个值 ⇒ 权重不可识别，不许报"最优解"', () => {
  const rows = genRows([0.2, 0.4, 0.4], 60).map((r) => ({ ...r, aesthetic_score: 3 }))
  const r = analyze(rows, { target: 'aesthetic' })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /不可识别/)
})

test('星级口径：只有 1~5 的整数算打了星，0／6／NULL 都归"没打"并计入剔除', () => {
  const rows = genRows([0.2, 0.4, 0.4], 40)
  rows.forEach((r, i) => {
    if (i === 0) r.aesthetic_score = 0
    if (i === 1) r.aesthetic_score = 6
    if (i === 2) r.aesthetic_score = null
  })
  const { samples, dropped } = collectSamples(rows, 'aesthetic')
  assert.strictEqual(samples.length, 37)
  assert.strictEqual(dropped.no_target, 3)
})

test('两把星各走各的样本池：合身那把没打 ⇒ fit 一路报不够，aesthetic 一路照跑', () => {
  const rows = genRows([0.2, 0.4, 0.4], 45, { noFit: true })
  const reports = analyzeAll(rows, { target: 'all' })
  assert.strictEqual(reports.length, 3)
  const by = Object.fromEntries(reports.map((r) => [r.target, r]))
  assert.ok(by.aesthetic.ok, by.aesthetic.reason)
  assert.strictEqual(by.fit.samples, 0)
  assert.strictEqual(by.fit.ok, false)
})

test('权向量恒在单纯形上：非负、和为 1（与线上"占比"口径一致）', () => {
  // 已经在单纯形上的点必须原样吐出（投影幂等）
  const idem = projectOntoSimplex([0.5, 0.3, 0.2])
  assert.deepStrictEqual(idem, [0.5, 0.3, 0.2])
  // 含负数的输入被投影回非负象限后仍然和为 1
  const p = projectOntoSimplex([-0.4, 0.7, 0.9])
  assert.ok(p.every((v) => v >= 0))
  assert.ok(
    Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9,
    `投影后和为 ${p.reduce((a, b) => a + b, 0)}`,
  )
  // 三格都很负：θ 停在第一个满足条件的 j 上，吐出的是单纯形的一个顶点（和仍为 1）
  const u = projectOntoSimplex([-9, -8, -7])
  assert.deepStrictEqual(u, [0, 0, 1])
  assert.ok(Math.abs(u.reduce((a, b) => a + b, 0) - 1) < 1e-9)
  const r = analyze(genRows([0.9, 0.05, 0.05], 120), { target: 'aesthetic' })
  assert.ok(r.ok, r.reason)
  assert.ok(r.suggested_vector.every((v) => v >= 0))
  assert.ok(Math.abs(r.suggested_vector.reduce((a, b) => a + b, 0) - 1) < 0.01)
})

test('逻辑回归那一路：可分的二分类能判对、且不比现权差', () => {
  const rows = genRows([0.2, 0.4, 0.4], 200)
  const r = analyze(rows, { target: 'signal', model: 'logistic' })
  assert.ok(r.ok, r.reason)
  assert.ok(r.accuracy > 0.9, `判对率只有 ${r.accuracy}`)
  assert.ok(r.loss_fitted <= r.loss_current + 1e-6)
  assert.ok(r.ridge_lambda > 0, '二分类必须带向现权收缩的惩罚，否则可分数据会把权重推到角上')
})

test('确定性：同一份数据两次跑出的向量一模一样（结果要能进文档、能被别人复算）', () => {
  const rows = genRows([0.35, 0.45, 0.2], 80)
  const a = analyze(rows, { target: 'aesthetic' }).suggested_vector
  const b = analyze(rows, { target: 'aesthetic' }).suggested_vector
  assert.deepStrictEqual(a, b)
})

test('脚本只读：不 require db/init、自己开 readonly 句柄、源码里没有任何库写入', () => {
  const src = codeOf(SCRIPT_PATH)
  assert.ok(
    !/require\(['"]\.\.\/db\/init['"]\)/.test(src),
    'init.js 一加载就建表补列清会话，脚本不能引它',
  )
  assert.match(src, /new Database\([^)]*readonly:\s*true/, '必须自己开只读句柄')
  assert.ok(
    !/\bINSERT\b|\bUPDATE\b|\bDELETE FROM|\.exec\(|\.run\(/.test(src),
    '回归脚本不许有任何库写入',
  )
  // 路径唯一出口仍然是 db/paths（可用 STYLEAI_DB_PATH 指到副本校验）
  assert.match(src, /require\(['"]\.\.\/db\/paths['"]\)/)
  // 连库动作必须关在 main() 里：测试 require 它的时候不能碰任何库文件
  assert.ok(
    src.indexOf("require('../db/paths')") > src.indexOf('function main()'),
    '开库要发生在 main() 之内',
  )
})

// ============================================================
// 10-21 第九阶段·第一步：`--source=item` 那一档（人×衣服，色彩＋廓形两维）
// 规范＝docs/依据/17 §六。这一档存在的理由只有一条：三维那档**结构上**凑不出样本
// （规则那一路不写 body_fit），而衣橱那一路量得出廓形也打得出星。
// ============================================================

/** 造 n 条真权为 [色彩, 廓形] 的 `item_feedback` 行：快照只有两维，与写入口同形状 */
function genItemRows(trueW, n, opt = {}) {
  const rand = rng(opt.seed || 20261021)
  const rows = []
  for (let i = 0; i < n; i++) {
    const color = rand() * 100
    const body = rand() * 100
    const norm = (trueW[0] * color + trueW[1] * body) / 100
    const star = Math.max(1, Math.min(5, Math.round(norm * 4 + 1 + (rand() - 0.5) * 0.5)))
    rows.push({
      wardrobe_item_id: i + 1,
      user_id: (i % 12) + 1,
      signal: null,
      aesthetic_score: star,
      fit_score: star,
      rank_snapshot: JSON.stringify({
        color,
        body,
        total: (color + body) / 2 / 10,
        coverage: 1,
      }),
    })
  }
  return rows
}

test('两维档：真权 0.7/0.3 能从 item_feedback 那批行里收回来，且只出 color/body 两个数', () => {
  const r = analyze(genItemRows([0.7, 0.3], 120), { source: 'item', target: 'aesthetic' })
  assert.ok(r.ok, r.reason)
  assert.deepStrictEqual(r.dims, ['color', 'body'], '这一档的向量里没有 rule 那一维')
  assert.deepStrictEqual(Object.keys(r.suggested).sort(), ['body', 'color'])
  assert.ok(
    Math.abs(r.suggested.color - 0.7) < 0.08 && Math.abs(r.suggested.body - 0.3) < 0.08,
    `收回 ${JSON.stringify(r.suggested)}，真值 [0.7,0.3]`,
  )
  assert.ok(Math.abs(r.suggested_vector.reduce((a, b) => a + b, 0) - 1) < 0.01, '两维权重和仍为 1')
})

test('两维档的闸门是 15 条而不是 30 条：12 条报不可回归、16 条才放行', () => {
  const short = analyze(genItemRows([0.5, 0.5], 12), { source: 'item', target: 'aesthetic' })
  assert.strictEqual(short.ok, false)
  assert.strictEqual(short.min_samples, R.MIN_SAMPLES_ITEM)
  assert.match(short.reason, /12 条/)
  assert.match(short.reason, /15 条/, `闸门数字要说清：${short.reason}`)
  assert.strictEqual(short.suggested, undefined, '不够时一个建议数字都不许出')

  const enough = analyze(genItemRows([0.6, 0.4], 16), { source: 'item', target: 'aesthetic' })
  assert.strictEqual(enough.ok, true, enough.reason)
})

test('两维档不吃三维快照：串进来的三维行计入 wrong_source，一维都不进样本', () => {
  const rows = genItemRows([0.5, 0.5], 20)
  // 有人把规则那一路的三维快照写进了这张表（那是接错线）——两种尺子的数搅在一口锅里没法复算
  rows.push({ ...genRows([0.5, 0.3, 0.2], 1)[0], wardrobe_item_id: 999 })
  const r = analyze(rows, { source: 'item', target: 'aesthetic' })
  assert.strictEqual(r.dropped.wrong_source, 1)
  assert.strictEqual(r.samples, 20, '串口径的那条一条都不许算进样本')
})

test('三维档缺 color 或 body 仍按 incomplete_dims 剔掉，wrong_source 恒为 0（默认口径行为一字不变）', () => {
  const rows = genRows([0.2, 0.4, 0.4], 40)
  rows.push({
    group_id: 950,
    user_id: 1,
    signal: 'useful',
    aesthetic_score: 3,
    fit_score: 3,
    rank_snapshot: JSON.stringify({ rule: 80, color: null, body: 60 }),
  })
  const r = analyze(rows, { target: 'aesthetic' })
  assert.strictEqual(r.dropped.incomplete_dims, 1)
  assert.strictEqual(r.dropped.wrong_source, 0, '三维档里 rule 缺席才是问题，presence 不是')
})

test('口径护栏：不传 source 与传 rules 逐字节相同，且现权换到二维档的等效值是 0.5/0.5', () => {
  const rows = genRows([0.2, 0.4, 0.4], 60)
  const a = analyze(rows, { target: 'aesthetic' })
  const b = analyze(rows, { target: 'aesthetic', source: 'rules' })
  assert.deepStrictEqual(a, b, '默认档必须就是改前那一条路')
  assert.strictEqual(a.source, 'feedback_events')
  assert.strictEqual(a.min_samples, MIN_SAMPLES)
  assert.deepStrictEqual(a.dims, DIM_KEYS)

  const item = analyze(genItemRows([0.5, 0.5], 20), { source: 'item', target: 'aesthetic' })
  assert.strictEqual(item.source, 'item_feedback')
  // 0.45/0.45 投到二维单纯形 ⇒ 各 0.5。不写这个等效值，"与现权偏移"会拿 0.45 比 0.5 造出假的 0.05
  assert.deepStrictEqual(item.current_weights, [0.45, 0.45])
  assert.deepStrictEqual(item.current_weights_renorm, [0.5, 0.5])
})

test('脚本源码：两档口径各自的表与只读 SQL 都在，且没有写库语句', () => {
  const src = codeOf(SCRIPT_PATH)
  assert.match(src, /FROM feedback_events/, 'rules 档读 feedback_events')
  assert.match(src, /FROM item_feedback/, 'item 档读 item_feedback')
  assert.ok(
    !/UPDATE\s+item_feedback|INSERT INTO item_feedback/.test(src),
    '回归脚本对两张表都只许读',
  )
  assert.match(src, /--source 只能/, `CLI 要把两档口径说清楚：${SCRIPT_PATH}`)
})
