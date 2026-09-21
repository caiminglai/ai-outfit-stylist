import { useState, useEffect } from 'react';

const DESKTOP_MIN_WIDTH = 768;
const LANDSCAPE_MIN_RATIO = 1.2;

/**
 * 响应式布局 Hook
 *
 * 检测当前设备类型和屏幕方向：
 * - desktop-landscape: 门店横屏（左右分屏）
 * - mobile-portrait: 手机竖屏（上下 Tab）
 * - mobile-landscape: 手机横屏（左右分屏，窄）
 *
 * 规则：
 *   宽高比 >= 1.2 且宽度 >= 768  => 门店横屏（左右分屏）
 *   宽高比 < 1                   => 手机竖屏（上下 Tab）
 *   其它                         => 手机横屏（左右分屏）
 */
export type LayoutMode = 'desktop-landscape' | 'mobile-portrait' | 'mobile-landscape';

export interface ResponsiveState {
  mode: LayoutMode;
  isLandscape: boolean;
  isMobile: boolean;
  width: number;
  height: number;
}

export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>(() => computeMode());

  useEffect(() => {
    let raf = 0;
    const handler = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setState(computeMode()));
    };
    // resize 事件已覆盖屏幕旋转场景，无需废弃的 orientationchange
    window.addEventListener('resize', handler);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handler);
    };
  }, []);

  return state;
}

function computeMode(): ResponsiveState {
  // SSR 守卫
  if (typeof window === 'undefined') {
    return { mode: 'desktop-landscape', isLandscape: true, isMobile: false, width: 1024, height: 768 };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ratio = width / height;

  let mode: LayoutMode;
  if (ratio >= LANDSCAPE_MIN_RATIO && width >= DESKTOP_MIN_WIDTH) {
    mode = 'desktop-landscape';       // 门店横屏
  } else if (ratio < 1) {
    mode = 'mobile-portrait';         // 手机竖屏
  } else {
    mode = 'mobile-landscape';        // 手机横屏
  }

  return {
    mode,
    isLandscape: width >= height,
    isMobile: width < DESKTOP_MIN_WIDTH,
    width,
    height,
  };
}
