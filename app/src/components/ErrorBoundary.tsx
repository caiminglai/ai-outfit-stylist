import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * 错误边界组件
 * 捕获子组件渲染错误，避免整个应用崩溃
 *
 * 使用方式：
 * <ErrorBoundary fallback={<div>加载失败</div>}>
 *   <SomeComponent />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 可以在这里上报错误日志
    console.error('[ErrorBoundary] 组件渲染错误:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          color: 'var(--muted)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
            组件加载异常
          </div>
          <div style={{ fontSize: '12px', marginBottom: '16px', maxWidth: '280px' }}>
            {this.state.error?.message || '发生了未知错误'}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '6px 16px',
              borderRadius: '6px',
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--accent)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
