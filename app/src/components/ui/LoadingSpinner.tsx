/**
 * 加载动画组件
 * 旋转 spinner + 可选文字提示
 */

/** 加载动画 props */
interface LoadingSpinnerProps {
  /** 加载提示文字，默认"加载中..." */
  text?: string;
}

export default function LoadingSpinner({ text = '加载中...' }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <div className="spinner" />
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{text}</span>
    </div>
  );
}
