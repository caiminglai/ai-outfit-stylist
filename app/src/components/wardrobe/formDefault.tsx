// 11-03 大文件拆分轮：这一段从 WardrobeTab.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：WardrobeTab.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。

export const WARDROBE_FORM_DEFAULT = {
  name: '',
  category: 'top' as string,
  color: '',
  // 版型（10-19 第三阶段·模块一）：上衣/外套/连衣裙**必选**的一档。量不了软尺的人
  // 靠它把松量估出来（后端 FIT_TYPE_EASE），公式照样能跑——所以它是必填，实测尺寸反而是选填。
  fit_type: '' as string,
  fabric_weight: '' as string,
  pattern: '' as string,
  // 成衣实测四格（cm）：量到了就按实测打分（优先级高于版型档）；空着＝没量＝那一维不算
  shoulder_cm: '',
  bust_cm: '',
  length_cm: '',
  waistband_cm: '',
  style_tags: '',
  season_tags: '',
  occasion_tags: '',
  price: '',
  // 吊牌条码／店内编号（扫码录入那一格）：空＝这件不是扫来的
  sku: '',
  // 照片（第五阶段·第一步「拍照只存图」）：存的是后端返回的 /uploads/xxx.jpg 地址本身，
  // ⛔ 不做任何识别——本机没有视觉模型，接外部识别属掏钱项，等他拍板。空＝这件没拍照。
  image_url: '',
}

/* ================================================================
   防御性数据规范化
   兼容后端新旧两种 gap 数据格式
   ================================================================ */
