/**
 * 智能估算层（`services/bodyDimEstimator.js`）的单测
 * ============================================================
 * 建档：2026-10-20（第五阶段·第一步）。口径与逐格锚点出处在
 * `docs/依据/13-体型估算输入输出规范-20261020.md`，本文五条主线：
 *  ① 缺测/不合格 ⇒ 返回 null（硬规矩 2，不许有默认值）
 *  ② 八张国标锚点表逐格复算（胸围幂律 56 格残差 ≤1.93%，且 0.69 确实是 0.001 步长上的 minimax 最优）
 *  ③ 两层钳位与 flags（本表分位框＋肩宽÷身高配对包络；含表 2／表 7 的 spread 兜底）
 *  ④ 输出契约的形状（⛔ 不许冒出"置信度／准确率／星级"这类没有数据支撑的字段）
 *  ⑤ 估算肩宽÷身高留在国标同一档配对的范围里（越出＝锚点或指数被人改坏）
 *  ⑥ 接线（`profileEnricher` 挂 `body_est` → `topFitBody.person_cm`）：`13` §五 那七条禁令逐条有断言，
 *     核心是"喂 est 与不喂 est，`measure` 与 `want` 逐格相同"——估算值只许补 person_cm 那两格。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  estimateBodyDims,
  estimateFromWaist,
  selectBand,
  ANCHORS,
  BUST_EXPONENT,
  SHOULDER_SLOPE,
  SHOULDER_ENVELOPE,
  SHOULDER_HEIGHT_RATIO,
  P1,
  P50,
  P99,
} = require('../services/bodyDimEstimator')

// 接线段（⑥）要用到的两个下游：档案增强层与合身层
const { enrichProfile } = require('../services/profileEnricher')
const {
  bodyDeviation,
  describeTop,
  rankTopsByBody,
  topFitBody,
  ESTIMATED_AXIS_WEIGHT,
  ESTIMATED_BODY_AXIS_WEIGHT,
} = require('../services/topFitBody')

const BANDS = ['18~70', '18~25', '26~35', '36~60']
const IDX = [1, 5, 10, 50, 90, 95, 99]

// 只抄全了肩宽 spread 的六张表（表 2／表 7 只有 P50，逐档比无从算起）
const FULL_SHOULDER = [
  ['男', '18~70'],
  ['男', '26~35'],
  ['男', '36~60'],
  ['女', '18~70'],
  ['女', '26~35'],
  ['女', '36~60'],
]

// —— ① 输入不合格 ⇒ null ——

test('缺测与非法输入一律拒算：返回 null，不返回 0／默认值', () => {
  const bad = [
    {}, // 什么都没有
    { height: 170, weight: 65 }, // 缺性别
    { gender: 'male', height: 170, weight: 65 }, // ⛔ 必须是逐字 '男'／'女'（归一在 profileEnricher 里做）
    { gender: 'M', height: 170, weight: 65 },
    { gender: '男' }, // 缺身高体重
    { gender: '男', height: 139.9, weight: 65 }, // 身高低于框
    { gender: '男', height: 200.1, weight: 65 }, // 身高高于框
    { gender: '男', height: 170, weight: 29.9 }, // 体重低于框
    { gender: '男', height: 170, weight: 150.1 }, // 体重高于框
    { gender: '男', height: 0, weight: 65 },
    { gender: '男', height: '一米七', weight: 65 },
    { gender: '男', height: 170, weight: null },
    { gender: '男', height: 170, weight: 65, age: '三十' }, // 填了年龄但读不出数 ⇒ 不静默降级
    null,
    undefined,
  ]
  for (const input of bad) {
    assert.strictEqual(estimateBodyDims(input), null, JSON.stringify(input))
  }
  // 合格框的四个角本身是合法的（闭区间）
  for (const [height, weight] of [
    [140, 30],
    [200, 150],
    [140, 150],
    [200, 30],
  ]) {
    assert.ok(estimateBodyDims({ gender: '男', height, weight }), `${height}/${weight}`)
  }
})

test('年龄三档处理：没填用全人群表、<18 与 ≥61 外推并打 flag、≤0 或 >120 视同没填', () => {
  const noAge = estimateBodyDims({ gender: '男', height: 175, weight: 70 })
  assert.strictEqual(noAge.band, '18~70')
  assert.deepStrictEqual(noAge.flags, [])

  assert.strictEqual(selectBand('男', 17).band, '18~25')
  assert.deepStrictEqual(selectBand('女', 17).flags, ['age_below_range'])
  assert.strictEqual(selectBand('女', 18).band, '18~25')
  assert.strictEqual(selectBand('女', 25).band, '18~25')
  assert.strictEqual(selectBand('女', 26).band, '26~35')
  assert.strictEqual(selectBand('女', 35).band, '26~35')
  assert.strictEqual(selectBand('女', 36).band, '36~60')
  assert.strictEqual(selectBand('女', 60).band, '36~60')
  assert.strictEqual(selectBand('女', 61).band, '36~60')
  assert.deepStrictEqual(selectBand('女', 70).flags, ['age_above_range'])
  assert.deepStrictEqual(selectBand('男', null), { band: '18~70', flags: [] })
  assert.deepStrictEqual(selectBand('火星人', 30), { band: null, flags: [] })

  // 空表单体（0／负数／超龄）不该把整层打死：视同没填 ⇒ 走全人群表 + age_ignored
  for (const age of [0, -1, 130]) {
    const r = estimateBodyDims({ gender: '男', height: 175, weight: 70, age })
    assert.ok(r, `age=${age}`)
    assert.strictEqual(r.band, '18~70')
    assert.deepStrictEqual(r.flags, ['age_ignored'])
  }
  for (const age of [undefined, null, '']) {
    const r = estimateBodyDims({ gender: '男', height: 175, weight: 70, age })
    assert.deepStrictEqual(r.flags, [], `age=${JSON.stringify(age)}`)
  }
})

// —— ② 锚点表逐格复算 ——

test('八张国标表 × 七档＝56 格，胸围幂律残差全部 ≤1.93%（最大 1.92%，女 26~35 的 P1）', () => {
  let worst = 0
  let worstWhere = ''
  for (const gender of ['男', '女']) {
    for (const band of BANDS) {
      const t = ANCHORS[gender][band]
      const h50cm = t.height_mm[P50] / 10
      let tableMax = 0
      for (let i = 0; i < 7; i++) {
        const ratio = t.weight_kg[i] / (t.height_mm[i] / 10) / (t.weight_kg[P50] / h50cm)
        const pred = t.bust_mm[P50] * Math.pow(ratio, BUST_EXPONENT)
        const res = (pred - t.bust_mm[i]) / t.bust_mm[i]
        tableMax = Math.max(tableMax, Math.abs(res))
        if (Math.abs(res) > worst) {
          worst = Math.abs(res)
          worstWhere = `${gender} ${band} ${t.table} P${IDX[i]}`
        }
      }
      assert.ok(tableMax <= 0.0195, `${gender} ${band} 最大残差 ${(tableMax * 100).toFixed(2)}%`)
    }
  }
  assert.ok(worst <= 0.0193, `最大残差 ${(worst * 100).toFixed(2)}% @ ${worstWhere}`)
})

test('0.69 是这 56 格里"最大绝对残差最小"的那个指数（0.001 步长扫出来的 minimax，不是拍的）', () => {
  const cells = []
  for (const gender of ['男', '女']) {
    for (const band of BANDS) {
      const t = ANCHORS[gender][band]
      const h50cm = t.height_mm[P50] / 10
      for (let i = 0; i < 7; i++) {
        cells.push({
          ratio: t.weight_kg[i] / (t.height_mm[i] / 10) / (t.weight_kg[P50] / h50cm),
          actual: t.bust_mm[i],
          p50: t.bust_mm[P50],
        })
      }
    }
  }
  assert.strictEqual(cells.length, 56)
  const maxAbsAt = (b) =>
    Math.max(...cells.map((c) => Math.abs((c.p50 * Math.pow(c.ratio, b) - c.actual) / c.actual)))
  // 0.001 步长扫 0.400~1.000（10-20 之前那版工装只扫了 6 个点，因此把 0.68 误当最优——这条断言就是防它复发）
  let best = null
  let bestVal = Infinity
  for (let i = 400; i <= 1000; i++) {
    const b = i / 1000
    const v = maxAbsAt(b)
    if (v < bestVal - 1e-12) {
      bestVal = v
      best = b
    }
  }
  assert.strictEqual(
    best,
    BUST_EXPONENT,
    `0.001 步长扫出来的最优是 ${best}，代码里是 ${BUST_EXPONENT}`,
  )
  assert.ok(
    Math.abs(bestVal - 0.019207) < 1e-5,
    `最优格的最大绝对残差 ${(bestVal * 100).toFixed(4)}%`,
  )
  // 四个邻点必须都比它差（0.68 → 2.11%／0.70 → 2.27%／0.685 → 2.02%／0.695 → 2.09%）
  assert.ok(maxAbsAt(0.68) > bestVal)
  assert.ok(maxAbsAt(0.7) > bestVal)
  assert.ok(maxAbsAt(0.685) > bestVal)
  assert.ok(maxAbsAt(0.695) > bestVal)
  // 文档里那串对照数（换指数就复现）
  assert.ok(maxAbsAt(0.5) > 0.06)
  assert.ok(maxAbsAt(0.75) > 0.04)
})

test('肩宽两条路的残差：端到端 ≤7.0%（6.95%，女 26~35 P1 估高 21.34mm）、只看斜率的耦合检验 ≤5.8%（10-20 现量）', () => {
  let e2eMax = 0
  let coupMax = 0
  let e2eWhere = ''
  for (const [gender, band] of FULL_SHOULDER) {
    const t = ANCHORS[gender][band]
    const slope = SHOULDER_SLOPE[gender]
    const h50cm = t.height_mm[P50] / 10
    const w50 = t.weight_kg[P50]
    const b50 = t.bust_mm[P50]
    const s50 = t.shoulder_mm[P50]
    for (let i = 0; i < 7; i++) {
      const ratio = t.weight_kg[i] / (t.height_mm[i] / 10) / (w50 / h50cm)
      const estBust = b50 * Math.pow(ratio, BUST_EXPONENT)
      // 端到端：估出的胸围代进斜率式（这才是代码实际走的那条路）
      const p1 = s50 + slope * (estBust - b50)
      const r1 = (p1 - t.shoulder_mm[i]) / t.shoulder_mm[i]
      if (Math.abs(r1) > e2eMax) {
        e2eMax = Math.abs(r1)
        e2eWhere = `${gender} ${band} P${IDX[i]} 估高 ${(p1 - t.shoulder_mm[i]).toFixed(2)} mm`
      }
      // 耦合检验：胸围用国标实测值，单看"胸围每动 1cm 肩宽动多少"这条斜率成不成立
      const p2 = s50 + slope * (t.bust_mm[i] - b50)
      coupMax = Math.max(coupMax, Math.abs((p2 - t.shoulder_mm[i]) / t.shoulder_mm[i]))
      // 弃掉的那条路：同一条幂律直接推肩宽。⚠️ 它并不更差——44 个有肩宽读数的格子上
      // 扫 0.001 步长，最优 k＝0.455 时最大绝对残差 6.06%（与斜率式端到端 6.95% 同量级）。
      // 弃它的理由不是残差，是**那个 k 纯属自拟**，而斜率式的 0.30／0.25 有 GB/T 1335 表 B.1 的
      // 档间增量出处（【官方原文·文本层逐字】）。k＝0.3 这个点单独测出来是 9.23%。
      const p3 = s50 * Math.pow(ratio, 0.3)
      assert.ok(Math.abs((p3 - t.shoulder_mm[i]) / t.shoulder_mm[i]) < 0.15, `${gender} ${band}`)
    }
  }
  assert.ok(e2eMax <= 0.07, `端到端最大残差 ${(e2eMax * 100).toFixed(2)}% @ ${e2eWhere}`)
  assert.ok(coupMax <= 0.058, `耦合残差 ${(coupMax * 100).toFixed(2)}%`)

  // 上一条注释里那个 6.06% 的判据就在此处现算：44 个有肩宽读数的格子（含表 2／表 7 的 P50），
  // 对 `shoulder = 肩宽P50 × ratio^k` 扫 0.001 步长取 minimax ⇒ k＝0.455、最大绝对残差 6.06%
  const shCells = []
  for (const gender of ['男', '女']) {
    for (const band of BANDS) {
      const t = ANCHORS[gender][band]
      const h50cm = t.height_mm[P50] / 10
      for (let i = 0; i < 7; i++) {
        if (t.shoulder_mm[i] === null) continue
        shCells.push({
          ratio: t.weight_kg[i] / (t.height_mm[i] / 10) / (t.weight_kg[P50] / h50cm),
          actual: t.shoulder_mm[i],
          p50: t.shoulder_mm[P50],
        })
      }
    }
  }
  assert.strictEqual(shCells.length, 44)
  const maxAbsShAt = (k) =>
    Math.max(...shCells.map((c) => Math.abs((c.p50 * Math.pow(c.ratio, k) - c.actual) / c.actual)))
  let bestK = null
  let bestKVal = Infinity
  for (let i = 100; i <= 1000; i++) {
    const k = i / 1000
    const v = maxAbsShAt(k)
    if (v < bestKVal - 1e-12) {
      bestKVal = v
      bestK = k
    }
  }
  assert.strictEqual(bestK, 0.455, `幂律推肩宽的最优指数是 ${bestK}`)
  assert.ok(Math.abs(bestKVal - 0.06061) < 5e-5, `该路最大绝对残差 ${(bestKVal * 100).toFixed(2)}%`)
  assert.ok(
    Math.abs(maxAbsShAt(0.3) - 0.0923) < 5e-4,
    `k=0.3 时 ${(maxAbsShAt(0.3) * 100).toFixed(2)}%`,
  )
})

// —— ③ 两层钳位与 flags ——

test('肩宽÷身高的配对包络由锚点现算：44 个同档配对点＝21.06%~23.54%，与手拍无关', () => {
  let lo = Infinity
  let hi = -Infinity
  let n = 0
  for (const gender of ['男', '女']) {
    for (const band of BANDS) {
      const t = ANCHORS[gender][band]
      for (let i = 0; i < 7; i++) {
        if (t.shoulder_mm[i] === null) continue
        const r = t.shoulder_mm[i] / t.height_mm[i]
        lo = Math.min(lo, r)
        hi = Math.max(hi, r)
        n++
      }
    }
  }
  assert.strictEqual(n, 44) // 6 张全表×7 档＋表 2/表 7 各一个 P50
  assert.ok(Math.abs(lo - SHOULDER_HEIGHT_RATIO[0]) < 1e-12)
  assert.ok(Math.abs(hi - SHOULDER_HEIGHT_RATIO[1]) < 1e-12)
  assert.strictEqual(Math.round(lo * 10000) / 100, 21.06)
  assert.strictEqual(Math.round(hi * 10000) / 100, 23.54)
  // 胸围那根轴不许用同样的框：同档配对跨 47%~65%（胸围吃脂肪，肩宽是骨骼量）
  let blo = Infinity
  let bhi = -Infinity
  for (const gender of ['男', '女'])
    for (const band of BANDS) {
      const t = ANCHORS[gender][band]
      for (let i = 0; i < 7; i++) {
        blo = Math.min(blo, t.bust_mm[i] / t.height_mm[i])
        bhi = Math.max(bhi, t.bust_mm[i] / t.height_mm[i])
      }
    }
  assert.ok(bhi - blo > 0.15, `${blo.toFixed(3)}~${bhi.toFixed(3)}`)
})

test('本表分位框：估出的数不许越过所选表的 P1／P99', () => {
  const t = ANCHORS['男']['26~35']
  const big = estimateBodyDims({ gender: '男', height: 175, weight: 150, age: 30 })
  const small = estimateBodyDims({ gender: '男', height: 175, weight: 30, age: 30 })
  assert.ok(big.flags.includes('bust_clamped'), JSON.stringify(big.flags))
  assert.ok(small.flags.includes('bust_clamped'), JSON.stringify(small.flags))
  // 夹过之后的胸围才进肩宽那一步（顺序是刻意的：别让飘出去的 bust 再乘一遍斜率）
  assert.ok(Math.abs(big.bust_cm * 10 - t.bust_mm[P99]) < 1)
  assert.ok(Math.abs(small.bust_cm * 10 - t.bust_mm[P1]) < 1)
  const expect = t.shoulder_mm[P50] + SHOULDER_SLOPE['男'] * (t.bust_mm[P99] - t.bust_mm[P50])
  assert.ok(
    big.shoulder_cm * 10 <= Math.min(expect, t.shoulder_mm[P99]) + 1,
    JSON.stringify([big.shoulder_cm, expect]),
  )
})

test('表 2／表 7（18~25）肩宽 spread 没抄 ⇒ 绝对框退化成包络比，且必须打 clamp_from_envelope', () => {
  for (const gender of ['男', '女']) {
    const r = estimateBodyDims({ gender, height: gender === '男' ? 172 : 160, weight: 90, age: 20 })
    assert.strictEqual(r.band, '18~25')
    assert.ok(r.flags.includes('clamp_from_envelope'), JSON.stringify(r.flags))
    const p50 = ANCHORS[gender]['18~25'].shoulder_mm[P50]
    assert.ok(r.shoulder_cm * 10 >= p50 * SHOULDER_ENVELOPE[0] - 1)
    assert.ok(r.shoulder_cm * 10 <= p50 * SHOULDER_ENVELOPE[1] + 1)
  }
  // 其余六档不许出现这条 flag
  const other = estimateBodyDims({ gender: '男', height: 175, weight: 90, age: 30 })
  assert.ok(!other.flags.includes('clamp_from_envelope'), JSON.stringify(other.flags))
})

test('flag 只在真咬住时打：没夹过的格子 flags 必须是空数组', () => {
  // 男 168/70 没填年龄：胸围 94.8、肩宽 39.2（÷身高 23.3%，在本表框内）⇒ 一条 flag 都不该有
  const r = estimateBodyDims({ gender: '男', height: 168, weight: 70 })
  assert.deepStrictEqual(r.flags, [])
  assert.strictEqual(r.bust_cm, 94.8)
  assert.strictEqual(r.shoulder_cm, 39.2)
  // 女 160/55/28 同样落在框内
  const f = estimateBodyDims({ gender: '女', height: 160, weight: 55, age: 28 })
  assert.deepStrictEqual(f.flags, [])
  assert.strictEqual(f.bust_cm, 87.5)
  assert.strictEqual(f.shoulder_cm, 35.7)
})

test('身高相对框咬住时要同时打两个 flag；两框打架时取本表那侧', () => {
  // 175cm/82kg 男：斜率式给 420.62mm，而 23.542%×1750＝412.0 ⇒ 上限来自身高框
  const hi = estimateBodyDims({ gender: '男', height: 175, weight: 82, age: 31 })
  assert.strictEqual(hi.shoulder_cm, 41.2)
  assert.ok(hi.flags.includes('shoulder_clamped'), JSON.stringify(hi.flags))
  assert.ok(hi.flags.includes('shoulder_height_envelope'), JSON.stringify(hi.flags))
  // 175cm/57kg 男（BMI 18.6）：斜率式给 347.97mm，而 21.056%×1750＝368.5 ⇒ 下限来自身高框
  const lo = estimateBodyDims({ gender: '男', height: 175, weight: 57 })
  assert.strictEqual(lo.shoulder_cm, 36.8)
  assert.ok(lo.flags.includes('shoulder_height_envelope'), JSON.stringify(lo.flags))
  // 男 140/30：身高在本表 P1（1528mm）之外 ⇒ 本表 P1 的下限比身高框的上限还高，两框打架
  const cf = estimateBodyDims({ gender: '男', height: 140, weight: 30, age: 30 })
  assert.ok(cf.flags.includes('shoulder_frame_conflict'), JSON.stringify(cf.flags))
  assert.strictEqual(cf.shoulder_cm, 34.5) // ＝表 3 的肩宽 P1，不是 23.54%×1400＝32.9
})

test('全网格：flag 不重复、肩宽永远在两框之内', () => {
  let n = 0
  for (const gender of ['男', '女']) {
    for (let height = 140; height <= 200; height += 2) {
      for (let weight = 30; weight <= 150; weight += 2) {
        for (const age of [null, 20, 30, 50, 70]) {
          const r = estimateBodyDims({ gender, height, weight, age })
          assert.ok(r, JSON.stringify({ gender, height, weight, age }))
          n++
          assert.strictEqual(new Set(r.flags).size, r.flags.length, JSON.stringify(r.flags))
          const t = ANCHORS[gender][r.band]
          const mm = r.shoulder_cm * 10
          // 本表框（表 2/7 用包络）±0.5mm（r1 取整的宽度）
          const lo =
            t.shoulder_mm[P1] === null
              ? t.shoulder_mm[P50] * SHOULDER_ENVELOPE[0]
              : t.shoulder_mm[P1]
          const hi =
            t.shoulder_mm[P99] === null
              ? t.shoulder_mm[P50] * SHOULDER_ENVELOPE[1]
              : t.shoulder_mm[P99]
          const conflict = r.flags.includes('shoulder_frame_conflict')
          assert.ok(mm >= lo - 0.6, `${gender} ${r.band} ${height}/${weight} ⇒ ${r.shoulder_cm}`)
          assert.ok(
            conflict || mm <= hi + 0.6,
            `${gender} ${r.band} ${height}/${weight} ⇒ ${r.shoulder_cm}`,
          )
          // 胸围永远在本表 P1/P99 内
          assert.ok(r.bust_cm * 10 >= t.bust_mm[P1] - 0.6 && r.bust_cm * 10 <= t.bust_mm[P99] + 0.6)
        }
      }
    }
  }
  assert.strictEqual(n, 18910) // 2 性别 × 31 身高 × 61 体重 × 5 年龄
})

test('现实体型网格（BMI 18.5~28、身高 145~195）：肩宽÷身高落在 21%~24%', () => {
  let out = 0
  let n = 0
  for (const gender of ['男', '女']) {
    for (let height = 145; height <= 195; height += 5) {
      for (const bmi of [18.5, 20, 22, 24, 26, 28]) {
        const weight = Math.round((height / 100) * (height / 100) * bmi)
        if (weight < 30 || weight > 150) continue
        for (const age of [null, 20, 30, 50]) {
          const r = estimateBodyDims({ gender, height, weight, age })
          n++
          const pct = (r.shoulder_cm / height) * 100
          if (pct < 21 || pct > 24) out++
        }
      }
    }
  }
  assert.ok(n > 400, `网格太小：${n}`)
  assert.strictEqual(
    out,
    0,
    `有 ${out}/${n} 格估算肩宽÷身高越出 21~24%（BODY_REF.shoulder_band 同源）`,
  )
})

// —— ④ 输出契约 ——

test('文档 §四 的两个例子逐格复算：168/70 干净格与 175/82/31 被身高框夹住那格', () => {
  const clean = estimateBodyDims({ gender: '男', height: 168, weight: 70 })
  assert.strictEqual(clean.bust_cm, 94.8)
  assert.strictEqual(clean.shoulder_cm, 39.2)
  assert.strictEqual(clean.band, '18~70')
  assert.deepStrictEqual(clean.flags, [])
  assert.strictEqual(clean.basis.table, 'GB/T 10000-2023 表 1')

  const clamped = estimateBodyDims({ gender: '男', height: 175, weight: 82, age: 31 })
  assert.strictEqual(clamped.bust_cm, 102.3)
  assert.strictEqual(clamped.shoulder_cm, 41.2)
  assert.strictEqual(clamped.band, '26~35')
  assert.strictEqual(clamped.basis.table, 'GB/T 10000-2023 表 3')
  assert.strictEqual(clamped.basis.page, 'PDF p10~p11（印刷 7~8）')
  assert.strictEqual(clamped.basis.bust_p50_mm, 924)
  assert.strictEqual(clamped.basis.shoulder_p50_mm, 391)
  assert.strictEqual(clamped.basis.exponent, BUST_EXPONENT)
  assert.strictEqual(clamped.basis.slope, 0.3)
  // 两个例子的肩宽÷身高：23.33% 与 23.54%（后者正压在配对包络上沿）
  assert.strictEqual(Math.round((clean.shoulder_cm / 168) * 10000) / 100, 23.33)
  assert.strictEqual(Math.round((clamped.shoulder_cm / 175) * 10000) / 100, 23.54)
})

test('输出契约的形状：只有规范里那几格，⛔ 不许冒置信度／准确率／星级', () => {
  const r = estimateBodyDims({ gender: '女', height: 160, weight: 55, age: 28 })
  assert.deepStrictEqual(Object.keys(r).sort(), [
    'band',
    'basis',
    'bust_cm',
    'estimated',
    'flags',
    'shoulder_cm',
  ])
  assert.deepStrictEqual(Object.keys(r.basis).sort(), [
    'bust_p50_mm',
    'evidence',
    'exponent',
    'page',
    'shoulder_p50_mm',
    'slope',
    'table',
  ])
  for (const banned of ['confidence', 'accuracy', 'score', 'stars', 'probability']) {
    assert.ok(!(banned in r) && !(banned in r.basis), banned)
  }
  assert.strictEqual(r.estimated, true)
  // evidence 字符串必须自带档位，谁读到这份数都知道曲线是 C 档
  assert.match(r.basis.evidence, /目视抄读/)
  assert.match(r.basis.evidence, /C 档/)
  assert.match(r.basis.evidence, /1335/)
})

test('同一档案重复调用结果稳定（纯函数，不吃时间不吃库）', () => {
  const a = estimateBodyDims({ gender: '女', height: 168, weight: 70, age: 40 })
  const b = estimateBodyDims({ gender: '女', height: 168, weight: 70, age: 40 })
  assert.deepStrictEqual(a, b)
  // 字段别名：height_cm／weight_kg 与 height／weight 同解（档案里存的是带单位的那套名）
  const c = estimateBodyDims({ gender: '女', height_cm: 168, weight_kg: 70, age: 40 })
  assert.deepStrictEqual(c, a)
})

// —— ⑥ 接线：估算值只许补 person_cm 那两格（`13` §五 七条禁令逐条对质）——

/** 把 enrichProfile 的输出改回"没有这一格"，用来做喂／不喂 est 的同档差分 */
const withoutEst = (p) => ({ ...p, body_est: null })

