// 11-03 大文件拆分轮：这一段从 services/recommendEngine.js 逐字搬来（旧版硬编码推荐）。
// 函数体与口径注释一处未改；⛔ 对外出口仍只走 recommendEngine.js 那份再导出。

const { asText, ownValue } = require('../../utils/common')

/**
 * 获取穿搭推荐
 * @param {string|null} skinTone - 肤色
 * @param {string|null} faceShape - 脸型
 * @param {string} scenario - 场景
 * @returns {Array} 推荐结果列表
 */
function getRecommendations(skinTone, faceShape, scenario) {
  const defaults = {
    通勤: [
      {
        top_style: '白色衬衫',
        bottom_style: '深色西裤',
        color_combo: '白+蓝',
        reason: '简洁干练,职场必备',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '针织开衫',
        bottom_style: '直筒裤',
        color_combo: '米+灰',
        reason: '温柔知性,通勤百搭',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '西装外套',
        bottom_style: '铅笔裙',
        color_combo: '黑+灰',
        reason: '专业大气,会议首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    约会: [
      {
        top_style: 'V领碎花裙',
        bottom_style: '',
        color_combo: '浅粉+白',
        reason: '甜美浪漫,约会首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '修身针织衫',
        bottom_style: 'A字裙',
        color_combo: '白+杏',
        reason: '优雅温柔,展现气质',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    面试: [
      {
        top_style: '翻领大衣',
        bottom_style: '西裤',
        color_combo: '灰+黑',
        reason: '专业稳重,面试首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '衬衫',
        bottom_style: '直筒裙',
        color_combo: '白+深蓝',
        reason: '简洁大方,给人信赖感',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    休闲: [
      {
        top_style: '圆领T恤',
        bottom_style: '牛仔裤',
        color_combo: '白+蓝',
        reason: '舒适百搭,日常首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '卫衣',
        bottom_style: '运动裤',
        color_combo: '灰+黑',
        reason: '休闲舒适,轻松自在',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
    聚会: [
      {
        top_style: '亮片上衣',
        bottom_style: '高腰裙',
        color_combo: '金+黑',
        reason: '闪耀吸睛,聚会焦点',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
      {
        top_style: '修身连衣裙',
        bottom_style: '',
        color_combo: '酒红+黑',
        reason: '优雅大气,派对首选',
        match_level: '默认',
        skin_tone: skinTone || '通用',
        face_shape: faceShape || '通用',
        scenario,
      },
    ],
  }

  // scenario 来自请求体（buildRecommendation 里是 profile.scenario），
  // 写 defaults[scenario] 时 scenario='constructor' 会拿到 Object 构造函数，
  // 调用方 `for (const item of fallback)` 立刻 TypeError ⇒ 推荐接口回 500。
  const fallbackList = ownValue(defaults, asText(scenario)) || ownValue(defaults, '休闲')
  return fallbackList
}

module.exports = {
  getRecommendations,
}
