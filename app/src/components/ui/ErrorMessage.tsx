/**
 * 错误提示组件
 * 显示错误信息并提供可选的重试按钮
 */

/** 错误提示 props */
interface ErrorMessageProps {
  /** 错误信息 */
  message: string;
  /** 重试回调 */
  onRetry?: () => void;
}

export default function ErrorMessage({ message, onRetry }: ErrorMessageProps) {
  return (
    <div className="glass-card p-4 text-center animate-fade-in" style={{ borderColor: 'var(--danger)' }}>
      <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{message}</p>
      {onRetry && (
        <button className="ghost-btn px-4 py-1.5 text-xs" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}