test('接线①：enrichProfile 只挂 body_est 一格，⛔ 不改写 bust/shoulder、不新造 body_type（§五 第 7、2 条）', () => {
  const raw = { gender: 'male', height: 168, weight: 70 }
  const p = enrichProfile(raw)
  assert.strictEqual(p.body_est.bust_cm, 94.8)
  assert.strictEqual(p.body_est.shoulder_cm, 39.2)
  // 🔴 档案里那两格"用户没填就是没填"必须一直成立
  assert.ok(!('bust' in p), 'enrichProfile 写出了 p.bust')
  assert.ok(!('shoulder' in p), 'enrichProfile 写出了 p.shoulder')
  assert.ok(!('bust' in raw) && !('body_est' in raw), '入参档案被就地改了')
  // ⛔ 不喂体型五分类：computeBodyShape 只在 bust&&waist&&hip 都量到时才跑，
  //    估算值若洗进那三个字段，就会凭空造出一个"你是苹果型"的结论
  assert.ok(!('body_type' in p), JSON.stringify(p.body_type))
  assert.ok(!('wh_ratio' in p) && !('shoulder_ratio' in p))
  // 只有身高体重时 BMI 照常算（这条不依赖估算，是"只填身高体重"本来就该有的）
  assert.strictEqual(p.bmi, 24.8)
  // 性别归一在估算之前完成：'male' 已翻成 '男'，否则 estimateBodyDims 直接拒算
  assert.strictEqual(p.gender, '男')
})

