/**
 * 文本建议表（11-03 从 profileEnricher.js 拆出，行为不变；拆前原文 559-774 行）。
 *
 * 职责：四张"查表出话"的映射——体型→穿搭（§6）、脸型→发型/妆容/修容/配饰（§7）、
 * 三庭五眼→比例修正方案（§7.5）、体态问题→穿搭与练习（§8）。
 *
 * 这四段全是文案＋取词函数，没有算式，所以并成一个文件：改文案只来这一个文件，
 * ⛔ 别把某一张表拆回主入口，那会让"同义词表"和它的目标表分居两处（FACE_SHAPE_ALIASES
 * 与 FACE_SHAPE_GUIDE 必须同文件，见下面 getFaceShapeGuide 的注释）。
 *
 * 共同的一条纪律：表键都来自表单自由文本 ⇒ 一律 `ownValue` 只认自有键。
 * 走普通方括号时 'constructor'／'toString' 会命中原型上的函数，
 * 于是整段建议变 undefined 或把函数塞进响应，而且不报错——这类"静默空掉"最难查。
 */
const { ownValue } = require('../../utils/common')

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
  // 只认自有键：key 万一是 constructor 这类原型名，普通查法会把一个函数当"穿搭建议"发出去
  return ownValue(BODY_SHAPE_OUTFIT, bodyShapeKey) || BODY_SHAPE_OUTFIT['hourglass']
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
  长脸: {
    analysis: '脸型偏长、中庭留白多，核心是缩短脸长并增加两侧宽度。',
    hair: '空气刘海/齐刘海直接缩短上庭，两侧蓬松卷发或波浪增加横向宽度；避免中分贴头皮直发、高颅顶和超长直发',
    makeup: '腮红横向打在苹果肌并向两侧晕染拉宽视觉，眉形宜平直，避免高挑眉和中轴线纵向修容',
    contour: '发际线下缘与下巴下缘扫阴影各缩短一截，额头和下巴中央提亮改为横向晕染',
    accessory: '圆形大耳环、宽檐帽、choker 或短项链增加横向阻断；避免长款流苏耳坠和 V 领继续拉长',
  },
}

/**
 * 脸型同义词:表单/规则词表 与 建议表词表 用词不同
 * 不加这层会静默落到兜底的鹅蛋脸文案,查不到也不报错
 */
const FACE_SHAPE_ALIASES = {
  椭圆脸: '鹅蛋脸',
}

/**
 * 返回脸型对应的发型/妆容/修容/配饰建议
 * @param {string} faceShape
 * @returns {{face_analysis: string, hair_advice: string, makeup_advice: string, contour_advice: string, accessory_advice: string}}
 */
function getFaceShapeGuide(faceShape) {
  // 脸型是表单里的文本：两张表都要只认自有键，否则 'constructor' 会把别名表本身
  // 当成一个函数返回，后面 guide.analysis 全变 undefined、整个建议块空掉
  const key = ownValue(FACE_SHAPE_ALIASES, faceShape) || faceShape
  const guide = ownValue(FACE_SHAPE_GUIDE, key) || FACE_SHAPE_GUIDE['鹅蛋脸']
  return {
    face_analysis: guide.analysis,
    hair_advice: guide.hair,
    makeup_advice: guide.makeup,
    contour_advice: guide.contour,
    accessory_advice: guide.accessory,
  }
}

// ============================================================
// 7.5 三庭五眼比例（face_ratio + eye_spacing → 比例修正方案）
// ============================================================

/**
 * 比例原理：哪一庭留白多，就把视觉重心从那一段移开，并用阴影截断、用横向元素补宽。
 * 眼距走的是"五眼"：眉距与眼线起止点是唯一能改变眼距视觉的两个杠杆。
 */
