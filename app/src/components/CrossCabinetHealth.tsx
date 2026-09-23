/**
 * 跨柜健康检查面板
 * 包含整体健康评分和三个子柜健康详情卡片
 */

import type { CabinetHealth, CabinetHealthDetail } from '../types';
import RingProgress from './ui/RingProgress';
import TipList from './ui/TipList';

// ============================================================
// 数据规范化 —— 兼容后端旧格式返回
// ============================================================

const EMPTY_DETAIL: CabinetHealthDetail = {
  score: 0,
  total: 0,
  categories: [],
  missing_essentials: [],
};

function normalizeData(raw: Record<string, unknown>): CabinetHealth {
  // 如果已经是新格式（有 wardrobe_health 字段），直接用
  if (raw.wardrobe_health !== undefined || raw.cosmetic_health !== undefined) {
    return {
      overall_score: (raw.overall_score as number) ?? 0,
      wardrobe_health: (raw.wardrobe_health as CabinetHealthDetail) ?? EMPTY_DETAIL,
      cosmetic_health: (raw.cosmetic_health as CabinetHealthDetail) ?? EMPTY_DETAIL,
      accessory_health: (raw.accessory_health as CabinetHealthDetail) ?? EMPTY_DETAIL,
      recommendations: Array.isArray(raw.recommendations) ? raw.recommendations as string[] : [],
    };
  }

  // 旧格式兼容：scores + counts + advices
  const scores = (raw.scores as Record<string, number>) || {};
  const counts = (raw.counts as Record<string, number>) || {};
  const advices = Array.isArray(raw.advices) ? raw.advices as string[] : [];

  return {
    overall_score: (raw.overall_score as number) ?? 0,
    wardrobe_health: {
      score: scores.wardrobe ?? 0,
      total: counts.wardrobe ?? 0,
      categories: [],
      missing_essentials: [],
    },
    cosmetic_health: {
      score: scores.cosmetic ?? 0,
      total: counts.cosmetic ?? 0,
      categories: [],
      missing_essentials: [],
    },
    accessory_health: {
      score: scores.accessory ?? 0,
      total: counts.accessory ?? 0,
      categories: [],
      missing_essentials: [],
    },
    recommendations: advices,
  };
}

// ============================================================
// 健康详情卡片
// ============================================================

/** 健康详情卡片 props */
interface HealthDetailCardProps {
  /** 图标 */
  icon: string;
  /** 柜名称（衣橱/化妆品/配饰） */
  label: string;
  /** 该柜健康详情数据 */
  detail: CabinetHealthDetail;
}

/** 健康详情卡片 */
function HealthDetailCard({ icon, label, detail }: HealthDetailCardProps) {
  const d = detail ?? EMPTY_DETAIL;
  const score = d.score ?? 0;
  const color = score >= 80 ? 'var(--good)' : score >= 60 ? 'var(--accent)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
  const statusText = score >= 80 ? '优秀' : score >= 60 ? '良好' : score >= 40 ? '一般' : '需改善';

  return (
    <div className="glass-card p-3 animate-fade-in" style={{ borderColor: color }}>
      <div className="flex items-center justify-between mb-2">
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {icon} {label}
        </span>
        <span className="pill-tag" style={{ color, borderColor: color }}>
          {statusText}
        </span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span style={{ fontSize: 24, fontWeight: 700, color }}>{score}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>共 {d.total ?? 0} 件</span>
      </div>
      {d.missing_essentials && d.missing_essentials.length > 0 && (
        <div className="flex flex-col gap-1">
          {d.missing_essentials.map((item, i) => (
            <span key={i} style={{ fontSize: 11, color: 'var(--warning)', paddingLeft: 8, borderLeft: '2px solid var(--line)' }}>
              缺少: {item}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 健康检查面板
// ============================================================

/** 健康检查面板 props */
interface CrossCabinetHealthProps {
  /** 三柜健康检查数据 */
  healthData: CabinetHealth;
}

/** 健康检查面板：总体评分 + 三子柜详情 + 改进建议 */
export default function CrossCabinetHealth({ healthData }: CrossCabinetHealthProps) {
  const data = normalizeData(healthData as unknown as Record<string, unknown>);
  const overallScore = data.overall_score ?? 0;

  return (
    <>
      {/* 总体评分卡片 */}
      <div className="glass-card p-4 animate-fade-in text-center">
        <div className="flex items-center justify-center mb-3">
          <RingProgress score={overallScore} size={96} strokeWidth={7} />
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text)',
            lineHeight: 1.6,
            maxWidth: 300,
            margin: '0 auto',
          }}
        >
          {overallScore >= 80 ? '三柜状态优秀，继续保持！' :
           overallScore >= 60 ? '整体状态良好，可适当补充品类' :
           overallScore >= 40 ? '部分品类不完整，建议补充基础单品' :
           '多品类缺失，建议优先补充衣橱、化妆品和配饰'}
        </div>
      </div>

      {/* 三个子卡片 */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <HealthDetailCard icon="👗" label="衣橱" detail={data.wardrobe_health} />
        <HealthDetailCard icon="💄" label="化妆品" detail={data.cosmetic_health} />
        <HealthDetailCard icon="💎" label="配饰" detail={data.accessory_health} />
      </div>

      {/* 改进建议 */}
      <TipList tips={data.recommendations ?? []} title="💡 改进建议" />
    </>
  );
}
