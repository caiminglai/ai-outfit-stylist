/**
 * 推荐报告 Tab 栏：分类定义与中文标签。
 *
 * 导出：TABS（Tab 定义）、TAB_LABEL（按 key 取中文名）。
 * 🔴 11-03 第 4 项：FIELD_LABELS／HIDDEN_FIELDS 两段字段词表搬到了 `reportFields.ts`，
 * 成因见那个文件头上的注释；本文件里⛔ 再放常量给组件文件用。
 */

/** 推荐分类 Tab 定义 */
export const TABS = [
  { key: '穿搭', label: '穿搭', icon: '👗' },
  { key: '妆容', label: '妆造', icon: '💄' },
  { key: '发型', label: '发型', icon: '💇' },
  { key: '配饰', label: '配饰', icon: '💎' },
  { key: '姿势', label: '姿势', icon: '📷' },
] as const

/** 根据 Tab key 获取中文标签 */
export function TAB_LABEL(key: string): string {
  const tab = TABS.find((t) => t.key === key)
  return tab ? tab.label : key
}
