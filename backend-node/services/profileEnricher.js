/**
 * 用户档案 enricher（算法计算层）
 *
 * 从 Python profile_enricher.py 翻译：
 *   - BMI 计算与分级
 *   - 体型自动分类（沙漏/梨形/苹果/直筒/倒三角）
 *   - 腰臀比、腿身比、肩宽比分析
 *   - 肤色-色系匹配
 *   - 脸型-发型/妆容/配饰映射
 *   - 体态问题-穿搭映射
 */

// 简易内存缓存（避免重复计算相同 profile）
const _enrichCache = new Map()
const _CACHE_MAX = 200

/**
 * 将 profile 转为可哈希的缓存键
 * @param {object} profile
 * @returns {string}
 */
function _cacheKey(profile) {
  return JSON.stringify(profile)
}

/**
 * 安全转 number，失败返回 default
 * @param {*} val
 * @param {number} defaultVal
 * @returns {number}
 */
function _safeFloat(val, defaultVal = 0.0) {
  if (val === null || val === undefined) return defaultVal
  const num = Number(val)
  return isNaN(num) ? defaultVal : num
}

// ============================================================
// 1. BMI
// ============================================================

/**
 * 计算 BMI 及等级
 * @param {number} heightCm
 * @param {number} weightKg
 * @returns {{bmi: number, bmi_level: string, bmi_status: string}}
 */
function computeBmi(heightCm, weightKg) {
  const h = _safeFloat(heightCm) / 100
  const w = _safeFloat(weightKg)
  if (h <= 0 || w <= 0) {
    return { bmi: 22.0, bmi_level: '正常', bmi_status: 'good' }
  }
  const bmi = w / (h * h)
  if (bmi < 18.5) {
    return { bmi: Math.round(bmi * 10) / 10, bmi_level: '偏瘦', bmi_status: 'warning' }
  }
  if (bmi < 24) {
    return { bmi: Math.round(bmi * 10) / 10, bmi_level: '正常', bmi_status: 'good' }
  }
  if (bmi < 28) {
    return { bmi: Math.round(bmi * 10) / 10, bmi_level: '偏胖', bmi_status: 'warning' }
  }
  return { bmi: Math.round(bmi * 10) / 10, bmi_level: '肥胖', bmi_status: 'danger' }
}

// ============================================================
// 2. 体型分类（胸腰差 vs 臀腰差）
// ============================================================

/**
 * 根据胸围-腰围-臀围-肩宽自动判断体型
 * @param {number} bust
 * @param {number} waist
 * @param {number} hip
 * @param {number} shoulder
 * @returns {{body_shape: string, body_shape_key: string, body_shape_status: string}}
 */
function computeBodyShape(bust, waist, hip, shoulder) {
  const b = _safeFloat(bust, 84)
  const w = _safeFloat(waist, 66)
  const h = _safeFloat(hip, 90)
  const s = _safeFloat(shoulder, 38)

  const bwDiff = b - w
  const whDiff = h - w

  if (Math.abs(bwDiff - whDiff) < 5 && bwDiff > 10) {
    return { body_shape: '沙漏型', body_shape_key: 'hourglass', body_shape_status: 'good' }
  }
  if (whDiff > bwDiff + 5) {
    return { body_shape: '梨形', body_shape_key: 'pear', body_shape_status: 'normal' }
  }
  if (bwDiff > whDiff + 5) {
    if (s > h * 0.45) {
      return {
        body_shape: '倒三角型',
        body_shape_key: 'inverted_triangle',
        body_shape_status: 'normal',
      }
    }
    return { body_shape: '苹果型', body_shape_key: 'apple', body_shape_status: 'warning' }
  }
  return { body_shape: '直筒型', body_shape_key: 'rectangle', body_shape_status: 'normal' }
}

// ============================================================
// 3. 腰臀比
// ============================================================

/**
 * @param {number} waist
 * @param {number} hip
 * @returns {{wh_ratio: number, wh_status: string}}
 */
