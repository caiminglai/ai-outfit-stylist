/**
 * 权重回归：从反馈快照反推 rule / color / body 的最优权重（默认三维，`--source=item` 走色彩＋廓形两维）
 * ============================================================
 * 2026-10-19 第三阶段·模块三。产品原话：「虽然现在我们数据少，但架构必须先搭好。」
 * 所以这个脚本现在的常态输出就是**「样本不够，不可回归」**——那是设计的一部分，不是失败。
 * 它要先把四件事钉住，等数据流进来时不用重写：
 *   1. 自变量从哪来：`feedback_events.rank_snapshot`（打分那一刻的三维分快照，见 schema.sql:315）
 *      或 `item_feedback.rank_snapshot`（人×衣服那张表，只有 color/body 两维，见 schema.sql:668）
 *      ——两档口径靠 `--source` 切换，向量不同尺，绝不许混着比较（见下面 SCOPES 那段）
 *   2. 因变量有哪几种：`signal`（有用/不准）、`aesthetic_score`（审美 1~5）、`fit_score`（合身 1~5）
 *   3. 模型形状与线上公式一致：**ŷ = Σ wᵢxᵢ，w 非负且和为 1，不加截距**
 *      （recommendEngine.rankDims 的综合分就是这个凸组合，加截距等于回归出一套线上跑不出来的公式）
 *   4. 硬闸门：样本不足 / 三维不齐 / 因变量无方差 ⇒ 直接报不可回归，**不猜一个权重出来**
 *
 * ⛔ 本脚本只读不写：
 *   - 不 require `../db/init`（那个模块一加载就建表、补列、清会话、跑 checkpoint，等于顺手动活库），
 *     而是自己开 `better-sqlite3` 的 `readonly: true` 句柄；
 *   - 不自动改 `RANK_WEIGHTS`、不写任何表。它只把建议数字打出来，改不改由人决定，
 *     改的位置是 `backend/services/recommendEngine.js` 里的 `RANK_WEIGHTS`（10-21 现量 L560）。
 *
 * 依据档位（写进对外话术前必须知道）：回归出来的权重在样本上百之前只是**这批反馈的相关性**，
 * 不是新依据；`RANK_WEIGHTS` 现在这一组是产品口径（C 档手拍）。两者别混着说。
 *
 * 用法：
 *   node scripts/regress-rank-weights.js                        # 三种因变量各跑一遍
 *   node scripts/regress-rank-weights.js --target=aesthetic     # 只跑一把星
 *   node scripts/regress-rank-weights.js --source=item          # 改读 item_feedback（色彩＋廓形两维）
 *   node scripts/regress-rank-weights.js --model=logistic        # 二分类换逻辑回归（带截距与温度）
 *   node scripts/regress-rank-weights.js --json                  # 机器可读，给自己排定时任务用
 *   对副本校验：STYLEAI_DB_PATH="E:/website/站3产生临时文件/xxx/copy.db" node scripts/regress-rank-weights.js
 */
const Database = require('better-sqlite3')

/** 参与回归的三个维度，顺序就是权重向量顺序 */
const DIM_KEYS = ['rule', 'color', 'body']

/**
 * 线上当前权重。**这是复制不是 require**：
 * `../services/recommendEngine` 顶上就 require `../db/init`，脚本一引它就把活库打开了。
 * 复制会漂移，所以 test/regressRankWeights.test.js 里钉了一条"两边数字必须相等"的漂移哨兵。
 * 10-20 第四阶段·第一步随线上改成 0.1/0.45/0.45（改前的 0.2/0.4/0.4 由那条哨兵当场抓出来过）。
 */
const CURRENT_WEIGHTS = { rule: 0.1, color: 0.45, body: 0.45 }

/**
 * 最少样本数闸门：比自变量个数(3)多是数学要求，多到 30 是统计要求——
 * 三个权重共 3 个自由度，再扣掉星级只有 5 档的取值稀疏，十几条点出来的"最优"基本是噪声。
 * 现量（10-19）：库里带快照的反馈行数为 0，所以这道闸门当前永远关着。
 */