test('接线②：喂 est 与不喂 est，同一份档案的 measure 与 want 逐格相同（§五 第 4 条）', () => {
  const profiles = [
    { gender: '男', height: 168, weight: 70 },
    { gender: '男', height: 175, weight: 82, age: 31 }, // 会被身高框夹住肩宽那格
    { gender: '男', height: 175, weight: 57 }, // BMI 18.6，压在下沿
    { gender: '男', height: 140, weight: 30, age: 30 }, // 两框打架
    { gender: '女', height: 160, weight: 55, age: 28 },
    { gender: '女', height: 160, weight: 55, age: 12 }, // 未成年：只打 flag，不改口径
    { gender: '女', height: 160, weight: 55, age: 75 }, // ≥61：表 5 没抄
    { gender: '男', height: 168, weight: 70, waist: 82, hip: 96, leg_length: 90 }, // 带别的实测值
  ]
  for (const f of profiles) {
    const enriched = enrichProfile(f)
    const withEst = bodyDeviation(enriched)
    const noEst = bodyDeviation(withoutEst(enriched))
    assert.deepStrictEqual(withEst.measure, noEst.measure, `measure 变了：${JSON.stringify(f)}`)
    assert.deepStrictEqual(withEst.want, noEst.want, `want 变了：${JSON.stringify(f)}`)
    assert.deepStrictEqual(
      withEst.ease_window,
      noEst.ease_window,
      `ease_window 变了：${JSON.stringify(f)}`,
    )
    // 而 person_cm 该补的两格必须真的补上了（这条断言不在上面三条里，是接线本身生效的证据）
    const est = enriched.body_est
    assert.ok(est, JSON.stringify(f))
    assert.strictEqual(withEst.person_cm.bust, est.bust_cm)
    assert.strictEqual(withEst.person_cm.shoulder, est.shoulder_cm)
    assert.strictEqual(noEst.person_cm.bust, null)
    assert.strictEqual(noEst.person_cm.shoulder, null)
    // 其余格子（身高／腰／臀）一个都不许被估算碰
    assert.deepStrictEqual(
      {
        height: withEst.person_cm.height,
        waist: withEst.person_cm.waist,
        hip: withEst.person_cm.hip,
      },
      { height: noEst.person_cm.height, waist: noEst.person_cm.waist, hip: noEst.person_cm.hip },
    )
  }
  // 第二个入参与 body_est 通道同解（现有五个调用点不改也吃得到的那套回落逻辑）
  const e = enrichProfile({ gender: '男', height: 168, weight: 70 })
  assert.deepStrictEqual(
    bodyDeviation(withoutEst(e), e.body_est).person_cm,
    bodyDeviation(e).person_cm,
  )
})

