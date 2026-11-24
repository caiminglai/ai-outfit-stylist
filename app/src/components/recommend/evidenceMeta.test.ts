/**
 * 依据档位展示层的行为钉（11-03 前端测试通道第 3 条）
 *
 * 为什么测这份：措辞红线是"只有 A/B 两档能对外说科学/量化"，C 是行业体系、D 是命理。
 * 这条规则以前只写在注释里，没有任何断言兜着 ⇒ 谁改 `isQuantifiable` 或往 META 里加一档，
 * 都不会有机器响。与后端 `services/evidenceLevels.js` 的逐字对账放在
 * `backend/test/frontendConstantsParity.test.js`（本文件不 import `node:fs`，
 * 因为 `tsconfig.app.json` 的 `types` 只有 `vite/client`，加了就 TS2307 红）。
 */
import { describe, it, expect } from 'vitest'
import { META, pick, evidenceLabel, isQuantifiable } from './evidenceMeta'

describe('pick：认得出的四档原样回，其余一律归 none', () => {
  it('A/B/C/D 逐字回本档', () => {
    for (const l of ['A', 'B', 'C', 'D'] as const) expect(pick(l)).toBe(l)
  })

  it('null／undefined／认不出的词 ⇒ none（"没标依据等级"），⛔ 不许默认成 A 或 B', () => {
    expect(pick(null)).toBe('none')
    expect(pick(undefined)).toBe('none')
    expect(pick('' as never)).toBe('none')
    expect(pick('E' as never)).toBe('none')
    expect(pick('a' as never)).toBe('none') // 小写不算
  })
})

describe('META：四档加 none 都要有短标签＋完整说明＋主题色', () => {
  it('键表就是 A/B/C/D/none 五项（加一档就要一起改后端）', () => {
    expect(Object.keys(META).sort()).toEqual(['A', 'B', 'C', 'D', 'none'])
  })

  it('每一档三个字段都非空（漏 note 等于把证据链删了）', () => {
    for (const k of ['A', 'B', 'C', 'D', 'none'] as const) {
      expect(META[k].short.length, `${k}.short`).toBeGreaterThan(0)
      expect(META[k].note.length, `${k}.note`).toBeGreaterThan(0)
      expect(META[k].color, `${k}.color`).toContain('var(--')
    }
  })

  it('措辞红线：只有 A/B 的短标签够得上"实证/国标"，C／D／none 的标签里不许出现科学／量化', () => {
    // ⚠️ 只查短标签：note 是长句，C 档里写着"不能称客观规律"、D 档里写着"与量化依据不同源"，
    // 那是否定句，整串匹配会误报（11-03 现量：D.note 含"量化依据"四字）。
    const forbidden = /科学|客观规律|量化/
    expect(META.A.short).toMatch(/国标/)
    expect(META.B.short).toMatch(/实证/)
    for (const k of ['C', 'D', 'none'] as const) {
      expect(META[k].short, `${k} 的短标签越了措辞红线`).not.toMatch(forbidden)
    }
  })

  it('未标注那条必须明说"按行业体系（C）对待"', () => {
    expect(META.none.note).toContain('C')
    expect(META.none.color).toBe(META.D.color) // 未标注与命理同色：都不许被读成硬依据
  })
})

describe('isQuantifiable：只有 A/B 够称有科学/量化依据', () => {
  it('真值表逐格钉住', () => {
    expect(isQuantifiable('A')).toBe(true)
    expect(isQuantifiable('B')).toBe(true)
    expect(isQuantifiable('C')).toBe(false)
    expect(isQuantifiable('D')).toBe(false)
    expect(isQuantifiable(null)).toBe(false)
    expect(isQuantifiable(undefined)).toBe(false)
  })
})

describe('evidenceLabel：给不能挂组件的地方用', () => {
  it('回的是 META 里的短标签原词', () => {
    expect(evidenceLabel('A')).toBe(META.A.short)
    expect(evidenceLabel('D')).toBe(META.D.short)
    expect(evidenceLabel(undefined)).toBe(META.none.short)
  })

  it('后端出账写成字符串（tier: string）也不许炸，认不出就归 none', () => {
    expect(evidenceLabel('未知档' as never)).toBe(META.none.short)
    expect(evidenceLabel('A' as never)).toBe(META.A.short)
  })
})
