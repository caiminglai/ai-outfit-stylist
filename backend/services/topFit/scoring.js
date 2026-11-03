// 11-03 大文件拆分轮：这一段从 services/topFitBody.js 逐字搬来（4 打分（原 topFitBody.js 第 4 节））。
// 函数体、注释、值表一处未改；⛔ 对外出口仍只走 topFitBody.js 那份再导出。

const {
  clamp01,
  r2,
  BODY_REF,
  AXIS_WEIGHTS,
  COVERAGE_PENALTY,
  AXIS_CN,
  AXIS_TIER,
} = require('./refs')
const { bodyDeviation } = require('./deviation')
const { describeTop } = require('./shape')

// ------------------------------------------------------------
// 4. 打分：偏差向量 × 修形向量
// ------------------------------------------------------------

/** 同向=1、反向=0（抵消取均值不取乘积，免得某一维把总分打死 —— 08 §8 硬规矩 1） */
const align = (want, given) => r2(1 - Math.abs(want - given) / 2)

/** 松量：落在窗口内不扣分，越出窗口按每 6cm 掉到 0 */
function easeScore(window, ease) {
  if (!window || ease == null) return null
  const [lo, hi] = window
  const d = ease < lo ? lo - ease : ease > hi ? ease - hi : 0
  return r2(1 - clamp01(d / 6))
}

/**
 * 一件上衣对一个人的身材适配分。
 * @param {object} person 档案（含 height/weight/shoulder/bust/waist/hip/leg_length 中有的那些）
 * @param {object} top **衣柜里的一行**（要带 shoulder_cm/bust_cm/length_cm/waistband_cm 里的某几个）；
 *        传规则结论那句自由文本或 null ⇒ 四格实测都取不到 ⇒ 这一件不打分，返回 null
 * @param {object} [dev] 预先算好的偏差向量（批量排序时传进来，避免重复计算）
 * @returns {null|{score:number, axes:Array, axes_present:string[], axes_missing:string[],
 *                  measured:string[], missing_measure:string[], coverage:number,
 *                  person:object, top:object, evidence:string}}
 *          一维都凑不齐 ⇒ null（缺测不出分，不返回 0 分这种"看起来像判过"的东西）
 */