test('接线③：实测优先——量到了胸围/肩宽，估算值一个都不许顶上去（§五 第 7 条的"哪个是真的"）', () => {
  const e = enrichProfile({ gender: '男', height: 168, weight: 70 })
  const dev = bodyDeviation({ ...e, bust: 100, shoulder: 45 })
  assert.strictEqual(dev.person_cm.bust, 100)
  assert.strictEqual(dev.person_cm.shoulder, 45)
  assert.deepStrictEqual(dev.person_cm_src, {
    height: 'measured',
    bust: 'measured',
    shoulder: 'measured',
    waist: null,
    hip: null,
  })
  // 只补一半：量了胸围没量肩宽 ⇒ bust 记 measured、shoulder 记 estimated
  const half = bodyDeviation({ ...e, bust: 100 })
  assert.strictEqual(half.person_cm.bust, 100)
  assert.strictEqual(half.person_cm.shoulder, e.body_est.shoulder_cm)
  assert.strictEqual(half.person_cm_src.bust, 'measured')
  assert.strictEqual(half.person_cm_src.shoulder, 'estimated')
  // 半路塞进来的坏 est（没经 estimateBodyDims 的裸对象）不许生效：只认 estimated===true 那份
  assert.strictEqual(
    bodyDeviation(withoutEst(e), { bust_cm: 999, shoulder_cm: 999 }).person_cm.bust,
    null,
  )
  // notes 里必须露名"这是估的"，⛔ 不许让人读成"你填的胸围"（§五 第 6 条）
  const withBoth = bodyDeviation(e)
  assert.ok(
    withBoth.notes.some((s) => /估/.test(s) && /净胸围/.test(s)),
    JSON.stringify(withBoth.notes),
  )
  assert.ok(
    withBoth.notes.some((s) => /估/.test(s) && /净肩宽/.test(s)),
    JSON.stringify(withBoth.notes),
  )
  assert.ok(bodyDeviation(withoutEst(e)).notes.every((s) => !/净胸围没量/.test(s)))
})

