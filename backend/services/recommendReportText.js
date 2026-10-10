/**
 * 文字版推荐报告（"LLM 降级版"的结构化文案）
 * ============================================================
 * 从 routes/recommend.js 原样搬出来（10-09）：这个函数是纯函数，只吃 recommendation，
 * 而挂在路由里没法离线断言——require 路由会连库、起 WAL/扫描定时器，测试里不能碰。
 * 搬动只改归属，不改任何输出字节；段序（合身→修形→颜色）的验收在 test/recommendReportText.test.js。
 */
const { ACTION_LABELS } = require('./ruleExplainer')
const { AXIS_CN } = require('./topFitBody')

/**
 * 生成结构化推荐文案（LLM 降级版）
 */
function generateStructuredText(recommendation, weather, mode) {
  const lines = []

  // 标题
  if (mode === 'personal') {
    lines.push('# 个人专属穿搭推荐报告\n')
  } else {
    lines.push('# 门店穿搭推荐报告\n')
  }

  // 天气信息
  if (weather && weather.temp != null) {
    lines.push(`## 今日天气\n`)
    lines.push(`气温 ${weather.temp}°C，${weather.description || '天气良好'}。\n`)
  }

  // 各类别建议(引擎返回的顶层键是中文类别名,动作键是 action_type)
  // color_fit / body_fit / evidence_level 是"关于这条推荐的元数据",不是动作,不能当结论打印
  const META_KEYS = [
    'group_id',
    'group_name',
    'priority',
    'score',
    'feedback',
    'explanation',
    'color_fit',
    'body_fit',
    'evidence_level',
  ]
  const categoryTitles = ['穿搭', '妆容', '发型', '配饰', '姿势']
  for (const cat of categoryTitles) {
    const items = recommendation[cat] || []
    if (items.length === 0) continue
    lines.push(`## ${cat}建议\n`)
    for (const item of items.slice(0, 3)) {
      lines.push(`### ${item.group_name || '推荐方案'}\n`)
      for (const [key, val] of Object.entries(item)) {
        if (META_KEYS.includes(key) || !val) continue
        lines.push(`- **${ACTION_LABELS[key] || key}**: ${val}`)
      }
      if (item.color_fit) {
        const f = item.color_fit
        lines.push(
          `- **上衣贴合度**: ${f.score}/100(与肤色差 ΔE00 ${f.deltaE00}、色相角差 ${f.dHue}°、明度差 ${f.dL})`,
        )
      }
      if (item.body_fit) {
        const b = item.body_fit
        const detail = b.axes
          .map((a) => `${a.name_cn} ${Math.round(a.score * 100)}`)
          .join(' / ')
        const skipped = b.axes_missing.length
          ? `；未计入:${b.axes_missing.map((k) => AXIS_CN[k] || k).join('、')}(缺测或没认出来)`
          : ''
        lines.push(`- **上衣身材适配度**: ${b.score}/100(${detail})${skipped}`)
      }
      lines.push('')
    }
  }

  // 上衣处方（与衣橱、购物建议无关，只按身材+肤色出规格）
  // 三层固定顺序：第 0 层合身 → 第 1 层修形 → 第 2 层颜色；两段结论可以相反，不合并（docs/依据/09 §0）
  const spec = recommendation.top_spec
  if (spec) {
    lines.push('## 上衣该怎么选(只按身材与肤色,不读衣橱)\n')

    const fit = spec.fit
    lines.push(`### 第 0 层 · 合身(尺寸)\n`)
    if (fit.present) {
      lines.push(`- **号型**: ${fit.size_label}${fit.size_scope === 'near' ? `（${fit.size_scope_note}）` : ''}`)
      lines.push(
        `  - 号=身高就近 5cm 一档、型=净胸围就近 4cm 一档、体型按胸腰差分 Y/A/B/C${
          fit.drop_cm ? `（你的胸腰差 ${fit.drop_cm}cm${fit.size.体型档 ? `，落在 ${fit.size.体型中文} ${fit.size.体型档.join('~')}cm 档` : ''}）` : ''
        }`,
      )
      if (fit.drop_reason) lines.push(`  - 体型位没出的原因: ${fit.drop_reason}`)
      if (fit.bmi_band)
        lines.push(
          `  - 胖瘦程度(另一条轴, 不推翻上面的体型代号): BMI ${fit.bmi} ⇒ ${fit.bmi_band.cn}〔GB/T 31901-2024 附录 A 表 A.2: 偏瘦<18.5 / 正常 18.5~24 / 偏胖≥24; ⚠ 该版 2026-12-01 才实施, 现在只当内部口径〕`,
        )
      if (fit.target_finished_bust)
        lines.push(
          `- **成衣胸围该到**: ${fit.target_finished_bust.join('~')}cm(松量窗口 ${fit.ease_window_cm.join('~')}cm)`,
        )
      for (const c of fit.checks) {
        const t = c.target
          ? Object.entries(c.target)
              .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join('~') : v}`)
              .join('、')
          : null
        lines.push(`- **${c.name_cn}**〔${c.verdict}〕: ${t || c.why}`)
        if (t) lines.push(`  - ${c.why}`)
        if (c.missing_input) lines.push(`  - 要判还缺: ${c.missing_input}`)
        lines.push(`  - 档位: ${c.tier}`)
      }
      lines.push(
        `  - 号型只管尺寸分档，不含好不好看的判据；测量口径依据 GB/T 16160-2017（腰围取腰际线）与 GB/T 5703-2023 §6.2.7（肩宽取两肩峰点直线距离，家用软尺只能当参考值），分档值与常用档系表列已对本机 GB/T 1335.1／1335.2-2008 的 PDF 逐字核对`,
      )
    } else {
      lines.push(`- **这一层判不了，先量身体**:`)
      for (const b of fit.blocking) lines.push(`  - ${b}`)
      lines.push(`- **怎么量**(GB/T 16160-2017 的口径，只讲方法、不讲多少算好看):`)
      for (const g of fit.measure_guide) lines.push(`  - ${g}`)
      lines.push(`- ${fit.note}`)
    }
    lines.push('')

    lines.push(`### 第 1 层 · 修形(显不显瘦那一类)\n`)
    for (const a of spec.axes) {
      const dir =
        a.side === 'window' ? '' : a.side === 0 ? '(不推拉)' : a.side > 0 ? '(想加)' : '(想收)'
      lines.push(`- **${a.name_cn}**${dir}: ${a.label}`)
      if (a.prefer.length) lines.push(`  - 要选: ${a.prefer.join('；')}`)
      if (a.avoid.length) lines.push(`  - 要避: ${a.avoid.join('；')}`)
      if (a.based_on) lines.push(`  - 算它用的实测数: ${a.based_on}`)
      lines.push(`  - 档位: ${a.tier}`)
    }
    for (const m of spec.missing) {
      lines.push(`- **${m.name_cn}**: 没给建议(${m.reason})`)
    }
    lines.push('')

    lines.push(`### 第 2 层 · 颜色\n`)
    if (spec.colour.present) {
      const c = spec.colour
      lines.push(
        `- **上衣颜色**(肤色口径 ${c.skin_label}${c.anchor_count > 1 ? '，两个口径都算取低分' : ''}): 更分离 ${c.prefer
          .map((p) => `${p.name}(${p.score})`)
          .join('、')}；最不分离 ${c.avoid.map((p) => p.name).join('、')}`,
      )
      lines.push(`  - ${c.note}`)
      lines.push(`  - 档位: ${c.tier}`)
    } else {
      lines.push(`- **上衣颜色**: 没给建议(${spec.colour.reason})`)
    }
    lines.push(`\n> ${spec.note}\n`)
  }

  // 算法分析（个人模式）
  const analysis = recommendation.algorithm_analysis
  if (analysis?.sections?.length) {
    lines.push('## 深度分析报告\n')
    if (analysis.metrics?.length) {
      lines.push(`${analysis.metrics.join(' / ')}\n`)
    }
    for (const section of analysis.sections) {
      lines.push(`### ${section.title}\n`)
      for (const advice of section.advices) {
        lines.push(`- ${advice}`)
      }
      lines.push('')
    }
  }

  // 计算字段
  const computed = recommendation._computed
  if (computed) {
    lines.push('## 您的数据概览\n')
    if (computed.bmi) lines.push(`- BMI: ${computed.bmi}（${computed.bmi_level || '正常'}）`)
    if (computed.body_shape) lines.push(`- 体型: ${computed.body_shape}`)
    if (computed.wh_ratio)
      lines.push(`- 腰臀比: ${computed.wh_ratio}（${computed.wh_status || '正常'}）`)
    lines.push('')
  }

  lines.push('---')
  lines.push('*以上推荐基于您的个人数据生成，仅供参考。*')

  return lines.join('\n')
}

module.exports = { generateStructuredText }
