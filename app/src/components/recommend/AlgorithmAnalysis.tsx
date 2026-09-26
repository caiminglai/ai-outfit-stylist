/**
 * 算法分析卡片组件
 *
 * 展示 BMI/体型等数字摘要 + 体型/脸型/肤色/体态四个分析板块
 * 数据结构与后端 recommendEngine.buildRecommendation 的 algorithm_analysis 一致
 */
import type { AlgorithmAnalysis } from '../../types'

interface AlgorithmAnalysisProps {
  analysis: AlgorithmAnalysis
}

export default function AlgorithmAnalysisCard({ analysis }: AlgorithmAnalysisProps) {
  const sections = analysis.sections || []
  const metrics = analysis.metrics || []

  return (
    <div className="glass-card p-3" style={{ borderColor: '#c084fc' }}>
      <h3 className="text-sm font-semibold mb-2" style={{ color: '#c084fc' }}>
        🔬 科学分析报告
      </h3>

      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {metrics.map((m) => (
            <span
              key={m}
              className="pill-tag"
              style={{ fontSize: '10px', color: '#c084fc', borderColor: '#c084fc' }}
            >
              {m}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-2.5">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="text-xs font-medium mb-1" style={{ color: 'var(--text)' }}>
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.advices.map((advice, i) => (
                <li
                  key={i}
                  className="text-xs leading-relaxed pl-3"
                  style={{ color: 'var(--muted)', position: 'relative' }}
                >
                  <span style={{ position: 'absolute', left: 0 }}>·</span>
                  {advice}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
