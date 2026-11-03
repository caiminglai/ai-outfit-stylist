// 类型总入口（11-03 大文件拆分轮起本文件只做转发）。
// 声明按领域分到 ./common|profile|scores|rules|engine|wardrobe|cosmetic|accessory|crossCabinet|misc 十个文件，
// 逐字搬走、一处未改；⛔ 消费方的写法仍旧是 `import type { X } from '../types'`，一行不改。
export type * from './common'
export type * from './profile'
export type * from './scores'
export type * from './rules'
export type * from './engine'
export type * from './wardrobe'
export type * from './cosmetic'
export type * from './accessory'
export type * from './crossCabinet'
export type * from './misc'