test('接线④：估算顶上的那一轴在覆盖率里按半格；两侧同轴不叠乘（§五 第 5 条）', () => {
  assert.strictEqual(
    ESTIMATED_BODY_AXIS_WEIGHT,
    ESTIMATED_AXIS_WEIGHT,
    '身体侧与版型侧的半格必须同值（13 §五 第 5 条写明"同值、同一含义"）',
  )
  const e = enrichProfile({ gender: '男', height: 168, weight: 70 })
  const dev = bodyDeviation(e)
  // 成衣只填胸围一格、且净胸围是估的 ⇒ 只有松量这一轴在场，算半格 ⇒ 0.5/6
  const onlyBust = describeTop({ name: 'T恤', bust_cm: 104 }, dev)
  assert.strictEqual(onlyBust.ease, 9.2) // 104 − 94.8
  assert.strictEqual(onlyBust.ease_src, 'bust_est')
  assert.deepStrictEqual(onlyBust.estimated, ['ease'])
  assert.deepStrictEqual(onlyBust.body_estimated, ['ease'])
  assert.strictEqual(onlyBust.coverage, 0.08) // round(0.5/6, 2)
  assert.ok(onlyBust.measured.includes('bust_cm'), '成衣那格确实是实测，measured 照常记')
  // 版型也选了档 ⇒ 仍只算一次半格（`estimated` 去重，绝不叠乘成 0.25）
  const withFit = describeTop({ name: 'T恤', bust_cm: 104, fit_type: '宽松' }, dev)
  assert.strictEqual(withFit.ease, 9.2, '有净胸围（哪怕是估的）⇒ 走减法，版型那格不参与')
  assert.strictEqual(withFit.ease_src, 'bust_est')
  assert.strictEqual(withFit.estimated.length, new Set(withFit.estimated).size)
  assert.strictEqual(withFit.estimated.filter((k) => k === 'ease').length, 1)
  assert.strictEqual(withFit.coverage, 0.08)
  // 胸围实测的人选了版型 ⇒ 版型仍是那一半格（老行为一字不动）
  const realBust = describeTop(
    { name: 'T恤', bust_cm: 104, fit_type: '宽松' },
    bodyDeviation({ ...e, bust: 100 }),
  )
  assert.strictEqual(realBust.ease_src, 'bust_cm')
  assert.deepStrictEqual(realBust.estimated, [])
  assert.strictEqual(realBust.coverage, 0.17) // 1/6
  // 肩宽那一格也是估的 ⇒ 两轴各按半格 ⇒ (0.5+0.5)/6＝0.17
  // ⚠️ 10-20 第六阶段·第一步改口：这一格原来写的是 `color: '黑'`＋注释"'黑' 认不出色名 ⇒
  //    体量那轴整格都没有"。扩表把单字键 黑／白 收进词表后，'黑' 现在认得出（hex #111111），
  //    体量那一轴按整格进场 ⇒ 同一条写法拿不到 0.17 了。所以这一格换成"确实翻不出色的写法"，
  //    半格那笔账要留得住；'黑' 认得出这一事实另起一条断言（下面 twoBlack）。
  const two = describeTop({ name: '外套', bust_cm: 104, shoulder_cm: 44, color: '看不出色' }, dev)
  assert.strictEqual(two.shoulder_src, 'shoulder_est')
  assert.deepStrictEqual(two.estimated, ['ease', 'shoulder'])
  assert.deepStrictEqual(two.body_estimated, ['ease', 'shoulder'])
  assert.strictEqual(two.coverage, 0.17)
  assert.strictEqual(two.volume, null, '翻不出色也没有厚薄档 ⇒ 体量这一整格缺席')
  // 单字色名现在认得出 ⇒ 同一件加一格 '黑' 就把体量那一整格补上（0.5+0.5+1)/6＝0.33
  const twoBlack = describeTop({ name: '外套', bust_cm: 104, shoulder_cm: 44, color: '黑' }, dev)
  assert.strictEqual(
    twoBlack.coverage,
    0.33,
    "扩表后 '黑' 认得出 ⇒ 体量轴进场，覆盖率从 0.17 抬到 0.33",
  )
  assert.ok(twoBlack.volume < 0, '近黑应判成"收"')
  // 色认得出（hex）⇒ 体量那一轴按**整格**计：(0.5+0.5+1)/6＝0.33（身体侧的半格只压身体侧那两轴）
  const three = describeTop({ name: '外套', bust_cm: 104, shoulder_cm: 44, color: '#333333' }, dev)
  assert.strictEqual(three.coverage, 0.33)
  // 不喂 dev（老调用方传 null）不许崩，新字段各归其位
  const noDev = describeTop({ name: 'T恤', bust_cm: 104 }, null)
  assert.strictEqual(noDev.ease, null)
  assert.strictEqual(noDev.ease_src, null)
  assert.deepStrictEqual(noDev.body_estimated, [])
  const noRow = describeTop(null, dev)
  assert.strictEqual(noRow.ease_src, null)
  assert.strictEqual(noRow.shoulder_src, null)
  assert.deepStrictEqual(noRow.body_estimated, [])
})

