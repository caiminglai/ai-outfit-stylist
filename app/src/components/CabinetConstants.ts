/**
 * CabinetManager 公共常量与辅助函数
 *
 * 所有 Tab 组件（衣橱/化妆品/配饰）共享的分类定义、
 * 标签映射、优先级展示和按钮样式。
 */
import type { CSSProperties } from 'react';

/* ================================================================
   分类常量
   ================================================================ */

export const WARDROBE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'top', label: '上装' },
  { value: 'bottom', label: '下装' },
  { value: 'outerwear', label: '外套' },
  { value: 'dress', label: '连衣裙' },
  { value: 'shoes', label: '鞋履' },
  { value: 'bag', label: '包袋' },
];

export const COSMETIC_CATEGORIES: { value: string; label: string }[] = [
  { value: 'lipstick', label: '唇膏' },
  { value: 'eyeshadow', label: '眼影' },
  { value: 'foundation', label: '粉底' },
  { value: 'blush', label: '腮红' },
  { value: 'eyeliner', label: '眼线' },
  { value: 'mascara', label: '睫毛膏' },
  { value: 'eyebrow', label: '眉笔' },
  { value: 'concealer', label: '遮瑕' },
  { value: 'powder', label: '蜜粉' },
];

export const ACCESSORY_CATEGORIES: { value: string; label: string }[] = [
  { value: 'earring', label: '耳饰' },
  { value: 'necklace', label: '项链' },
  { value: 'bracelet', label: '手链' },
  { value: 'ring', label: '戒指' },
  { value: 'bag', label: '包袋' },
  { value: 'hat', label: '帽子' },
  { value: 'scarf', label: '围巾' },
  { value: 'watch', label: '手表' },
  { value: 'glasses', label: '眼镜' },
  { value: 'belt', label: '腰带' },
];

/* ================================================================
   辅助函数
   ================================================================ */

export function getWardrobeCategoryLabel(value: string): string {
  return WARDROBE_CATEGORIES.find(c => c.value === value)?.label ?? value;
}

export function getCosmeticCategoryLabel(value: string): string {
  return COSMETIC_CATEGORIES.find(c => c.value === value)?.label ?? value;
}

export function getAccessoryCategoryLabel(value: string): string {
  return ACCESSORY_CATEGORIES.find(c => c.value === value)?.label ?? value;
}

export function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'high': return 'var(--danger)';
    case 'medium': return 'var(--warning)';
    case 'low': return 'var(--muted)';
    default: return 'var(--muted)';
  }
}

export function getPriorityLabel(priority: string): string {
  switch (priority) {
    case 'high': return '高';
    case 'medium': return '中';
    case 'low': return '低';
    default: return priority;
  }
}

/* ================================================================
   公共样式
   ================================================================ */

export function btnStyle(compact?: boolean): CSSProperties {
  return {
    padding: compact ? '6px 10px' : '8px 14px',
    fontSize: compact ? '12px' : '13px',
    fontWeight: 500,
    cursor: 'pointer',
    borderRadius: '6px',
    textAlign: 'center' as const,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
  };
}
