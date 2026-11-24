// 11-03 大文件拆分轮：这一段从 RecommendationReport.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：RecommendationReport.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import type { CustomerProfile, EngineRecommendation } from '../../types'

export interface RecommendationReportProps {
  recommendation: EngineRecommendation
  profile: CustomerProfile
  mode: 'store' | 'personal'
  sessionId?: string
  onSync?: () => void
  onDelete?: () => void
  onBack?: () => void
  synced?: boolean
  syncing?: boolean
  compact?: boolean
  /** 🔴 §四·1：顾客在天气卡里选了哪个城市（上一份报告算的时候用的是哪一个） */
  weatherCity?: string | null
  /** 上一次生成时后端给的天气出处账：'live'＝按体感温度折了档；'failed'＝名单外或上游没取到 */
  weatherSource?: 'live' | 'failed' | null
  /** 'failed' 时后端那句人话（含可选城市名单回显），原样显示，⛔ 前端自己编第二句 */
  weatherNotice?: string | null
  /** 选了城市之后按这个城市重算一遍穿搭（⛔ 不自动定位，点了才算，`19` §一 已裁） */
  onRegenerate?: () => void
  /** 城市变了要通知上层：真正调 `/engine` 的在那里，本组件不自己发推荐请求 */
  onWeatherCityChange?: (c: string | null) => void
  /**
   * 🔴 10-22 第十四阶段·第一步 X8：后端随推荐结果一起带回的那句隐私声明（真相源见
   * `pages/ExhibitionHall.tsx` 的 `privacyNotice` 注释）。有就显示、没有就**整行不出现**，
   * ⛔ 显示"未知"、⛔ 前端自己补一句承诺。
   */
  privacyNotice?: string
}