test('接线⑤：估算值进不了规则匹配——扫遍 db/seed 的条件字段，body_est 与它那几个 key 都不在场（§五 第 3 条）', () => {
  const dir = path.join(__dirname, '..', 'db', 'seed')
  const fields = new Set()
  let rows = 0
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const seed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    for (const c of seed.rule_conditions || []) {
      rows++
      if (c.field) fields.add(c.field)
    }
  }
  assert.ok(rows >= 700, `条件行太少（${rows}），这份扫描没有分母了`)
  assert.ok(fields.size >= 20, `条件字段太少（${fields.size}）`)
  // 估算通道本身＋它输出的每一格，都不许是任何一个规则条件字段
  for (const banned of ['body_est', 'bust_cm', 'shoulder_cm', 'band', 'basis', 'flags']) {
    assert.ok(
      !fields.has(banned),
      `规则条件字段里有「${banned}」⇒ 估算值会直接参与匹配，必须重开这一层`,
    )
  }
  // 建档层那两个原值今天也没被规则当条件用（今天没被读 ⇒ 只要不往 p.bust 写，就不可能命中）
  assert.ok(
    !fields.has('bust') && !fields.has('shoulder'),
    '规则开始读 bust/shoulder 了：接线要重审',
  )
})

test('接线⑥：端到端——只填身高体重的人现在能被打上架，且那两轴身上带着"估的"记号', () => {
  const e = enrichProfile({ gender: '男', height: 168, weight: 70 })
  const tops = [
    { name: '衬衫', bust_cm: 104, shoulder_cm: 44, length_cm: 70, waistband_cm: 0, color: '白' },
    { name: '什么都没量的那件' },
  ]
  const rankedAll = rankTopsByBody(e, tops)
  assert.strictEqual(rankedAll.ranked.length, 1, JSON.stringify(rankedAll.unscored_reason))
  assert.strictEqual(rankedAll.unscored, 1)
  assert.ok(rankedAll.ranked[0].score > 0 && rankedAll.ranked[0].coverage > 0)
  const on = topFitBody(e, tops[0])
  const axes = on.axes
  assert.strictEqual(
    axes.find((a) => a.key === 'ease').estimated,
    true,
    '松量轴用了估算净胸围却没标 estimated ⇒ provenance 丢了',
  )
  assert.strictEqual(axes.find((a) => a.key === 'ease').based_on.includes('估'), true)
  assert.ok(axes.find((a) => a.key === 'ease').score != null)
  // 🔴 现量出来的结构性事实（登记在 `13` §六 第 8 条，等拍板）：**估算净肩宽今天进不了总分**。
  //    want.shoulder 那三条腿（肩宽÷身高、肩宽÷腰围、胸臀差）全都只读"量到的"字段——
  //    §五 第 2/4 条禁止估算喂 want ⇒ 净肩宽没实测的人 `want.shoulder === null` ⇒
  //    这一维 `align()` 无从算 ⇒ 肩宽那一格只出数、只进覆盖率，不贡献分数。
  assert.strictEqual(bodyDeviation(e).want.shoulder, null)
  assert.ok(on.top.shoulder != null, '肩缝外移这个数确实算出来了')
  assert.ok(!on.axes_present.includes('shoulder'), '但它今天不出场 ⇒ 见上条')
  // 🔴 10-20 第六阶段·扩表后这条的现实变了：单字色名「白／黑」进了词表 ⇒ 观感体量那一轴只要
  //    「颜色的 Lab 明度 ＋ fabric_weight 自填厚薄档」就能出分，一尺身体都不用量。所以关掉估算通道
  //    后这件不再是 null，而是**只剩体量一轴**。这条断言守的仍然是它本来的意图：估算通道不许多修一维、
  //    也不许给"没量身体的人"凭空造出松量／肩宽两轴。口径变更登记在 `13` §六 与《第六阶段进展报告》。
  const off = topFitBody(withoutEst(e), tops[0])
  assert.ok(off, '关掉估算后这件该还能靠"颜色＋厚薄"出体量分（扩表后的新口径）')
  assert.deepStrictEqual(
    off.axes.map((a) => a.key),
    ['volume'],
    `关掉估算后出分的轴必须只剩体量一轴，实际是 ${off.axes.map((a) => a.key).join(',')} ⇒ 有身体侧的轴漏进来了`,
  )
  assert.ok(!off.axes_present.includes('ease') && !off.axes_present.includes('shoulder'))
  // 第二件连颜色都没有 ⇒ 一维凑不齐，仍然不出处方
  assert.strictEqual(topFitBody(withoutEst(e), tops[1]), null)
  assert.strictEqual(rankTopsByBody(withoutEst(e), tops).ranked.length, 1)

  // 两条生产入口都必须"先 enrich 再算偏差"，否则 `p.body_est` 这格根本不在场、接线在现场失灵
  //（`recommendationBodyDeviation` 与 `buildRecommendation` 是 routes/wardrobe.js:760 与推荐主链路各自的那一个入口）
  const eng = fs.readFileSync(path.join(__dirname, '..', 'services/recommendEngine.js'), 'utf8')
  assert.match(
    eng,
    /const enriched = enrichProfile\(profile\)[\s\S]{0,240}bodyDeviation\(enriched\)/,
  )
  assert.match(eng, /bodyDeviation\(enrichProfile\(profile \|\| \{\}\)\)/)
})

