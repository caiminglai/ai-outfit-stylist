/**
 * 后端 API 客户端（11-03 大文件拆分轮起本文件只做转发）。
 *
 * 实现按领域分到 ./api/core|customer|recommend|archive|wardrobe|outfit|cosmetic|accessory|crossCabinet|extras|paid|style，
 * 每一段逐字搬走、一处未改；⛔ 消费方仍旧 `import { xxx } from '../api'`，一行不改。
 * 下面的出口名单＝拆分前 api.ts 里带 export 的名字，逐字、逐序相同（由盘外探针核对）。
 */
export {
  setGlobalErrorHandler,
  getSessionId,
  clearExpiredSession,
  getAccount,
  setAccount,
  registerAccount,
  loginAccount,
  logoutAccount,
} from './api/core'
export type { PutPayload, AccountInfo } from './api/core'
export {
  getCustomerSessionId,
  createCustomerSession,
  syncCustomerToCloud,
  deleteCustomerSession,
  getCustomerRecommendation,
} from './api/customer'
export {
  getEngineRecommendation,
  postRuleFeedback,
  deleteRuleFeedback,
  postItemFeedback,
  getItemFeedback,
  deleteItemFeedback,
} from './api/recommend'
export type { FeedbackExtras, ItemFeedbackExtras, ItemFeedbackRow } from './api/recommend'
export {
  getProfileArchive,
  saveProfileArchive,
  deleteProfileArchive,
  browseRules,
} from './api/archive'
export type { ProfileField } from './api/archive'
export {
  listWardrobeItems,
  lookupWardrobeSku,
  addWardrobeItem,
  updateWardrobeItem,
  deleteWardrobeItem,
  getWardrobeGaps,
  suggestPurchases,
  rankTopsByBody,
  getWardrobeStatus,
} from './api/wardrobe'
export type { SkuLookup } from './api/wardrobe'
export {
  listWardrobeOutfits,
  createWardrobeOutfit,
  updateWardrobeOutfit,
  deleteWardrobeOutfit,
} from './api/outfit'
export type { OutfitDraft, OutfitListResult } from './api/outfit'
export {
  listCosmetics,
  addCosmetic,
  updateCosmetic,
  deleteCosmetic,
  getCosmeticExpiry,
  getCosmeticGaps,
  suggestCosmetics,
} from './api/cosmetic'
export {
  listAccessories,
  addAccessory,
  updateAccessory,
  deleteAccessory,
  getAccessoryGaps,
  suggestAccessories,
} from './api/accessory'
export {
  getCrossCabinetRecommend,
  getSeasonalReminder,
  getBrandPreference,
  getCabinetHealth,
} from './api/crossCabinet'
export {
  getWeatherProfile,
  uploadClothing,
  enhanceRecommendationText,
  getDailyHoroscope,
  directTryon,
} from './api/extras'
export { getPaymentEntitlement, claimPaidReport } from './api/paid'
export type {
  PaidReportRow,
  PaymentEntitlement,
  MyPaymentInfo,
  PaidReportPayload,
} from './api/paid'
export { getStyleQuestions, diagnoseStyle } from './api/style'