const MIN_SAMPLES = 30

/**
 * `--source=item` 这一路的闸门（10-21 第九阶段·第一步，规范＝docs/依据/17 §六）。
 * 二维只有两个自由度，30 那条数是照着三维定的，跟着降；但 ⛔ 15 本身也是 C 档手拍值，
 * 它换来的是"能出一个建议数字"，不是"这个数字可信"——样本上百前那句老话一个字都不撤。
 */
const MIN_SAMPLES_ITEM = 15

/**
 * 两种样本口径（`--source`）。默认那档就是改前唯一的一条路，一个字节的行为都不变。
 *
 *  - `rules`：读 `feedback_events`（人×规则），自变量 rule/color/body 三维。
 *    这条路**结构上凑不出三维齐全的样本**（规则那一路不写 body_fit，见 17 §一 四条证据），
 *    所以它短期永远报"样本不够"——这不是 bug，是这张表的形状。
 *  - `item`：读 `item_feedback`（人×衣服，10-21 新建），自变量只有 color/body 两维。
 *    衣橱那一路量得出廓形也打得出星，所以它是**现在唯一真能攒出样本**的那条路。
 *    ⚠️ 两档的权重向量不同尺（三维和为 1 vs 两维和为 1），绝不许把两份读数当同一件事比较；
 *    二维那档建议的是"色彩与廓形之间怎么分"，规则维的权重它一个字都没资格动。
 */
const SCOPES = {
  rules: {
    table: 'feedback_events',
    dims: DIM_KEYS,
    min_samples: MIN_SAMPLES,
    read_sql: `
      SELECT group_id, user_id, signal, aesthetic_score, fit_score, rank_snapshot
      FROM feedback_events
      ORDER BY id
    `,
  },
  item: {
    table: 'item_feedback',
    dims: ['color', 'body'],
    min_samples: MIN_SAMPLES_ITEM,
    read_sql: `
      SELECT wardrobe_item_id, user_id, signal, aesthetic_score, fit_score, rank_snapshot
      FROM item_feedback
      ORDER BY id
    `,
  },
}

/** 因变量口径：每个都说明它从哪一列取、怎么归一到 0~1 */
const TARGETS = {
  /** 二分类：useful=1 / inaccurate=0，问的是「这条规则帮上忙没有」 */
  signal: { col: 'signal', kind: 'binary', label: '有用/不准（二分类）' },
  /** 五星：整体好不好看，主要吃色彩那一维 */
  aesthetic: { col: 'aesthetic_score', kind: 'star', label: '审美星级（1~5）' },
  /** 五星：上身合不合身，主要吃廓形那一维 */
  fit: { col: 'fit_score', kind: 'star', label: '合身星级（1~5）' },
}

const r4 = (v) => Math.round(v * 10000) / 10000

/** 报告里"三维／两维"这种说法要跟着口径走，不能写死（将来加维度时别再回来说谎） */
const CN_NUM = { 1: '一', 2: '两', 3: '三', 4: '四', 5: '五' }
const dimCn = (n) => (CN_NUM[n] || String(n)) + '维'

/**
 * 把反馈行变成 (x, y) 样本。`dims` 决定这一档口径要凑齐哪几维（默认三维＝改前行为一字不变）。
 * 剔除是逐条带原因的，原因要打进报告——「样本不够」必须说清是**没数据**还是**数据不全**，
 * 这决定下一步是该引导用户填星级，还是该修快照的写入路径。
 *
 * 三维里少任何一维（或那一格不是 0~100 的数）就整条剔除（listwise）：凸组合权重要求三维同尺，
 * 拿"缺 color 当 0 分"去拟合等于给缺测补分，直接违反 docs/依据/README.md:64「缺测不出分」（硬规矩 2）。
 */
