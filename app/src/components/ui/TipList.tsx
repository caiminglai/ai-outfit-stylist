/**
 * 提示列表组件
 * 绿色左边框卡片样式的提示信息列表
 */

/** 提示列表 props */
interface TipListProps {
  /** 提示内容数组 */
  tips: string[];
  /** 可选标题 */
  title?: string;
}

export default function TipList({ tips, title }: TipListProps) {
  if (!tips || tips.length === 0) return null;
  return (
    <div className="animate-fade-in">
      {title && <div className="section-title">{title}</div>}
      <div className="flex flex-col gap-2">
        {tips.map((tip, i) => (
          <div
            key={i}
            className="glass-card p-3"
            style={{
              borderLeft: '3px solid var(--good)',
              fontSize: 13,
              lineHeight: 1.6,
              color: 'var(--text)',
            }}
          >
            {tip}
          </div>
        ))}
      </div>
    </div>
  );
}