function computeWhRatio(waist, hip) {
  const w = _safeFloat(waist, 66)
  const h = _safeFloat(hip, 90)
  if (h <= 0) {
    return { wh_ratio: 0.73, wh_status: 'good' }
  }
  const ratio = w / h
  if (ratio < 0.7) {
    return { wh_ratio: Math.round(ratio * 100) / 100, wh_status: 'good' }
  }
  if (ratio < 0.85) {
    return { wh_ratio: Math.round(ratio * 100) / 100, wh_status: 'normal' }
  }
  return { wh_ratio: Math.round(ratio * 100) / 100, wh_status: 'warning' }
}

// ============================================================
// 4. 腿身比 & 肩宽比
// ============================================================

/**
 * @param {number} legLength
 * @param {number} height
 * @returns {{leg_ratio: number, leg_status: string}}
 */
function computeLegRatio(legLength, height) {
  const l = _safeFloat(legLength, 88)
  const h = _safeFloat(height, 162)
  if (h <= 0) {
    return { leg_ratio: 0.54, leg_status: 'normal' }
  }
  const ratio = l / h
  if (ratio < 0.53) {
    return { leg_ratio: Math.round(ratio * 100) / 100, leg_status: 'short' }
  }
  if (ratio > 0.58) {
    return { leg_ratio: Math.round(ratio * 100) / 100, leg_status: 'long' }
  }
  return { leg_ratio: Math.round(ratio * 100) / 100, leg_status: 'normal' }
}

/**
 * @param {number} shoulder
 * @param {number} height
 * @returns {{shoulder_ratio: number, shoulder_status: string}}
 */
function computeShoulderRatio(shoulder, height) {
  const s = _safeFloat(shoulder, 38)
  const h = _safeFloat(height, 162)
  if (h <= 0) {
    return { shoulder_ratio: 23.5, shoulder_status: 'normal' }
  }
  const ratio = (s / h) * 100
  if (ratio > 24) {
    return { shoulder_ratio: Math.round(ratio * 10) / 10, shoulder_status: 'wide' }
  }
  if (ratio < 21) {
    return { shoulder_ratio: Math.round(ratio * 10) / 10, shoulder_status: 'narrow' }
  }
  return { shoulder_ratio: Math.round(ratio * 10) / 10, shoulder_status: 'normal' }
}

// ============================================================
// 5. 肤色-色系匹配
// ============================================================

const SKIN_TONE_COLOR_MAP = {
  白皙: {
    colors: '宝蓝、酒红、墨绿、樱花粉、薰衣草紫',
    avoid: '避免过于暗沉的灰褐色',
    reason: '白皙肤色能驾驭大部分高饱和色，冷色系尤其出彩',
  },
  自然白: {
    colors: '莫兰迪色系、大地色、雾霾蓝、豆沙粉',
    avoid: '避免过黄或过于鲜艳的橘色',
    reason: '自然白适合中等饱和度的柔和色系',
  },
  偏黄: {
    colors: '藏蓝、灰粉、薄荷绿、酒红、白色',
    avoid: '避免橘色、土黄、卡其色',
    reason: '冷色调能中和黄色调，提亮整体气色',
  },
  小麦色: {
    colors: '亮白、鹅黄、珊瑚色、宝蓝、橙色',
    avoid: '避免暗沉的褐色、深灰色',
    reason: '高饱和色能展现小麦色的健康活力',
  },
  古铜色: {
    colors: '白色、亮红、翠绿、金色、橙色',
    avoid: '避免暗沉色调',
    reason: '强对比色能突出古铜色的性感光泽',
  },
}

/**
 * 根据肤色返回适合/避免的颜色建议
 * @param {string} skinTone
 * @returns {{color_match: string, color_avoid: string, color_reason: string}}
 */
function computeColorMatch(skinTone) {
  const guide = SKIN_TONE_COLOR_MAP[skinTone] || SKIN_TONE_COLOR_MAP['自然白']
  return {
    color_match: guide.colors,
    color_avoid: guide.avoid,
    color_reason: guide.reason,
  }
}

// ============================================================
// 6. 体型-穿搭映射（文本建议）
// ============================================================

const BODY_SHAPE_OUTFIT = {
  hourglass: '收腰连衣裙、高腰阔腿裤+紧身针织衫，展现曲线美。',
  pear: '上身浅色亮色吸引视线上移，下身深色直筒/A字裙平衡比例。',
  apple: 'V领宽松上衣+直筒裤/裙，长度盖过臀部，避免收腰款。',
  rectangle: '荷叶边上衣、层叠穿搭、宽腰带营造腰线，直筒裙+短上衣。',
  inverted_triangle: '下身A字裙/阔腿裤增加量感，上身V领/方领收窄肩线。',
}