function collectSamples(rows, target, dims = DIM_KEYS) {
  const spec = TARGETS[target]
  const dropped = { no_snapshot: 0, incomplete_dims: 0, no_target: 0, wrong_source: 0 }
  const samples = []
  for (const row of rows) {
    let snap = null
    try {
      snap = row.rank_snapshot ? JSON.parse(row.rank_snapshot) : null
    } catch {
      snap = null
    }
    if (!snap) {
      dropped.no_snapshot++
      continue
    }
    // 两维口径（--source=item）专用的一道闸：这张表的快照按 17 §二 只许有 color/body。
    // 哪天规则那一路的三维快照被写进 `item_feedback`（那是接错线，不是数据），这条把它挡住——
    // 两种尺子的样本搅在一口锅里，回归出来的"最优"没有人能复算。
    if (!dims.includes('rule') && snap.rule !== null && snap.rule !== undefined) {
      dropped.wrong_source++
      continue
    }
    // ⛔ 这里绝不能写 `Number(snap[k])` 完事：`Number(null)` 是 0、`Number('')` 也是 0，
    // 那一维没出分就会被当成"量出来 0 分"喂进回归——与 routes/wardrobe.js 的 measureError
    // 拦的是同一类病（没填 ≠ 填了 0），而且这里一旦混进去，回归会把权重推向"这维不重要"。
    const x = dims.map((k) => {
      const raw = snap[k]
      if (raw === null || raw === undefined || raw === '') return null
      const n = Number(raw)
      // 快照里的分本来就是 0~100；越界的（负数、900）当坏数据剔掉，不夹进去污染尺度
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
    })
    if (x.some((v) => v === null)) {
      dropped.incomplete_dims++
      continue
    }
    let y = null
    if (spec.kind === 'binary') {
      y = row.signal === 'useful' ? 1 : row.signal === 'inaccurate' ? 0 : null
    } else {
      const star = Number(row[spec.col])
      if (Number.isInteger(star) && star >= 1 && star <= 5) y = (star - 1) / 4
    }
    if (y === null) {
      dropped.no_target++
      continue
    }
    samples.push({ x: x.map((v) => v / 100), y, group_id: row.group_id, user_id: row.user_id })
  }
  return { samples, dropped }
}

/**
 * 投影到单纯形（w ≥ 0 且 Σw = 1）：排序算法的标准解，Duchi 2008。
 * 约束的意义：权重是"三件事各占多少话语权"，和不为 1 就不是占比，负权重线上公式也表达不了。
 *
 * θ 取**最后一个满足 v_(j) − (Σ_{k≤j}v_(k) − 1)/j > 0 的 j**，不是第一个不满足的那个
 * （写反了会出现"投影完的和是 1.47"这种看着合理、实则整条回归失去占比含义的结果，
 *  10-19 现量：错版在 [-0.4,0.7,0.9] 上出 [0.833,0.633,0]，test/regressRankWeights.test.js 那条打红了）。
 */
function projectOntoSimplex(v) {
  const n = v.length
  const sorted = v.slice().sort((a, b) => b - a)
  let cum = 0
  let theta = 0
  let rho = 0
  for (let j = 0; j < n; j++) {
    cum += sorted[j]
    const t = (cum - 1) / (j + 1)
    if (sorted[j] - t > 0) {
      rho = j + 1
      theta = t
    }
  }
  // 兜底：对任何有限输入 j=1 那一步恒满足（v₁−(v₁−1)/1＝1>0），所以 rho 至少为 1；
  // 只有 NaN 这类非法值会让比较全线为假，那时退成均匀分布，绝不把 NaN 带进权重向量。
  if (rho === 0) return v.map(() => 1 / n)
  return v.map((val) => Math.max(0, val - theta))
}

function normalizeStart(w) {
  const s = w.reduce((a, b) => a + Math.max(0, b), 0)
  if (s <= 0) return w.map(() => 1 / w.length)
  return projectOntoSimplex(w.map((v) => Math.max(0, v)))
}

/** 凸组合预测：ŷ = Σ wᵢxᵢ（线性模型直接用这个，逻辑模型再经一次 sigmoid） */
function dot(w, x) {
  let s = 0
  for (let i = 0; i < w.length; i++) s += w[i] * x[i]
  return s
}