const FACE_PROPORTION_GUIDE = {
  比例均衡: {
    analysis: '三庭接近 1:1:1、眼距约等于一眼宽，五官分布标准，造型原则是不破坏既有比例。',
    hair: '中分或斜分都可，刘海可随意；避免为修饰而过度遮额、过度垫颅顶',
    makeup: '修容只做轻微立体，重点在提亮而不是截断；腮红落在苹果肌原位',
    contour: '鼻梁与颧骨轻扫即可，不在发际线或下巴做截断',
    accessory: '耳饰项链按脸型与配色选，任何款式都不会先输在比例上',
  },
  上庭偏长: {
    analysis: '额头段留白多，视觉重心被顶高，核心是压低额头、把重心拉回眉眼。',
    hair: '刘海直接缩短上庭（空气刘海/法式刘海/眉上短刘海按风格选）；避免大光明、高颅顶与头顶过度蓬松',
    makeup: '眉位略上移并画平直眉，额头下缘扫阴影；眼妆强调在中位，把视线从额头接过来',
    contour: '发际线下缘与额头上下缘各扫一段阴影截短上庭，下巴只做轻提亮不再拉长',
    accessory: '帽檐、宽边帽、眉框镜架与横向耳饰都能填上庭留白；避免高髻和纵向长流苏',
  },
  中庭偏长: {
    analysis: '面中与鼻梁段偏长，成熟清瘦感强，核心是截断面中并把视觉拉向两侧。',
    hair: '鬓角与两侧做蓬松卷度，卷的位置落在面中高度；避免贴头皮直发继续拉长',
    makeup: '腮红横向打在苹果肌并向两侧晕染；眼线横向延长或略下垂；避免鼻梁中轴线的纵向高光带',
    contour: '鼻梁中段与鼻尖下缘扫阴影截短鼻长，额头与下巴提亮，不做中轴纵向修容',
    accessory: '圆润或横向耳饰、眉框眼镜、choker 都能在面中形成横向阻断；避免细长剑坠与深 V 领',
  },
  下庭偏长: {
    analysis: '下巴与下颌段留白多，显成熟显清瘦，核心是缩短下巴并补下庭横向量感。',
    hair: '发尾在下巴高度内扣或做波浪填留白；避免超长直顺发把视觉继续往下带',
    makeup: '唇形画满并外扩约 1mm、提亮唇峰以缩短下巴留白；腮红位置略低但保持横向',
    contour: '下巴下缘扫阴影截短，唇下与下巴中央的提亮改成横向晕染而非纵向一点',
    accessory: '短项链、choker、圆形耳饰增加下半横向量感；避免长坠和尖长耳线',
  },
}

const EYE_SPACING_GUIDE = {
  眼距偏宽: {
    analysis: '两眼间距大于一眼宽，稚气与疏朗感强，核心是把视觉重心往中间收。',
    hair: '中分或贴面侧分能压住两侧留白；避免过度蓬松外扩的发型',
    makeup: '眉头略向中间起笔、眼线内眼角前延一点点，鼻侧影顺带收窄山根；眼尾不必再横向拉长',
    contour: '山根两侧扫阴影收窄眼距，眼窝内侧加深外侧留亮',
    accessory: '鼻托明显或中梁较窄的镜框、贴鼻侧的细项链都有收拢效果',
  },
  眼距适中: {
    analysis: '眼距接近一眼宽，眉距与眼位无需校正。',
    hair: '无特别限制，按脸型选',
    makeup: '眉峰按标准位（鼻翼—瞳孔外缘延长线）画即可',
    contour: '山根不做收窄也不做加宽',
    accessory: '镜框中梁对齐眉眼宽度即可',
  },
  眼距偏窄: {
    analysis: '两眼间距小于一眼宽，紧凑成熟感强，核心是把视觉往两侧拉开。',
    hair: '侧分与太阳穴处的蓬松能撑开两侧；避免厚重齐刘海把五官压得更紧',
    makeup: '眉头略向外移、眼尾横向延长，内眼角少加深；提亮内眼角与眉间距',
    contour: '山根与内眼角不做收窄修容，眉间三角区提亮',
    accessory: '宽中梁或太阳穴处有装饰的镜框、横向耳饰都能拉开两侧',
  },
}

/**
 * 三庭 + 五眼合并成一份比例建议
 * @param {string|null} faceRatio 三庭比例（FACE_PROPORTION_GUIDE 的键）
 * @param {string|null} eyeSpacing 眼距（EYE_SPACING_GUIDE 的键）
 * @returns {{analysis: string, hair: string, makeup: string, contour: string, accessory: string}|null}
 */
function getFaceProportionGuide(faceRatio, eyeSpacing) {
  // 两根轴都是文本键：原型名（constructor/toString）在普通查法下会拿到函数，
  // `!upper && !spacing` 这道闸门挡不住，最后 join 出来四个空字符串
  const upper = ownValue(FACE_PROPORTION_GUIDE, faceRatio)
  const spacing = ownValue(EYE_SPACING_GUIDE, eyeSpacing)
  if (!upper && !spacing) return null

  const join = (key) => [upper && upper[key], spacing && spacing[key]].filter(Boolean).join('；')
  return {
    analysis: join('analysis'),
    hair: join('hair'),
    makeup: join('makeup'),
    contour: join('contour'),
    accessory: join('accessory'),
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
  return ownValue(POSTURE_ADVICE, posture) || null
}

module.exports = {
  getBodyShapeOutfitAdvice,
  getFaceShapeGuide,
  getFaceProportionGuide,
  getPostureAdvice,
  FACE_PROPORTION_GUIDE,
  EYE_SPACING_GUIDE,
}