function topFitBody(person, top, dev) {
  const d = dev || bodyDeviation(person)
  const g = describeTop(top, d)
  const axes = []

  const add = (key, personVal, garmentVal, score, detail) => {
    axes.push({
      key,
      name_cn: AXIS_CN[key],
      score: score == null ? null : r2(score),
      weight: AXIS_WEIGHTS[key],
      person: personVal === undefined ? null : personVal,
      garment: garmentVal === undefined ? null : garmentVal,
      tier: AXIS_TIER[key],
      ...(detail || {}),
    })
  }

  // 每一维都写清"这个数是从哪一格算出来的"——报告与后台要能追到那一格，
  // 追不到的分就是没有依据的分（10-19 第二阶段把这条写进返回值）。
  add(
    'shoulder',
    d.want.shoulder,
    g.shoulder,
    d.want.shoulder != null && g.shoulder != null ? align(d.want.shoulder, g.shoulder) : null,
    {
      based_on:
        g.shoulder_src === 'shoulder_est'
          ? 'shoulder_cm − 净肩宽（净肩宽按身高+体重+年龄估，残差男 ≤5.5%／女 ≤7.0%），按身高换算成肩宽比百分点 ⇒ 覆盖率按半格计'
          : 'shoulder_cm − 净肩宽，按身高换算成肩宽比百分点',
      ...(g.estimated.includes('shoulder') ? { estimated: true } : {}),
    },
  )
  add(
    'waist',
    d.want.waist,
    g.waist,
    d.want.waist != null && g.waist != null ? align(d.want.waist, g.waist) : null,
    { based_on: 'waistband_cm（腰头/收口高度，0 与没填是两件事）' },
  )
  add(
    'length',
    d.want.length,
    g.length,
    d.want.length != null && g.length != null ? align(d.want.length, g.length) : null,
    { based_on: 'length_cm 对照 身高×0.40 的胯线原点（站内自建刻度）' },
  )
  add(
    'volume',
    d.want.volume,
    g.volume,
    d.want.volume != null && g.volume != null ? align(d.want.volume, g.volume) : null,
    { based_on: 'color 的 Lab 明度 + fabric_weight 自填厚薄档' },
  )

  add(
    'ease',
    d.ease_window ? d.ease_window.join('~') + 'cm' : null,
    g.ease,
    easeScore(d.ease_window, g.ease),
    {
      based_on:
        g.ease_src === 'fit_type'
          ? `版型档 ${g.fit_type} 映射的放松量区间中值（没量 bust_cm ⇒ 估的，覆盖率按半格计）`
          : g.ease_src === 'bust_est'
            ? 'bust_cm − 净胸围（净胸围按身高+体重+年龄估，残差 ≤1.93%≈±2cm）⇒ 覆盖率按半格计'
            : 'bust_cm − 净胸围（松量的实测口径）',
      ...(g.estimated.includes('ease') ? { estimated: true } : {}),
    },
  )

  // 条纹：BMI 闸门（Ashida 2013）+ 最低权重；want 为 null（BMI 没算出来）时也直接没有这一维
  const bmi = d.measure.bmi
  const stripeOn = bmi != null && bmi < BODY_REF.stripe_bmi_max
  add(
    'pattern',
    d.want.pattern,
    g.pattern,
    d.want.pattern != null && g.pattern != null && stripeOn
      ? align(d.want.pattern, g.pattern)
      : null,
    {
      based_on: 'pattern 自填值（只认 竖条/竖条纹/横条/横条纹 四个值，不从商品名里找"条"字）',
      ...(stripeOn
        ? {}
        : {
            gated:
              bmi != null
                ? `BMI ${bmi}≥${BODY_REF.stripe_bmi_max} ⇒ 按 Ashida 2013 关掉`
                : 'BMI 没算出来 ⇒ 不启用',
          }),
    },
  )

  const present = axes.filter((a) => a.score != null)
  if (present.length === 0) return null

  const wsum = present.reduce((s, a) => s + a.weight, 0)
  const raw = present.reduce((s, a) => s + a.weight * a.score, 0) / wsum
  // 先在在场轴之间归一（08 §8 硬规矩：缺测的轴不参与，不补 0），再按**实测覆盖率**整体打折。
  // 这一乘是 10-19 第三阶段·模块二补的：光靠在场轴归一，"六轴只量出一根、那根恰好满分"会归一出
  // 100 分 ⇒ 靠少填给高分。惩罚只在身体层乘这一次，排序侧不再拿覆盖率乘第二遍。
  const rawScore = Math.round(100 * raw)
  const penalty = COVERAGE_PENALTY.floor + COVERAGE_PENALTY.span * g.coverage
  const score = Math.round(rawScore * penalty)

  return {
    score,
    raw_score: rawScore,
    coverage_penalty: r2(penalty),
    axes: present,
    axes_present: present.map((a) => a.key),
    axes_missing: axes.filter((a) => a.score == null).map((a) => a.key),
    measured: g.measured,
    missing_measure: g.missing,
    coverage: g.coverage,
    person: { measure: d.measure, want: d.want, ease_window: d.ease_window, notes: d.notes },
    top: g,
    evidence:
      'B 方向(松量×BMI Liu 2006 / 深色收缩 Koutsoumpis 2021 / 肩宽侧更被偏好 Pazhoohi 2023) + C 刻度与权重(手拍,标定中)；' +
      '这一分只量"上衣往哪修、修多少"和这个人的偏差对不对得上，不是"好不好看"的判定',
  }
}

/**
 * 按身材给一摞上衣排序（衣柜里自己的上衣那条链路）。
 * @returns {{person_deviation:object, ranked:Array, unscored:number, unscored_reason:string[]}}
 */
function rankTopsByBody(person, tops) {
  const dev = bodyDeviation(person)
  const ranked = []
  const reasons = []
  for (const t of tops || []) {
    const res = topFitBody(null, t, dev)
    if (!res) {
      const name = t && t.name ? t.name : String(t).slice(0, 12)
      reasons.push(
        `${name}：肩宽/胸围/衣长/腰头高这四格一个都没填、版型那一档也没选（或这个人的净尺寸没量）⇒ 对不出任何一维，不打分`,
      )
      continue
    }
    ranked.push({
      item: t,
      label: res.top.label,
      score: res.score,
      coverage: res.coverage,
      measured: res.measured,
      axes: res.axes.map((a) => ({
        key: a.key,
        name_cn: a.name_cn,
        score: a.score,
        person: a.person,
        garment: a.garment,
      })),
      axes_present: res.axes_present,
      axes_missing: res.axes_missing,
    })
  }
  ranked.sort((a, b) => b.score - a.score)
  return { person_deviation: dev, ranked, unscored: reasons.length, unscored_reason: reasons }
}

module.exports = {
  topFitBody,
  rankTopsByBody,
}
