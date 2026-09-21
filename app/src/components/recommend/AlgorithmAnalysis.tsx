/**
 * 算法分析卡片组件
 *
 * 展示 BMI / 体型 / 肤色匹配 / 脸型指南 / 体态建议等科学分析结果
 */
import type { AlgorithmAnalysis } from '../../types';

interface AlgorithmAnalysisProps {
  analysis: AlgorithmAnalysis;
}

export default function AlgorithmAnalysisCard({ analysis }: AlgorithmAnalysisProps) {
  return (
    <div className="glass-card p-3" style={{ borderColor: '#c084fc' }}>
      <h3 className="text-sm font-semibold mb-2" style={{ color: '#c084fc' }}>🔬 科学分析报告</h3>
      <div className="space-y-2">
        {/* BMI */}
        {analysis.bmi && (
          <div className="flex items-center gap-2 text-xs">
            <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>BMI</span>
            <span className="font-medium" style={{ color: 'var(--text)' }}>{analysis.bmi.value}</span>
            <span className="pill-tag" style={{ fontSize: '10px' }}>{analysis.bmi.level}</span>
            <span style={{ color: 'var(--muted)', fontSize: '10px' }}>{analysis.bmi.advice}</span>
          </div>
        )}

        {/* 体型 */}
        {analysis.body_shape && (
          <div className="flex items-center gap-2 text-xs">
            <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>体型</span>
            <span className="pill-tag" style={{ fontSize: '10px' }}>{analysis.body_shape.type}</span>
            <span style={{ color: 'var(--muted)', fontSize: '10px' }}>腰臀比 {analysis.body_shape.wh_ratio}</span>
          </div>
        )}

        {/* 色彩匹配 */}
        {analysis.color_match && (
          <div className="text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>肤色</span>
              <span className="pill-tag" style={{ fontSize: '10px' }}>{analysis.color_match.skin_tone}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>适合色</span>
              <span style={{ color: 'var(--good)', fontSize: '10px' }}>
                {analysis.color_match.suitable_colors?.join('、') || '—'}
              </span>
            </div>
            {analysis.color_match.avoid_colors && analysis.color_match.avoid_colors.length > 0 && (
              <div className="flex items-start gap-2 mt-0.5">
                <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>避免色</span>
                <span style={{ color: 'var(--danger)', fontSize: '10px' }}>
                  {analysis.color_match.avoid_colors.join('、')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 脸型指南 */}
        {analysis.face_shape_guide && (
          <div className="text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>脸型</span>
              <span className="pill-tag" style={{ fontSize: '10px' }}>{analysis.face_shape_guide.shape}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>适合发型</span>
              <span style={{ color: 'var(--text)', fontSize: '10px' }}>
                {analysis.face_shape_guide.suitable_hairstyles?.join('、') || '—'}
              </span>
            </div>
          </div>
        )}

        {/* 体态建议 */}
        {analysis.posture_advice && analysis.posture_advice.issues && analysis.posture_advice.issues.length > 0 && (
          <div className="text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>体态</span>
              {analysis.posture_advice.issues.map((issue: string, i: number) => (
                <span key={i} className="pill-tag" style={{ fontSize: '10px', color: 'var(--warning)', borderColor: 'var(--warning)' }}>{issue}</span>
              ))}
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-12" style={{ color: 'var(--muted)' }}>穿搭建议</span>
              <span style={{ color: 'var(--text)', fontSize: '10px' }}>
                {analysis.posture_advice.outfit_advice?.join('；') || '—'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
