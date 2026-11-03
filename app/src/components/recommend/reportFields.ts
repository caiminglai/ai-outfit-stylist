/**
 * 推荐报告的字段词表：action_type 到中文名的映射，以及不在卡片上平铺的隐藏字段清单。
 *
 * 🔴 11-03 第 4 项：这两段常量从 `RecommendTab.tsx` 逐字搬到这里（⛔ 改一个字），
 * 因为 `react-refresh/only-export-components` 不许组件文件同时导出常量——
 * 原文 "Fast refresh only works when a file only exports components"，同一处说明见 `evidenceMeta.ts` 头上。
 * 消费方只有 `RecommendationReport.tsx`：卡片正文按 FIELD_LABELS 取名、按 HIDDEN_FIELDS 过滤内部键。
 */

/** 推荐字段中文映射(覆盖所有 action_type,避免前端显示原始英文 key) */
export const FIELD_LABELS: Record<string, string> = {
  // 穿搭类
  top_style: '上装',
  bottom_style: '下装',
  shoe_style: '鞋款',
  color_combo: '配色',
  reason: '推荐理由',
  outerwear: '外套',
  // 兜底硬编码那四条:规则引擎没命中时引擎直接给 outfit_ 前缀的键(见 recommendEngine.js 兜底分支),
  // 库里 47 种 action_type 这边全覆盖,漏了这四个就会把英文原键糊在卡片上
  outfit_top: '上装',
  outfit_bottom: '下装',
  outfit_color: '配色',
  outfit_reason: '推荐理由',
  // 妆容类
  妆容风格: '妆容风格',
  lip_color: '唇妆',
  foundation: '底妆',
  eye_shadow: '眼影',
  blush: '腮红',
  eyebrow: '眉型',
  eyeliner: '眼线',
  妆容底妆: '底妆风格',
  beard: '胡须',
  skincare: '护肤建议',
  technique: '化妆技巧',
  lip_care: '唇部护理',
  face_care: '面部护理',
  // 发型类
  发型: '发型',
  hair_color: '发色',
  bang_type: '刘海',
  hair_length: '长度',
  // 配饰类
  earring_type: '耳饰',
  necklace_type: '项链',
  earring_avoid: '耳饰避免',
  necklace_avoid: '项链避免',
  glasses_type: '眼镜',
  bag_style: '包袋',
  metal_color: '金属色',
  watch: '手表',
  belt: '腰带',
  ring: '戒指',
  bracelet: '手链',
  tie: '领带',
  cufflink: '袖扣',
  avoid: '避免',
  // 姿势类
  pose_key: '姿势要点',
  head_pose: '头部姿势',
  hand_pose: '手部姿势',
  upper_body: '上半身',
  lower_body: '下半身',
  expression: '表情',
  camera_hint: '拍摄建议',
  // 个人模式扩展字段
  穿搭要点: '推荐搭配',
  妆容要点: '推荐妆容',
  配饰要点: '推荐配饰',
  cross_tip: '协调建议',
  capsule_wardrobe: '胶囊衣橱',
  shopping_tip: '购物建议',
  declutter_tip: '断舍离',
  // 季节
  spring: '春季',
  summer: '夏季',
  autumn: '秋季',
  winter: '冬季',
}

/** 不在卡片上展示的隐藏字段(explanation 单独在"为什么推荐"区展示) */
export const HIDDEN_FIELDS = [
  'group_id',
  'group_name',
  'priority',
  'score',
  'feedback',
  'explanation',
  // 这两样是派生元数据,由 RecommendationReport 单独渲染(依据徽章/贴合分行),不当结论行平铺
  'evidence_level',
  'color_fit',
  // 身材贴合分同上:派生元数据,单独渲染,不平铺成"body_fit: [object Object]"
  'body_fit',
  // 综合排序分与来源标记(10-19 第二阶段)同上:对象/内部 id,平铺出来只会是 [object Object]
  'rank',
  'source',
  'wardrobe_item_id',
  // 10-20 色彩接线的三笔账目字段:已经在"上衣贴合度"那一行按 basis 说清楚了,
  // 平铺出来只会是 "color_basis: in-text" 这种英文键
  'color_basis',
  'color_parts',
  'color_text',
  // 呼应分同族(10-20 第六阶段):这两个是拆账用的数,报告行里已经说清"几件互相呼应"
  'color_harmony',
  'color_harmony_pairs',
  // 🔴 10-21 第十三阶段 §二·3／§二·4 的借色账目:五个都是"这个色是哪儿来的"的元数据,
  // 由"上衣贴合度"那一行按 color_basis_source 说破(措辞红线:⛔ 不许说成"识别出你的上衣是驼色"),
  // 平铺出来只会是 "color_borrowed_from: 白+蓝" 这种顾客看不懂的东西
  'color_basis_source',
  'color_borrowed',
  'color_borrowed_from',
  'color_borrowed_position',
  'color_top_band',
  'color_relational_from',
  'color_relational',
  // 🔴 §三·4 认出来的版型档／面料档:同上,由"上衣身材适配度"那一行说破"不是量出来的"
  'fit_type_inferred',
  'fabric_weight_inferred',
]
