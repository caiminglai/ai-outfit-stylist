import { Routes, Route, Navigate } from 'react-router-dom';
import ExhibitionHall from './pages/ExhibitionHall';
import ErrorBoundary from './components/ErrorBoundary';

/**
 * 应用根组件
 *
 * 根据产品定位精简为单一页面：3D模型展厅 + 顾客服务一体化
 * - 待机态：全屏3D动漫模型展示，吸引顾客
 * - 服务态：分屏响应式（门店横屏左右分屏 / 手机竖屏上下Tab）
 *
 * 已移除：首页、历史记录、个人资料等 Tab（按用户要求精简）
 * 保留的旧路由做重定向到主页
 */
export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* 主页面：3D展厅 + 形象定制服务 */}
        <Route path="/" element={<ExhibitionHall />} />
        <Route path="/gallery" element={<Navigate to="/" replace />} />
        <Route path="/history" element={<Navigate to="/" replace />} />
        <Route path="/profile" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
