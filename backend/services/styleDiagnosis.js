/**
 * 风格诊断测试（借鉴邂逅时尚 AI 风格检测）
 * ============================================================
 * 通过一组问卷题，根据用户回答诊断风格类型。不是"AI 检测"，是"问卷辅助判断"——
 * 风格本身是主观偏好，不存在"测出来你是什么风格"的客观结论。
 *
 * ⚠️ 档位诚实：
 *  - 这是**自我认知辅助**，不是科学分类；结果仅供穿搭参考。
 *  - 风格类型是连续谱，不是非此即彼——输出会带各风格的得分，用户可能同时是"优雅+甜美"。
 */

/** 风格类型定义 */
const STYLE_TYPES = {
  elegant: { name: '优雅型', desc: '适合剪裁利落、材质高级的单品，如西装、风衣、真丝衬衫' },
  casual: { name: '休闲型', desc: '适合舒适自在的单品，如卫衣、牛仔裤、运动鞋' },
  avantGarde: { name: '前卫型', desc: '适合设计感强、造型独特的单品，如不对称剪裁、金属色' },
  sweet: { name: '甜美型', desc: '适合柔和粉嫩的单品，如蕾丝、蝴蝶结、浅色系' },
  vintage: { name: '复古型', desc: '适合年代感单品，如格纹、伞裙、复古印花' },
  sporty: { name: '运动型', desc: '适合功能性单品，如运动套装、机能风、速干面料' },
}

/**
 * 诊断题目（每题的选项对应不同风格的加分）
 * 每个选项的 scores 是各风格的加分（0~2）
 */
const DIAGNOSIS_QUESTIONS = [
  {
    id: 'line',
    question: '你更喜欢哪种服装线条？',
    options: [
      { text: '利落直线（西装、衬衫）', scores: { elegant: 2, avantGarde: 1 } },
      { text: '柔和曲线（连衣裙、针织）', scores: { sweet: 2, elegant: 1 } },
      { text: '宽松无束缚（卫衣、阔腿裤）', scores: { casual: 2, sporty: 1 } },
      { text: '复古剪裁（伞裙、收腰）', scores: { vintage: 2, elegant: 1 } },
    ],
  },
  {
    id: 'color',
    question: '你更倾向什么色系？',
    options: [
      { text: '黑白灰/大地色', scores: { elegant: 2, casual: 1 } },
      { text: '鲜艳亮色/撞色', scores: { avantGarde: 2, sporty: 1 } },
      { text: '马卡龙/浅粉浅蓝', scores: { sweet: 2 } },
      { text: '复古色/酒红墨绿', scores: { vintage: 2 } },
    ],
  },
  {
    id: 'occasion',
    question: '你最常穿什么场合的衣服？',
    options: [
      { text: '上班/正式场合', scores: { elegant: 2 } },
      { text: '日常/逛街', scores: { casual: 2, sweet: 1 } },
      { text: '运动/户外', scores: { sporty: 2 } },
      { text: '派对/拍照', scores: { avantGarde: 1, vintage: 1 } },
    ],
  },
  {
    id: 'fabric',
    question: '你偏爱哪种面料？',
    options: [
      { text: '真丝/羊毛/高级感', scores: { elegant: 2 } },
      { text: '棉麻/舒适透气', scores: { casual: 2, vintage: 1 } },
      { text: '科技面料/速干', scores: { sporty: 2, avantGarde: 1 } },
      { text: '蕾丝/雪纺/纱', scores: { sweet: 2, vintage: 1 } },
    ],
  },
  {
    id: 'accessory',
    question: '你喜欢什么配饰风格？',
    options: [
      { text: '简约金属/珍珠', scores: { elegant: 2 } },
      { text: '夸张设计感', scores: { avantGarde: 2 } },
      { text: '可爱/蝴蝶结/毛绒', scores: { sweet: 2 } },
      { text: '运动手表/机能包', scores: { sporty: 2 } },
    ],
  },
]

/**
 * 风格诊断
 * @param {Record<string, number>} answers 题目 id → 选项索引
 * @returns {{primary:string, primary_name:string, secondary:string|null, scores:Record<string,number>, desc:string}}
 */
function diagnoseStyle(answers) {
  if (!answers || typeof answers !== 'object') return null
  const scores = {}
  for (const key of Object.keys(STYLE_TYPES)) scores[key] = 0

  for (const q of DIAGNOSIS_QUESTIONS) {
    const optIdx = answers[q.id]
    if (optIdx == null || optIdx < 0 || optIdx >= q.options.length) continue
    const opt = q.options[optIdx]
    for (const [style, add] of Object.entries(opt.scores)) {
      scores[style] = (scores[style] || 0) + add
    }
  }

  // 没有有效回答 ⇒ 不出结论
  const total = Object.values(scores).reduce((s, v) => s + v, 0)
  if (total === 0) return null

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const primary = sorted[0][0]
  const secondary = sorted[1] && sorted[1][1] > 0 ? sorted[1][0] : null

  return {
    primary,
    primary_name: STYLE_TYPES[primary].name,
    secondary,
    secondary_name: secondary ? STYLE_TYPES[secondary].name : null,
    scores,
    desc: STYLE_TYPES[primary].desc,
  }
}

module.exports = {
  diagnoseStyle,
  DIAGNOSIS_QUESTIONS,
  STYLE_TYPES,
}
