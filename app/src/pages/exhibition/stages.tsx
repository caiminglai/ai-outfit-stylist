// 11-03 大文件拆分轮：这一段从 ExhibitionHall.tsx 逐字搬来（4 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：ExhibitionHall.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。

/**
 * 3D模型展厅 + 形象服务一体化页面
 *
 * 支持双模式:
 *   门店模式(store): 少数字段快速采集 → 推荐 → 同步/删除
 *   个人模式(personal): 完整深度档案 → 推荐 → 橱柜管理 → 跨柜推荐
 */

export type Stage = 'standby' | 'mode-select' | 'form' | 'report' | 'rules'
export type Panel = 'model' | 'service'
export type ServiceMode = 'store' | 'personal'
export type ReportTab = 'recommendation' | 'cabinet' | 'cross' | 'rules'
