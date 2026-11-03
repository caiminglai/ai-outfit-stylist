// 11-03 大文件拆分轮：这一段从 RecommendationReport.tsx 逐字搬来（2 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：RecommendationReport.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。

/** 两把星的哪一把（10-19 第三阶段·模块三）：审美＝这套好不好看，合身＝上衣上身合不合身 */
export type StarKind = 'aesthetic' | 'fit'

export const STAR_LABELS: Record<StarKind, { label: string; note: string }> = {
  aesthetic: { label: '好看', note: '这套搭配整体好不好看（主要对着色彩那一维）' },
  fit: { label: '合身', note: '上衣穿在身上合不合身（主要对着廓形那一维）' },
}
