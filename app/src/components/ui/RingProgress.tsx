/**
 * 环形进度条组件
 * 用于展示健康评分等百分比指标
 */

/** 环形进度条 props */
interface RingProgressProps {
  /** 分数（0-100） */
  score: number;
  /** 圆环直径，默认 80 */
  size?: number;
  /** 描边宽度，默认 6 */
  strokeWidth?: number;
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'var(--good)';
  if (score >= 60) return 'var(--accent)';
  if (score >= 40) return 'var(--warning)';
  return 'var(--danger)';
}

export default function RingProgress({ score, size = 80, strokeWidth = 6 }: RingProgressProps) {
  const safeScore = typeof score === 'number' && !isNaN(score) ? score : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safeScore / 100) * circumference;
  const color = getScoreColor(safeScore);

  return (
    <div className="flex items-center justify-center" style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.5s ease' }}
        />
      </svg>
      <span style={{
        position: 'absolute',
        fontSize: size * 0.3,
        fontWeight: 700,
        color: color,
      }}>
        {safeScore}
      </span>
    </div>
  );
}
