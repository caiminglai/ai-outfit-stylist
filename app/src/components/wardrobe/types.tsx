// 11-03 大文件拆分轮：这一段从 WardrobeTab.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：WardrobeTab.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import type { CustomerProfile } from '../../types'

export interface WardrobeTabProps {
  profile?: CustomerProfile | null
  compact?: boolean
}

/* ================================================================
   默认表单值
   ================================================================ */
