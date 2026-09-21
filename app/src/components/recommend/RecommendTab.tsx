/**
 * 推荐报告 Tab 栏相关常量和组件
 *
 * 导出:TABS(Tab定义)、FIELD_LABELS(字段中文映射)、HIDDEN_FIELDS(隐藏字段)、TAB_LABEL
 */

/** 推荐分类 Tab 定义 */
export const TABS = [
  { key: '穿搭', label: '穿搭', icon: '👗' },
  { key: '妆容', label: '妆造', icon: '💄' },
  { key: '发型', label: '发型', icon: '💇' },
  { key: '配饰', label: '配饰', icon: '💎' },
] as const;

/** 推荐字段中文映射(覆盖所有 action_type,避免前端显示原始英文 key) */
export const FIELD_LABELS: Record<string, string> = {
  // 穿搭类
  top_style: '上装', bottom_style: '下装', shoe_style: '鞋款',
  color_combo: '配色', reason: '推荐理由', outerwear: '外套',
  // 妆容类
  '妆容风格': '妆容风格', lip_color: '唇妆', foundation: '底妆',
  eye_shadow: '眼影', blush: '腮红', eyebrow: '眉型', eyeliner: '眼线',
  '妆容底妆': '底妆风格', beard: '胡须', skincare: '护肤建议',
  technique: '化妆技巧', lip_care: '唇部护理', face_care: '面部护理',
  // 发型类
  '发型': '发型', hair_color: '发色', bang_type: '刘海', hair_length: '长度',
  // 配饰类
  earring_type: '耳饰', necklace_type: '项链', earring_avoid: '耳饰避免',
  necklace_avoid: '项链避免', glasses_type: '眼镜', bag_style: '包袋',
  metal_color: '金属色', watch: '手表', belt: '腰带', ring: '戒指',
  bracelet: '手链', tie: '领带', cufflink: '袖扣', avoid: '避免',
  // 姿势类
  pose_key: '姿势要点', head_pose: '头部姿势', hand_pose: '手部姿势',
  upper_body: '上半身', lower_body: '下半身', expression: '表情',
  camera_hint: '拍摄建议',
  // 个人模式扩展字段
  '穿搭要点': '推荐搭配', '妆容要点': '推荐妆容', '配饰要点': '推荐配饰',
  cross_tip: '协调建议', capsule_wardrobe: '胶囊衣橱',
  shopping_tip: '购物建议', declutter_tip: '断舍离',
  // 季节
  spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季',
};

/** 不在卡片上展示的隐藏字段(explanation 单独在"为什么推荐"区展示) */
export const HIDDEN_FIELDS = ['group_id', 'group_name', 'priority', 'score', 'explanation'];

/** 根据 Tab key 获取中文标签 */
export function TAB_LABEL(key: string): string {
  const tab = TABS.find(t => t.key === key);
  return tab ? tab.label : key;
}