function mse(w, X, y) {
  let s = 0
  for (let i = 0; i < X.length; i++) {
    const d = dot(w, X[i]) - y[i]
    s += d * d
  }
  return s / X.length
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z))
}

/** 逻辑回归的损失：logit = gain·Σwᵢxᵢ + shift。w 受单纯形约束，gain/shift 放开当标定用的自由度 */
function logLoss(w, gain, shift, X, y) {
  let s = 0
  for (let i = 0; i < X.length; i++) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(gain * dot(w, X[i]) + shift)))
    s += -(y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p))
  }
  return s / X.length
}

/**
 * 约束最小二乘 / 逻辑回归：投影梯度下降。
 * 步长做归一化（除以 n），迭代固定，因此同一份输入永远给同一个答案——
 * 回归结果要进文档、要能被别人复算，不能是"跑两次不一样"的随机搜索。
 *
 * 两个防跑飞的装置只在逻辑回归这路上起作用：
 *   - `ridge`：向现权收缩的 L2 惩罚。二分类在可分数据上方向是**弱可识别**的
 *     （只要符号对，logloss 可以一直压小、把权重推到角上），样本几十条时必须有个回拉的力；
 *   - `gain` / `shift` 夹在有限区间：不然它会靠把温度调大来降损失，那不是在学权重，是在学标定。
 */
function fitWeights(X, y, opts = {}) {
  const model = opts.model || 'linear'
  const iters = opts.iters || (model === 'logistic' ? 8000 : 6000)
  const ridge = opts.ridge === undefined ? (model === 'logistic' ? 0.05 : 0) : opts.ridge
  const dims = opts.dims || DIM_KEYS
  const anchor = normalizeStart(dims.map((k) => CURRENT_WEIGHTS[k]))
  let w = normalizeStart(opts.init || anchor)
  let gain = 4
  let shift = -2
  const n = X.length
  const lr = opts.lr || (model === 'logistic' ? 0.1 : 0.5)
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

  for (let t = 0; t < iters; t++) {
    const gw = X[0].map(() => 0)
    let gg = 0
    let gs = 0
    if (model === 'logistic') {
      for (let i = 0; i < n; i++) {
        const d = sigmoid(gain * dot(w, X[i]) + shift) - y[i]
        for (let k = 0; k < gw.length; k++) gw[k] += d * gain * X[i][k]
        gg += d * dot(w, X[i])
        gs += d
      }
    } else {
      for (let i = 0; i < n; i++) {
        const d = dot(w, X[i]) - y[i]
        for (let k = 0; k < gw.length; k++) gw[k] += d * X[i][k]
      }
    }
    // 线性那边是 2·Xᵀ(Xw−y)/n；逻辑那边梯度已带 1/n，惩罚项按同样量级进
    const scale = model === 'logistic' ? 1 / n : 2 / n
    const pull = ridge * 2
    w = projectOntoSimplex(w.map((v, k) => v - lr * (scale * gw[k] + pull * (v - anchor[k]))))
    if (model === 'logistic') {
      gain = clamp(gain - lr * (gg / n), 0.5, 12)
      shift = clamp(shift - lr * (gs / n), -12, 12)
    }
  }
  const loss = model === 'logistic' ? logLoss(w, gain, shift, X, y) : mse(w, X, y)
  const acc =
    model === 'logistic'
      ? X.filter((xi, i) => (sigmoid(gain * dot(w, xi) + shift) >= 0.5 ? 1 : 0) === y[i]).length / n
      : null
  return { weights: w, loss, gain, shift, model, iters, accuracy: acc, ridge }
}

/** 因变量一点方差都没有 ⇒ 任何权重都同样好/同样差，这叫不可识别，不许报"最优解" */
function hasVariance(y) {
  return y.length > 0 && y.some((v) => v !== y[0])
}

/**
 * 单种因变量的一轮完整分析。返回 report 对象，打印与断言都读它。
 * 不做任何写动作，也不 import 会写的模块。
 * `opts.source` 选样本口径（默认 `rules`＝改前那条路，行为与读数一个字节都不变）。
 */
