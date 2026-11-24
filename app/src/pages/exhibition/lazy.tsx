// 11-03 大文件拆分轮：这一段从 ExhibitionHall.tsx 逐字搬来（7 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：ExhibitionHall.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import { lazy } from 'react'

// 代码分割:按需加载重型组件,减小首屏 bundle 体积
export const CustomerForm = lazy(() => import('../../components/CustomerForm'))
export const PersonalProfileForm = lazy(() => import('../../components/PersonalProfileForm'))
export const RecommendationReport = lazy(() => import('../../components/RecommendationReport'))
export const CabinetManager = lazy(() => import('../../components/CabinetManager'))
// 第十二阶段·第一步：付款之后顾客领报告的那个浮层（不是新路由，同登录面板那套遮罩）
export const PaidReports = lazy(() => import('../../components/PaidReports'))
export const CrossCabinetReport = lazy(() => import('../../components/CrossCabinetReport'))
export const RuleBrowser = lazy(() => import('../../components/RuleBrowser'))