/**
 * @param {string} bodyShapeKey
 * @returns {string}
 */
function getBodyShapeOutfitAdvice(bodyShapeKey) {
  return BODY_SHAPE_OUTFIT[bodyShapeKey] || BODY_SHAPE_OUTFIT['hourglass']
}

// ============================================================
// 7. 脸型-发型/妆容/配饰映射
// ============================================================

const FACE_SHAPE_GUIDE = {
  鹅蛋脸: {
    analysis: '最标准脸型，比例协调，几乎适合所有发型和妆容。',
    hair: '中分长发、空气刘海、波浪卷发',
    makeup: '自然妆即可，重点突出五官优势',
    contour: '修容较轻，鼻梁两侧和发际线微扫即可',
    accessory: '几乎所有款式都适合',
  },
  圆脸: {
    analysis: '线条柔和缺乏棱角，需要增加面部立体感。',
    hair: '侧分长发、高马尾拉长脸型，避免齐刘海和短发波波头',
    makeup: '修容重点在两侧脸颊，高光提亮鼻梁和额头',
    contour: '两侧脸颊大面积阴影，太阳穴到下颌线连接扫阴影',
    accessory: '长款流苏耳坠纵向拉长，棱角分明的方形眼镜',
  },
  方脸: {
    analysis: '下颌角明显轮廓硬朗，需要柔化面部线条。',
    hair: '微卷长发、八字刘海修饰下颌，避免齐耳短发和中分',
    makeup: '修容重点在下颌角，腮红打在颧骨偏上位置',
    contour: '下颌角阴影柔化，额头两侧收窄',
    accessory: '圆润珍珠坠子耳环柔化下颌，圆框眼镜',
  },
  瓜子脸: {
    analysis: '上宽下窄下巴尖翘，很好看但额头不宜过亮。',
    hair: '空气刘海、中长发，避免过度贴头皮',
    makeup: '额头不宜过亮，下巴可用阴影稍微收敛',
    contour: '下巴阴影微收，额头高光提亮',
    accessory: '小巧精致耳钉，避免过长耳坠',
  },
  菱形脸: {
    analysis: '颧骨突出，额头和下巴偏窄，需平衡中部宽度。',
    hair: '齐刘海或侧分刘海遮盖额头，搭配蓬松长发平衡颧骨',
    makeup: '颧骨两侧用阴影色收敛，额头和下巴用高光提亮',
    contour: '颧骨两侧阴影收敛，额头和下巴高光',
    accessory: '长侧分刘海造型，上部有装饰的发饰',
  },
  心形脸: {
    analysis: '额头宽下巴尖，上重下轻，需要平衡上下比例。',
    hair: '侧分中长发，下摆微卷增加下半脸量感',
    makeup: '额头两侧阴影收敛，下巴高光提亮增加量感',
    contour: '额头两侧阴影，下巴高光提亮',
    accessory: '一字领横向拉宽额头，圆润耳环平衡下巴',
  },
  国字脸: {
    analysis: '轮廓方正硬朗，需大面积柔化线条。',
    hair: '大波浪卷发、长刘海，避免短发和露额发型',
    makeup: '大面积修容柔化下颌线和颧骨，柔和腮红增加女性化气质',
    contour: '全脸大面积修容柔化轮廓，重点在下颌',
    accessory: '圆润大圈耳环柔化硬朗感，波浪形项链',
  },
}

/**
 * 返回脸型对应的发型/妆容/修容/配饰建议
 * @param {string} faceShape
 * @returns {{face_analysis: string, hair_advice: string, makeup_advice: string, contour_advice: string, accessory_advice: string}}
 */
function getFaceShapeGuide(faceShape) {
  const guide = FACE_SHAPE_GUIDE[faceShape] || FACE_SHAPE_GUIDE['鹅蛋脸']
  return {
    face_analysis: guide.analysis,
    hair_advice: guide.hair,
    makeup_advice: guide.makeup,
    contour_advice: guide.contour,
    accessory_advice: guide.accessory,
  }
}

// ============================================================
// 8. 体态问题-穿搭映射
// ============================================================