test('接线⑦（本轮现量到的挂账·等拍板）：估算净肩宽只抬覆盖率、不贡献分数，注水幅度已量出', () => {
  const e = enrichProfile({ gender: '男', height: 168, weight: 70 })
  // 一件只量了肩宽＋颜色的外套：松量轴整块缺席 ⇒ 覆盖率里唯一的变量就是肩宽那一格
  const row = { name: '外套', shoulder_cm: 44, color: '#333333' }
  const on = topFitBody(e, row)
  const off = topFitBody(withoutEst(e), row)
  assert.deepStrictEqual(
    on.axes_present,
    off.axes_present,
    '出分的轴必须一模一样（估算没资格多修一维）',
  )
  assert.strictEqual(off.coverage, 0.17) // 1/6：只有体量那一轴出分
  assert.strictEqual(on.coverage, 0.25) // 肩宽轴按半格进场（0.5/6≈0.083），但 axes_present 里没有它
  // 后果：惩罚因子 floor+span×coverage 白涨 0.5×0.5/6≈0.042 ⇒ 0.59 → 0.63，分数高约 7%。
  // 这是**已登记的缺陷**、不是这条接线的目标（口径见 `13` §六 第 8 条：覆盖率只该数真正出分的轴）。
  assert.strictEqual(off.coverage_penalty, 0.59)
  assert.strictEqual(on.coverage_penalty, 0.63)
  assert.ok(on.score > off.score, `${on.score} 该高于 ${off.score}`)
})