function analyze(rows, opts = {}) {
  const target = opts.target || 'aesthetic'
  const model = opts.model || 'linear'
  const scope = SCOPES[opts.source] || SCOPES.rules
  const dims = scope.dims
  const minSamples = Number(opts.minSamples) > 0 ? Number(opts.minSamples) : scope.min_samples
  const spec = TARGETS[target]
  const { samples, dropped } = collectSamples(rows, target, dims)
  const X = samples.map((s) => s.x)
  const y = samples.map((s) => s.y)
  const base = {
    target,
    target_label: spec.label,
    model,
    source: scope.table,
    dims,
    rows_read: rows.length,
    samples: samples.length,
    dropped,
    min_samples: minSamples,
    current_weights: dims.map((k) => CURRENT_WEIGHTS[k]),
    // 现权换到这一档口径下的等效值（二维那档：0.45/0.45 归一成 0.5/0.5）。
    // ⛔ 不写这一行，"与现权最大单维偏移"就会拿三维的 0.45 去比二维的 0.5，那是假的 0.05。
    current_weights_renorm: normalizeStart(dims.map((k) => CURRENT_WEIGHTS[k])).map(r4),
  }
  if (samples.length < minSamples) {
    return {
      ...base,
      ok: false,
      reason:
        `带快照且${dimCn(dims.length)}齐全的样本只有 ${samples.length} 条，` +
        `闸门是 ${minSamples} 条`,
    }
  }
  if (!hasVariance(y)) {
    return { ...base, ok: false, reason: '这些样本的因变量取值完全相同，权重在数学上不可识别' }
  }
  const fit = fitWeights(X, y, { model, ridge: opts.ridge, dims })
  const cur = normalizeStart(base.current_weights)
  const curLoss = model === 'logistic' ? logLoss(cur, fit.gain, fit.shift, X, y) : mse(cur, X, y)
  const suggested = {}
  dims.forEach((k, i) => {
    suggested[k] = r4(fit.weights[i])
  })
  return {
    ...base,
    ok: true,
    suggested,
    suggested_vector: fit.weights.map(r4),
    ridge_lambda: fit.ridge,
    loss_current: r4(curLoss),
    loss_fitted: r4(fit.loss),
    loss_drop_pct: curLoss > 0 ? r4(((curLoss - fit.loss) / curLoss) * 100) : 0,
    accuracy: fit.accuracy === null ? null : r4(fit.accuracy),
    // 与现权的最大单维偏移：不到 0.05 就别为了小数点折腾线上
    max_shift: r4(Math.max(...fit.weights.map((v, i) => Math.abs(v - cur[i])))),
    worth_changing: r4(Math.max(...fit.weights.map((v, i) => Math.abs(v - cur[i])))) >= 0.05,
  }
}

/** 三种因变量逐个跑一遍（各自样本独立，缺哪把星那一路就自己报不够） */
function analyzeAll(rows, opts = {}) {
  const keys = opts.target && opts.target !== 'all' ? [opts.target] : Object.keys(TARGETS)
  return keys.map((t) => analyze(rows, { ...opts, target: t }))
}

