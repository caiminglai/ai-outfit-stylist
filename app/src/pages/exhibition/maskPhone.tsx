// 11-03 大文件拆分轮：这一段从 ExhibitionHall.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：ExhibitionHall.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。

export function maskPhone(phone: string): string {
  const p = String(phone || '')
  return p.length === 11 ? `${p.slice(0, 3)}****${p.slice(7)}` : p
}