// —— ⑧ 腰围回归方程（苏南 18~24 岁女性研究，B=0.59W+45.37／H=0.55W+53.96）——

test('腰围回归：论文回代值逐格复算（W=68 ⇒ B=85.5／H=91.4）', () => {
  // 论文用 GB/T 1335.2—2008 的 165/84A（W=68）回代：B=85.49／H=91.36
  const r = estimateFromWaist({ gender: '女', waist: 68, age: 22 })
  assert.strictEqual(r.bust_cm, 85.5) // r1(0.59×68+45.37)＝r1(85.49)＝85.5
  assert.strictEqual(r.hip_cm, 91.4) // r1(0.55×68+53.96)＝r1(91.36)＝91.4
  assert.strictEqual(r.estimated, true)
  assert.strictEqual(r.basis.sample_size, 185)
  assert.strictEqual(r.basis.region, '苏南')
})

test('腰围回归：样本均值回代（W=67.16 ⇒ B≈84.99／H≈90.89）', () => {
  // 论文样本均值 W=67.16，代入方程应接近样本均值 B=85.02／H=91.13
  const r = estimateFromWaist({ gender: '女', waist: 67.16, age: 20 })
  assert.ok(Math.abs(r.bust_cm - 85.0) < 0.2, `bust=${r.bust_cm}`)
  assert.ok(Math.abs(r.hip_cm - 90.9) < 0.2, `hip=${r.hip_cm}`)
})

test('腰围回归：输入不合格一律返回 null', () => {
  const bad = [
    {}, // 什么都没有
    { waist: 68 }, // 缺性别
    { gender: '男', waist: 68 }, // ⛔ 男性群体无此方程
    { gender: '女' }, // 缺腰围
    { gender: '女', waist: 39.9 }, // 低于框
    { gender: '女', waist: 130.1 }, // 高于框
    { gender: '女', waist: '细腰' }, // 非数字
    { gender: '女', waist: null },
    null,
    undefined,
  ]
  for (const input of bad) {
    assert.strictEqual(estimateFromWaist(input), null, JSON.stringify(input))
  }
  // 框的两个角本身合法（闭区间）
  assert.ok(estimateFromWaist({ gender: '女', waist: 40 }))
  assert.ok(estimateFromWaist({ gender: '女', waist: 130 }))
})

test('腰围回归：年龄超出 18~35 打 flag 但仍可算', () => {
  const inRange = estimateFromWaist({ gender: '女', waist: 68, age: 22 })
  assert.deepStrictEqual(inRange.flags, [])
  const old = estimateFromWaist({ gender: '女', waist: 68, age: 40 })
  assert.deepStrictEqual(old.flags, ['age_out_of_study_range'])
  // 方程不随年龄变，数一样
  assert.strictEqual(old.bust_cm, inRange.bust_cm)
})

test('腰围回归：输出契约——不许冒置信度／准确率', () => {
  const r = estimateFromWaist({ gender: '女', waist: 68 })
  assert.deepStrictEqual(Object.keys(r).sort(), [
    'basis',
    'bust_cm',
    'estimated',
    'flags',
    'hip_cm',
  ])
  for (const banned of ['confidence', 'accuracy', 'score', 'stars']) {
    assert.ok(!(banned in r), banned)
  }
})

test('腰围回归接线①：enrichProfile 合并估算通道——胸围优先腰围回归，臀围只从腰围来', () => {
  // 女性、填了腰围但没填胸围/臀围、有身高体重
  const e = enrichProfile({ gender: '女', height: 165, weight: 55, waist: 68, age: 22 })
  // bust 从腰围回归：0.59×68+45.37=85.5（不是身高体重幂律的 87.5）
  assert.strictEqual(e.body_est.bust_cm, 85.5)
  assert.strictEqual(e.body_est.bust_from, 'waist_regression')
  // hip 只能从腰围回归来
  assert.strictEqual(e.body_est.hip_cm, 91.4)
  assert.strictEqual(e.body_est.hip_from, 'waist_regression')
  // shoulder 只从身高体重来
  assert.strictEqual(e.body_est.shoulder_from, 'height_weight')
  // ⛔ 不改写档案原值
  assert.ok(!('bust' in e) && !('hip' in e))
})

test('腰围回归接线②：topFitBody 用估算值补全 person_cm.hip，且 measure 向量不碰估算值', () => {
  const e = enrichProfile({ gender: '女', height: 165, weight: 55, waist: 68, age: 22 })
  const dev = bodyDeviation(e)
  // hip 从腰围回归顶上
  assert.strictEqual(dev.person_cm.hip, 91.4)
  assert.strictEqual(dev.person_cm_src.hip, 'estimated')
  // bust 从腰围回归顶上（优先级高于身高体重）
  assert.strictEqual(dev.person_cm.bust, 85.5)
  assert.strictEqual(dev.person_cm_src.bust, 'estimated')
  // measure 向量的 hip_waist_diff 用的是实测值——腰围量了但臀围没量 ⇒ 仍为 null
  // （估算值只进 person_cm，不进 measure）
  assert.strictEqual(dev.measure.hip_waist_diff, null)
  // notes 里必须露名"臀围是估的"
  assert.ok(
    dev.notes.some((s) => /净臀围没量/.test(s)),
    JSON.stringify(dev.notes),
  )
})

test('腰围回归接线③：有实测胸围时，腰围回归的胸围不许顶上去', () => {
  const e = enrichProfile({ gender: '女', height: 165, weight: 55, waist: 68, bust: 90, age: 22 })
  const dev = bodyDeviation(e)
  // 实测胸围优先
  assert.strictEqual(dev.person_cm.bust, 90)
  assert.strictEqual(dev.person_cm_src.bust, 'measured')
  // 臀围仍是估算（没量）
  assert.strictEqual(dev.person_cm.hip, 91.4)
})

test('腰围回归接线④：男性档案不触发腰围回归', () => {
  const e = enrichProfile({ gender: '男', height: 175, weight: 70, waist: 80, age: 30 })
  // 男性没有 hip_cm 估算
  assert.strictEqual(e.body_est.hip_cm, undefined)
  assert.strictEqual(e.body_est.hip_from, undefined)
  // bust 从身高体重幂律来
  assert.strictEqual(e.body_est.bust_from, 'height_weight')
})
