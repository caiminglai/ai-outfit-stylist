import { useState, useEffect } from 'react'

const DESKTOP_MIN_WIDTH = 768

/**
 * 响应式布局 Hook
 *
 * 检测当前设备类型和屏幕方向：
 * - desktop-landscape: 门店横屏（左右分屏）
 * - mobile-portrait: 手机竖屏（上下 Tab）
 * - mobile-landscape: 手机横屏（左右分屏，窄）
 *
 * 规则（2026-10-12 改）：先按宽度定"是不是桌面/门店屏"，再看方向。
 *   宽度 >= 768 且 宽>=高  => 门店横屏（左右分屏）
 *   宽度 >= 768 且 宽<高   => 上下 Tab（竖着的电脑窗口/平板竖放）
 *   宽度 <  768            => 按方向走手机横屏/竖屏
 * 原来这里多加了一条 `宽高比 >= 1.2` 才认桌面，结果 1000×900（比例 1.11）、1280×1100
 * 这类正常电脑窗口全掉进"手机横屏（窄）"那档 ⇒ 电脑上看到的是手机版排版。
 */
export type LayoutMode = 'desktop-landscape' | 'mobile-portrait' | 'mobile-landscape'

export interface ResponsiveState {
  mode: LayoutMode
  isLandscape: boolean
  isMobile: boolean
  width: number
  height: number
}

export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>(() => computeMode())

  useEffect(() => {
    let raf = 0
    const handler = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setState(computeMode()))
    }
    // resize 事件已覆盖屏幕旋转场景，无需废弃的 orientationchange
    window.addEventListener('resize', handler)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', handler)
    }
  }, [])

  return state
}

function computeMode(): ResponsiveState {
  // SSR 守卫
  if (typeof window === 'undefined') {
    return {
      mode: 'desktop-landscape',
      isLandscape: true,
      isMobile: false,
      width: 1024,
      height: 768,
    }
  }
  const width = window.innerWidth
  const height = window.innerHeight
  const ratio = width / height

  let mode: LayoutMode
  if (width >= DESKTOP_MIN_WIDTH) {
    // 宽度够 ⇒ 桌面/门店屏：横着就左右分屏，竖着（如平板竖放、浏览器拉窄）走上下 Tab
    mode = ratio >= 1 ? 'desktop-landscape' : 'mobile-portrait'
  } else {
    mode = ratio < 1 ? 'mobile-portrait' : 'mobile-landscape'
  }

  return {
    mode,
    isLandscape: width >= height,
    isMobile: width < DESKTOP_MIN_WIDTH,
    width,
    height,
  }
}