const POSTURE_ADVICE = {
  圆肩: '多做扩胸运动，穿搭选择背部有支撑的上衣，避免圆领紧身款。',
  驼背: '靠墙站立练习，选择有领设计的上衣引导视线上移。',
  骨盆前倾: '加强核心训练，避免长期穿高跟鞋，选择平底鞋为主。',
  高低肩: '检查背包习惯，穿搭选择对称领口，避免单肩设计。',
}

/**
 * @param {string|null} posture
 * @returns {string|null}
 */
function getPostureAdvice(posture) {
  if (!posture || posture === '无') return null
  return POSTURE_ADVICE[posture] || null
}

// ============================================================
// 8.5. 前端 occasion → 规则引擎 scenario 值映射
// ============================================================

const OCCASION_TO_SCENARIO = {
  上班通勤: '通勤',
  约会聚会: '约会',
  校园日常: '校园日常',
  居家休闲: '居家休闲',
  商务正式: '商务正式',
  运动健身: '运动健身',
  婚礼宴会: '婚礼宴会',
}

// ============================================================
// 9. 主入口：enrichProfile
// ============================================================

/**
 * 对原始 profile 进行算法 enrich，增加计算字段
 * @param {object} profile - 顾客填写的原始数据
 * @returns {object} 原始数据 + 新增计算字段
 */
function enrichProfile(profile) {
  // 检查缓存
  const key = _cacheKey(profile)
  if (_enrichCache.has(key)) {
    return { ..._enrichCache.get(key) }
  }

  const p = { ...profile }

  // 0. 字段映射：将前端字段名映射到规则引擎条件字段名
  if (!p.body_type && p.body_type_detail) {
    p.body_type = p.body_type_detail
  }
  if (!p.skin_tone && p.skin_tone_detail) {
    p.skin_tone = p.skin_tone_detail
  }
  if (!p.scenario && p.occasion) {
    p.scenario = OCCASION_TO_SCENARIO[p.occasion] || p.occasion
  }
  if (!p.nose_bridge && p.nose_height) {
    p.nose_bridge = p.nose_height
  }

  const { height, weight, bust, waist, hip, shoulder, leg_length, skin_tone, face_shape, posture } =
    p

  // 1. BMI
  if (height && weight) {
    Object.assign(p, computeBmi(height, weight))
  }

  // 2. 体型（若已手动填写则保留，否则自动计算）
  if (bust && waist && hip) {
    const computed = computeBodyShape(bust, waist, hip, shoulder || 38)
    if (!p.body_type) {
      p.body_type = computed.body_shape
    }
    Object.assign(p, computed)
  }

  // 3. 腰臀比
  if (waist && hip) {
    Object.assign(p, computeWhRatio(waist, hip))
  }

  // 4. 腿身比
  if (leg_length && height) {
    Object.assign(p, computeLegRatio(leg_length, height))
  }

  // 5. 肩宽比
  if (shoulder && height) {
    Object.assign(p, computeShoulderRatio(shoulder, height))
  }

  // 6. 肤色-色系
  if (skin_tone) {
    // 兼容旧版暖皮/冷皮 -> 映射到新版
    if (['暖皮', '冷皮', '中性'].includes(skin_tone)) {
      Object.assign(p, computeColorMatch('自然白'))
    } else {
      Object.assign(p, computeColorMatch(skin_tone))
    }
  }

  // 7. 脸型-全维度建议
  if (face_shape) {
    Object.assign(p, getFaceShapeGuide(face_shape))
  }

  // 8. 体态建议
  const postureText = getPostureAdvice(posture)
  if (postureText) {
    p.posture_advice = postureText
  }

  // 写入缓存
  if (_enrichCache.size >= _CACHE_MAX) {
    // 删除最早的条目
    const firstKey = _enrichCache.keys().next().value
    _enrichCache.delete(firstKey)
  }
  _enrichCache.set(key, { ...p })

  return p
}

module.exports = {
  enrichProfile,
  computeBmi,
  computeBodyShape,
  computeWhRatio,
  computeLegRatio,
  computeShoulderRatio,
  computeColorMatch,
  getBodyShapeOutfitAdvice,
  getFaceShapeGuide,
  getPostureAdvice,
  OCCASION_TO_SCENARIO,
  SKIN_TONE_COLOR_MAP,
}
