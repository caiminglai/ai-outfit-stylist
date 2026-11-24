import { useState } from 'react'
import { getStyleQuestions, diagnoseStyle } from '../api'
import type { StyleQuestion, StyleDiagnosisResult } from '../types'

/**
 * 风格诊断测试（借鉴邂逅时尚 AI 风格检测）
 * 5 道题，每题选一个选项，提交后得到风格类型
 */
export default function StyleDiagnosis() {
  const [questions, setQuestions] = useState<StyleQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [result, setResult] = useState<StyleDiagnosisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)

  const start = async () => {
    setLoading(true)
    try {
      const res = await getStyleQuestions()
      setQuestions(res.questions)
      setStarted(true)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const submit = async () => {
    setLoading(true)
    try {
      const res = await diagnoseStyle(answers)
      setResult(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const answeredCount = Object.keys(answers).length

  if (!started) {
    return (
      <div className="glass-card p-6 text-center">
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--accent)' }}>
          风格诊断测试
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
          5 道题，帮你找到属于自己的穿搭风格
        </p>
        <button className="primary-btn" onClick={start} disabled={loading}>
          {loading ? '加载中...' : '开始测试'}
        </button>
      </div>
    )
  }

  if (result) {
    return (
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--accent)' }}>
          你的风格类型
        </h2>
        <div className="mb-4">
          <span
            className="pill-tag text-base"
            style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}
          >
            {result.primary_name}
          </span>
          {result.secondary_name && (
            <span className="text-sm ml-2" style={{ color: 'var(--muted)' }}>
              偏 {result.secondary_name}
            </span>
          )}
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--text)' }}>
          {result.desc}
        </p>
        <div className="space-y-1 mb-4">
          {Object.entries(result.scores)
            .sort((a, b) => b[1] - a[1])
            .map(([style, score]) => (
              <div key={style} className="flex items-center gap-2">
                <span className="text-xs w-16" style={{ color: 'var(--muted)' }}>
                  {style}
                </span>
                <div className="flex-1 h-2 rounded" style={{ backgroundColor: 'var(--bg-soft)' }}>
                  <div
                    className="h-2 rounded"
                    style={{ width: `${(score / 10) * 100}%`, backgroundColor: 'var(--accent)' }}
                  />
                </div>
                <span className="text-xs w-6 text-right" style={{ color: 'var(--muted)' }}>
                  {score}
                </span>
              </div>
            ))}
        </div>
        <button
          className="ghost-btn"
          onClick={() => {
            setResult(null)
            setAnswers({})
            setStarted(false)
          }}
        >
          重新测试
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-semibold" style={{ color: 'var(--accent)' }}>
            风格诊断
          </h2>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            已答 {answeredCount}/{questions.length}
          </span>
        </div>
        <div className="space-y-5">
          {questions.map((q, qi) => (
            <div key={q.id}>
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--text)' }}>
                {qi + 1}. {q.question}
              </p>
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    className={`w-full text-left p-2.5 rounded text-sm transition-colors ${
                      answers[q.id] === oi
                        ? 'border-2'
                        : 'border border-transparent hover:border-[var(--line)]'
                    }`}
                    style={{
                      borderColor: answers[q.id] === oi ? 'var(--accent)' : undefined,
                      backgroundColor: answers[q.id] === oi ? 'var(--bg-soft)' : 'transparent',
                      color: 'var(--text)',
                    }}
                    onClick={() => setAnswers({ ...answers, [q.id]: oi })}
                  >
                    {opt.text}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <button
        className="primary-btn w-full"
        onClick={submit}
        disabled={loading || answeredCount === 0}
      >
        {loading ? '诊断中...' : `提交诊断（已答 ${answeredCount} 题）`}
      </button>
    </div>
  )
}
