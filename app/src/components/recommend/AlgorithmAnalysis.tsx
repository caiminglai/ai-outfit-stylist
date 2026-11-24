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
        📐 身体数据与风格分析
      </h3>
      {/* 措辞口径:只有肩宽/身高、腿身比、腰臀比这几项能对上人体尺寸量级与公开研究,
          且这些区间阈值是产品假设不是国标判定;肤色季型、风格、场合属行业体系,八字五行属命理。
          所以这里不写"科学",也不点 GB/T 号(号型与人体尺寸国标都不含美观判据)。 */}
      <p className="text-[10px] mb-2" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
        数字项按人体尺寸的常见量级和公开研究方向计算(肩宽占比、腿身比、腰臀比的区间是参考线,不是国标判定);
        色彩季型、风格与场合建议属行业经验体系,八字五行属命理体系,都不是科学结论。
      </p>

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
