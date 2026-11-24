// 11-03 大文件拆分轮：这一段从 src/api.ts 逐字搬来（领域＝style）。
// 函数体一处未改；⛔ 对外入口仍是 src/api.ts 那份 barrel，消费方的 import 写法一行不改。
import type { StyleDiagnosisResult, StyleQuestion } from '../types'
import { BASE, fetchWithTimeout, headers, unwrap } from './core'

// ============ 风格诊断测试 ============

export async function getStyleQuestions(): Promise<{ questions: StyleQuestion[] }> {
  const res = await fetchWithTimeout(`${BASE}/analysis/style-questions`, { headers: headers() })
  return unwrap(res)
}

export async function diagnoseStyle(
  answers: Record<string, number>,
): Promise<StyleDiagnosisResult> {
  const res = await fetchWithTimeout(`${BASE}/analysis/style-diagnose`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ answers }),
  })
  return unwrap(res)
}
