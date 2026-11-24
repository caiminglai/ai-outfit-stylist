// 11-03 大文件拆分轮：这一段从 WardrobeTab.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：WardrobeTab.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import type { TopFitResult } from '../../types'

/**
 * 把"身材偏差向量"拼成一句人话（只写量到的，没量的不写、也不写"未知"凑数）。
 * want 的符号约定与后端 topFitBody.js 一致：+ 想往外加，− 想往里收，0 这一维不推拉。
 */
export function describeDeviation(dev: TopFitResult['person_deviation']): string {
  const label: Record<string, string> = {
    shoulder: '肩线',
    waist: '腰线',
    length: '视觉腰位',
    volume: '体量',
    pattern: '条纹',
  }
  const measured: string[] = []
  if (dev.bmi != null) measured.push(`BMI ${dev.bmi}`)
  if (dev.shoulder_ratio != null) measured.push(`肩宽÷身高 ${dev.shoulder_ratio}%`)
  if (dev.shoulder_waist_ratio != null) measured.push(`肩宽÷腰围 ${dev.shoulder_waist_ratio}`)
  if (dev.leg_ratio != null) measured.push(`腿身比 ${dev.leg_ratio}`)
  if (dev.bust_waist_diff != null) measured.push(`胸腰差 ${dev.bust_waist_diff}cm`)
  if (dev.hip_waist_diff != null) measured.push(`臀腰差 ${dev.hip_waist_diff}cm`)
  if (dev.waist_groove_cm != null) measured.push(`腰沟 ${dev.waist_groove_cm}cm`)
  if (dev.ease_window_cm) measured.push(`松量合适区间 ${dev.ease_window_cm.join('~')}cm`)

  const wants: string[] = []
  for (const [k, v] of Object.entries(dev.want)) {
    if (v == null) continue
    const name = label[k] || k
    if (v === 0) wants.push(`${name}不推拉`)
    else wants.push(`${name}${v > 0 ? '想加' : '想收'} ${Math.abs(v)}`)
  }

  const head = measured.length ? measured.join(' / ') : '没量到尺寸'
  const tail = wants.length
    ? `想往哪修：${wants.join(' / ')}`
    : '没量到能判的尺寸 ⇒ 只按能算的几维打分'
  return `${head}；${tail}`
}

/* ================================================================
   组件
   ================================================================ */