function printReport(reports, json) {
  const dims = reports.length > 0 ? reports[0].dims : DIM_KEYS
  const src = reports.length > 0 ? reports[0].source : SCOPES.rules.table
  if (json) {
    console.log(
      JSON.stringify(
        { source: src, weights_vector_order: dims, sample_scope: src, reports },
        null,
        2,
      ),
    )
    return
  }
  console.log(
    `========== 推荐权重回归（${src} → ${dims.map((k, i) => `w${i + 1} ${k}`).join(' / ')}）==========`,
  )
  console.log(
    `线上现权：rule ${CURRENT_WEIGHTS.rule} / color ${CURRENT_WEIGHTS.color} / body ${CURRENT_WEIGHTS.body}` +
      `（recommendEngine.js 的 RANK_WEIGHTS（L560），改就改这一行）` +
      (dims.length === DIM_KEYS.length
        ? ''
        : `｜这一档只有 ${dimCn(dims.length)}，等效现权 ${JSON.stringify(reports[0] && reports[0].current_weights_renorm)}`),
  )
  for (const r of reports) {
    console.log(`\n--- 因变量：${r.target_label}｜模型：${r.model}｜口径：${r.source} ---`)
    console.log(
      `读数：库里 ${r.rows_read} 行 → 可用样本 ${r.samples} 条` +
        `（无快照 ${r.dropped.no_snapshot} / ${dimCn(r.dims.length)}不齐` +
        ` ${r.dropped.incomplete_dims} / 因变量缺失 ${r.dropped.no_target} /` +
        ` 口径不符 ${r.dropped.wrong_source}）`,
    )
    if (!r.ok) {
      console.log(`判定：不可回归——${r.reason}`)
      continue
    }
    console.log(
      `建议：${dims.map((k) => `${k} ${r.suggested[k]}`).join(' / ')}` +
        `（与现权最大单维偏移 ${r.max_shift}）`,
    )
    console.log(
      `拟合：损失 ${r.loss_current} → ${r.loss_fitted}（降 ${r.loss_drop_pct}%）` +
        (r.accuracy === null ? '' : `，判对率 ${r.accuracy}，向现权收缩 λ=${r.ridge_lambda}`),
    )
    console.log(
      `判定：${r.worth_changing ? `值得改——照上面那行手改 recommendEngine.js 的 RANK_WEIGHTS（L560，只许动 ${dims.join('/')} 那几维）` : '不值得改——偏移没到 0.05，维持现权'}`,
    )
  }
  console.log('\n本脚本不写库、不改代码。采纳与否由人判；样本上百前建议数字只当相关性看。')
}

function main() {
  const args = process.argv.slice(2)
  const get = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`))
    return hit ? hit.slice(name.length + 3) : null
  }
  const target = get('target') || 'all'
  const model = get('model') || 'linear'
  const source = get('source') || 'rules'
  if (target !== 'all' && !TARGETS[target]) {
    console.error(
      `[错误] --target 只能是 ${Object.keys(TARGETS).join(' / ')} / all，收到「${target}」`,
    )
    process.exit(1)
  }
  if (!['linear', 'logistic'].includes(model)) {
    console.error('[错误] --model 只能是 linear / logistic')
    process.exit(1)
  }
  if (!SCOPES[source]) {
    console.error(
      `[错误] --source 只能是 ${Object.keys(SCOPES).join(' / ')}，收到「${source}」（rules＝feedback_events 三维，item＝item_feedback 两维）`,
    )
    process.exit(1)
  }
  const scope = SCOPES[source]
  const { DB_PATH } = require('../db/paths')
  const fs = require('fs')
  if (!fs.existsSync(DB_PATH)) {
    console.error('[错误] 库文件不存在：' + DB_PATH)
    process.exit(1)
  }
  // 只读句柄：这个脚本连"手滑写一下"的物理能力都不给自己留
  const db = new Database(DB_PATH, { readonly: true })
  let rows
  try {
    rows = db.prepare(scope.read_sql).all()
  } catch (err) {
    // 老库还没补列（aesthetic_score / rank_snapshot 不存在）或新表还没建时，SQL 直接报错而不是回空
    console.error(
      `[错误] 读 ${scope.table} 失败，多半是补列／建表迁移没跑：` +
        err.message +
        (source === 'item'
          ? '\n提示：--source=item 要的是 10-21 第九阶段新建的 item_feedback 表；本机开发库若没跑迁移就会在这里报错。'
          : ''),
    )
    process.exit(1)
  } finally {
    db.close()
  }
  const minSamples = Number(get('min-samples')) > 0 ? Number(get('min-samples')) : scope.min_samples
  printReport(analyzeAll(rows, { target, model, minSamples, source }), args.includes('--json'))
}

if (require.main === module) main()

module.exports = {
  DIM_KEYS,
  CURRENT_WEIGHTS,
  MIN_SAMPLES,
  MIN_SAMPLES_ITEM,
  SCOPES,
  TARGETS,
  collectSamples,
  projectOntoSimplex,
  fitWeights,
  hasVariance,
  analyze,
  analyzeAll,
}
