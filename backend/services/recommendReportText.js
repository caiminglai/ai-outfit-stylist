/**
 * 文字版推荐报告（"LLM 降级版"的结构化文案）
 * ============================================================
 * 从 routes/recommend.js 原样搬出来（10-09）：这个函数是纯函数，只吃 recommendation，
 * 而挂在路由里没法离线断言——require 路由会连库、起 WAL/扫描定时器，测试里不能碰。
 * 搬动只改归属，不改任何输出字节；段序（合身→修形→颜色）的验收在 test/recommendReportText.test.js。
 */
const { ACTION_LABELS } = require('./ruleExplainer')
const { ownValue, asNumber } = require('../utils/common')
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
  // 前端 WeatherData 的键是 temperature / feelsLike / condition / humidity，
  // 这里原来读的是 weather.temp 与 weather.description——那两个键在请求体里根本不存在，
  // 所以"今日天气"这一节从写下起就没进过任何一份报告（不是偶发，是恒不触发）。
  const t = asNumber(ownValue(weather, 'temperature'))
  if (t !== null) {
    const feels = asNumber(ownValue(weather, 'feelsLike'))
    const cond = ownValue(weather, 'condition')
    const hum = asNumber(ownValue(weather, 'humidity'))
    lines.push(`## 今日天气\n`)
    lines.push(
      `- 气温 ${t}°C${feels !== null ? `（体感 ${feels}°C）` : ''}，${typeof cond === 'string' && cond ? cond : '天气状况未知'}${hum !== null ? `，湿度 ${hum}%` : ''}。`,
    )
    lines.push('')
  }

  // 各类别建议(引擎返回的顶层键是中文类别名,动作键是 action_type)
  // color_fit / body_fit / evidence_level / rank 是"关于这条推荐的元数据",不是动作,不能当结论打印
  // rank 是 10-19 第二阶段"算法重排"的综合分对象；source / wardrobe_item_id 标明这条是规则给的还是衣柜量出来的
  const META_KEYS = [
    'group_id',
    'group_name',
    'priority',
    'score',
    'feedback',
    'explanation',
    'color_fit',
    'color_harmony',
    'color_harmony_pairs',
    // 这三笔是 10-20 色彩接线的账目字段，已经在"上衣贴合度"那一行按 basis 说清楚了，
    // 不再单独印一行（print 出来是 `- **color_basis**: table-key` 这种英文垃圾行）
    'color_basis',
    'color_parts',
    'color_text',
    // 10-21 第十三阶段·一 §二·3 借色＋§二·4 关系色的五笔出处：同样只在"上衣贴合度"那一行说清楚，
    // ⛔ 不许各印一行英文键（`- **color_borrowed_from**: 白+蓝` 那种）。
    'color_basis_source',
    'color_borrowed',
    'color_borrowed_from',
    'color_borrowed_position',
    'color_relational_from',
    'color_relational',
    'color_top_band',
    // 10-21 第十三阶段·一 §三·4：版型档推断的两件出处（同样只在"身材适配度"那一行说，不单独打英文键）
    'fit_type_inferred',
    'fabric_weight_inferred',
    'body_fit',
    'evidence_level',
    'rank',
    'source',
    'wardrobe_item_id',
  ]
  const categoryTitles = ['穿搭', '妆容', '发型', '配饰', '姿势']
  for (const cat of categoryTitles) {
    // 必须是数组才当列表渲染：这一份 recommendation 是从 /enhance 请求体一路传进来的，
    // 写成字符串 '一二三四五' 时 `items.length` 有值、slice 也切得动，
    // for...of 就逐字循环，Object.entries('一') 打出 `- **0**: 一` 这种垃圾行还回 200；
    // 写成数字 5 时更直接——5 没有 slice ⇒ TypeError ⇒ 整份报告 500。
    const items = recommendation[cat]
    if (!Array.isArray(items) || items.length === 0) continue
    lines.push(`## ${cat}建议\n`)
    for (const item of items.slice(0, 3)) {
      lines.push(`### ${item.group_name || '推荐方案'}\n`)
      for (const [key, val] of Object.entries(item)) {
        if (META_KEYS.includes(key) || !val) continue
        lines.push(`- **${ownValue(ACTION_LABELS, key) || key}**: ${val}`)
      }
      if (item.color_fit) {
        const f = item.color_fit
        // 上衣是黑白灰时色相角是 atan2(0,0) 造出来的假数（判据见 colorMetrics.js 的 ACHROMATIC_C），
        // 打印上要说明这一轴没参与，否则顾客看到一个"色相角差 0°"会以为衣服跟脸同色相
        const hueTxt = f.hue_applies === false ? '上衣属无彩色·色相不计' : `色相角差 ${f.dHue}°`
        const splitTxt =
          f.harmony_score === null || f.harmony_score === undefined
            ? ''
            : `；对比侧 ${f.contrast_score} × 呼应侧 ${f.harmony_score}`
        // 🔴 §二·3 借色的措辞受 `docs/依据/21` §一·1 钉死：⛔ 不许写成"系统识别出你的上衣是驼色"。
        //    只许说"按整套搭配的配色串把某色当上衣色算的（出处＋权重已打折）"。
        //    §二·4 的关系色是另一种出处（上衣那句自己写了"跟哪一格同色"），必须分开说，
        //    ⛔ 不许把"与鞋同色"也写成"按整套搭配的配色串算的"——那句明明点名了鞋。
        const borrowTxt = item.color_borrowed
          ? item.color_relational_from
            ? `；⚠️ 上衣那一格没写自己的颜色，只写了跟「${item.color_relational_from}」同色，所以这一分是按「${item.color_relational_from}」那一格写的「${item.color_borrowed_from || '没记下原句'}」那个色算的（出处是那一格、不是上衣自己写的），权重已打折${item.color_top_band ? `（上衣那句自己只写了「${item.color_top_band}」这一档深浅）` : ''}`
            : `；⚠️ 上衣那一格没写具体颜色，这一分是按整套搭配的配色串「${item.color_borrowed_from || '没记下原串'}」里第 ${item.color_borrowed_position || 1} 个色当上衣色算的，权重已打折${item.color_top_band ? `（那句原文自己只写了「${item.color_top_band}」这一档深浅）` : ''}`
          : ''
        // 10-20 L5 明度档：这一条压根没有 hex，ΔE00/明度差都是 null，直接印出来是
        // 「与肤色差 ΔE00 null、明度差 null」——顾客会以为系统坏了，实际是"这句文案只说了深浅"。
        if (f.basis === 'lightness-band') {
          lines.push(
            `- **上衣贴合度**: ${f.score}/100(${f.top_label}·这句结论只给了亮度档位、没有具体色名，所以只按"衣装越暗脸越显白"这一条方向给分，不测与肤色的色差${borrowTxt})`,
          )
        } else {
          lines.push(
            `- **上衣贴合度**: ${f.score}/100(与肤色差 ΔE00 ${f.deltaE00}、${hueTxt}、明度差 ${f.dL}${splitTxt}${borrowTxt})`,
          )
        }
      }
      // §二·4：这一格只写了"跟谁同色"时，取色出处要印出来（不印=顾客以为系统凭空补了个色）。
      // 措辞口径：说清"这两个字是被指的那一格写的"，⛔ 不许写成"识别出你的下装是藏青"。
      if (item.color_relational) {
        lines.push(
          `- **关系色取色**: 这句里只写了"跟谁同色"、没写自己是什么色，所以色是按被指那一格取的（${item.color_relational}，箭头左边＝这句、右边＝出处色来自那一格）。这一格的颜色不是它自己写的，分数也不为它单独加`,
        )
      }
      if (item.body_fit) {
        const b = item.body_fit
        const detail = b.axes.map((a) => `${a.name_cn} ${Math.round(a.score * 100)}`).join(' / ')
        const skipped = b.axes_missing.length
          ? `；未计入:${b.axes_missing
              .map((k) => ownValue(AXIS_CN, k) || k)
              .join('、')}(缺测或没认出来)`
          : ''
        // 🔴 §三·4 的措辞受 `docs/依据/21` §一·2 钉死：⛔ 不许写成"量化了你的体型"。
        //    这一档是从款式词（直筒／阔腿／泡泡袖…）与面料词（真丝／羊绒…）认出来的，不是软尺量的。
        const inferTxt =
          b.inferred_from === 'rule_text'
            ? `；⚠️ 这一档没量过尺寸，是按这句建议自己的款式词${
                ((b.inferred_words && b.inferred_words.fit) || []).length
                  ? `「${b.inferred_words.fit.join('、')}」`
                  : '（没认出款式词）'
              }${
                ((b.inferred_words && b.inferred_words.fabric) || []).length
                  ? `与面料词「${b.inferred_words.fabric.join('、')}」`
                  : ''
              }认出来的版型档位，松量按那一档的区间中值估 ⇒ 覆盖率只有 ${Math.round((b.coverage || 0) * 100)}%，⛔ 这不是量出来的身材`
            : ''
        lines.push(`- **上衣身材适配度**: ${b.score}/100(${detail})${skipped}${inferTxt}`)
      }
      // 综合排序分（10-19 第二阶段）：名次就是这一行决定的，所以它必须印在报告里，
      // 且把"哪几维在场、各占多少权重、缺测折了几成"一起摊开——只报一个总分等于又变成一个不能追问的数。
      if (item.rank) {
        const rk = item.rank
        const shown = rk.dims.filter((d) => d.score != null && d.weight > 0)
        const parts = shown.map(
          (d) => `${d.name_cn} ${Math.round(d.score)}×${Math.round(d.weight * 100) / 100}`,
        )
        const gone = rk.dims.filter((d) => !(d.score != null && d.weight > 0))
        const skippedRank = gone.length
          ? `；没算:${gone.map((d) => d.name_cn).join('、')}(缺测，权重已退给在场维，不补分)`
          : ''
        lines.push(
          `- **综合排序分**: ${rk.score}/100(${parts.join(' + ')}，实测覆盖折扣 ${rk.coverage}⇒乘 ${rk.factor})${skippedRank}`,
        )
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
      lines.push(
        `- **号型**: ${fit.size_label}${fit.size_scope === 'near' ? `（${fit.size_scope_note}）` : ''}`,
      )
      lines.push(
        `  - 号=身高就近 5cm 一档、型=净胸围就近 4cm 一档、体型按胸腰差分 Y/A/B/C${
          fit.drop_cm != null
            ? `（你的胸腰差 ${fit.drop_cm}cm${fit.size.体型档 ? `，落在 ${fit.size.体型中文} ${fit.size.体型档.join('~')}cm 档` : ''}）`
            : ''
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
      // 方向只在"确实量出来"时才写：原来这条三元是 window / 0 / >0 三档之外的全部情况
      // 都落 '(想收)'，所以 side 缺测（undefined/null）会被印成"想收"，
      // 顾客看到的是一条没量过却带方向的建议。'window' 与非负数走原口径，其余一律不写方向。
      const side = a.side
      const dir =
        side === 'window'
          ? ''
          : typeof side === 'number' && Number.isFinite(side)
            ? side > 0
              ? '(想加)'
              : side < 0
                ? '(想收)'
                : '(不推拉)'
            : ''
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
    // 档位缺失就只写数字：`|| '正常'` 会把"没算出档位"显示成"档位=正常"，
    // 而 wh_status 在缺性别时本来就是不出的（computeWhRatio 只回比值）。
    if (computed.bmi)
      lines.push(`- BMI: ${computed.bmi}${computed.bmi_level ? `（${computed.bmi_level}）` : ''}`)
    if (computed.body_shape) lines.push(`- 体型: ${computed.body_shape}`)
    if (computed.wh_ratio)
      lines.push(
        `- 腰臀比: ${computed.wh_ratio}${computed.wh_status ? `（${computed.wh_status}）` : ''}`,
      )
    lines.push('')
  }

  lines.push('---')
  lines.push('*以上推荐基于您的个人数据生成，仅供参考。*')

  return lines.join('\n')
}

module.exports = { generateStructuredText }
