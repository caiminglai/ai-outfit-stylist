/**
 * 可解释穿搭评估（2026-11 借鉴邂逅时尚"逐维度指出哪里不合适"）。
 * 从 color_fit 与 body_fit 的子分里拆出逐维度的冲突程度 + 改进建议。
 * ⛔ 不重新算分，只读取已有子分做归因——同一件事不许两层各算一遍。
 */

/** 冲突等级阈值（C 档手拍） */
const LEVELS = {
  good: { min: 70, label: '贴合', tone: 'good' },
  medium: { min: 40, label: '中等', tone: 'medium' },
  conflict: { min: 0, label: '冲突', tone: 'conflict' },
}

function levelOf(score) {
  if (score == null) return null
  if (score >= LEVELS.good.min) return LEVELS.good
  if (score >= LEVELS.medium.min) return LEVELS.medium
  return LEVELS.conflict
}

/**
 * 色彩维度拆解。
 * color_fit 已有的子分：contrast_score（对比侧）、harmony_score（整身呼应）、
 *   fusion_gate（融合闸门，<0.5=糊成一片）、dHue（色相差）、dL（明度差）、chromaMatch（彩度匹配）。
 */
function colorConflicts(cf) {
  if (!cf || cf.score == null) return []
  const items = []

  // 1. 对比侧总分（色相差+明度差+彩度匹配的加权）
  const cs = cf.contrast_score
  if (cs != null) {
    const lvl = levelOf(cs)
    let suggestion = null
    if (lvl.tone === 'conflict') {
      if (cf.dHue != null && cf.dHue < 20) suggestion = '上衣与肤色色相差太小，建议换对比更强的色相'
      else if (cf.dL != null && cf.dL < 5) suggestion = '上衣明度与肤色太接近，建议加深或提亮'
      else suggestion = '上衣与肤色对比度不足，建议拉开色差'
    } else if (lvl.tone === 'medium') {
      suggestion = '对比度中等，可尝试更鲜明的配色'
    }
    items.push({
      dimension: '肤色对比',
      score: cs,
      level: lvl.tone,
      suggestion,
      detail: cf.dHue != null ? `色相差 ${Math.round(cf.dHue)}°` : null,
    })
  }

  // 2. 整身呼应（多件衣服之间的色彩和谐）
  const hs = cf.harmony_score
  if (hs != null) {
    const lvl = levelOf(hs)
    items.push({
      dimension: '整身呼应',
      score: hs,
      level: lvl.tone,
      suggestion:
        lvl.tone === 'conflict'
          ? '各件衣服色彩不协调，建议统一色系或加过渡色'
          : lvl.tone === 'medium'
            ? '呼应度一般，可加入同色系配饰增强协调'
            : null,
    })
  }

  // 3. 融合闸门（衣服和脸色差太小，糊成一片）
  if (cf.fusion_gate != null && cf.fusion_gate < 0.5) {
    items.push({
      dimension: '肤色融合',
      score: Math.round(cf.fusion_gate * 100),
      level: 'conflict',
      suggestion: '上衣色与肤色过于接近，容易显没气色，建议换色差更大的颜色',
    })
  }

  return items
}

/**
 * 廓形维度拆解。
 * body_fit 已有的 per-axis: ease（松量）、shoulder、waist、length、volume、pattern。
 * 每个轴有 score 和 notes。
 */
function bodyConflicts(bf) {
  if (!bf || !bf.axes) return []
  const items = []
  for (const axis of bf.axes) {
    if (axis.score == null) continue
    // 廓形轴分是 0~1（1=完美贴合），归一到 0~100 与色彩分同口径
    const score = axis.score <= 1 ? Math.round(axis.score * 1000) / 10 : axis.score
    const lvl = levelOf(score)
    if (lvl.tone === 'good') continue // 贴合的不展示冲突
    // 按轴生成建议
    let suggestion = null
    if (lvl.tone === 'conflict') {
      if (axis.key === 'ease') suggestion = '松量不合适，建议调整版型或尺码'
      else if (axis.key === 'shoulder') suggestion = '肩宽不合适，建议调整肩线'
      else if (axis.key === 'waist') suggestion = '腰线位置不合适，建议调整'
      else if (axis.key === 'length') suggestion = '衣长不合适，建议调整长度'
      else if (axis.key === 'volume') suggestion = '廓形量感不合适'
      else if (axis.key === 'pattern') suggestion = '图案比例不合适'
      else suggestion = `${axis.name_cn}不合适，建议调整`
    } else if (lvl.tone === 'medium') {
      suggestion = `${axis.name_cn}中等，可微调`
    }
    items.push({
      dimension: axis.name_cn || axis.key,
      score,
      level: lvl.tone,
      suggestion,
    })
  }
  return items
}

/**
 * 综合冲突拆解：色彩 + 廓形。
 * @param {{color_fit:object, body_fit:object}} rec 推荐条目
 * @returns {Array<{dimension:string, score:number, level:string, suggestion:string|null}>}
 *          按冲突程度降序（冲突在前）
 */
function buildBreakdown(rec) {
  const items = [...colorConflicts(rec.color_fit), ...bodyConflicts(rec.body_fit)]
  const order = { conflict: 0, medium: 1, good: 2 }
  return items.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9))
}

module.exports = { buildBreakdown, levelOf }
