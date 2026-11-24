/**
 * 依据标签组件的渲染烟测（11-03 前端测试通道第 4 条：证明这条通道真能渲染组件）
 *
 * 为什么测这份：它是顾客看每一条建议时都会看到的药丸,措辞和证据链都靠它露出。
 * 之前"点一下也能看到完整说明"（X6 整改）只改了代码,没有任何断言钉住 ⇒ 谁把
 * note 从 DOM 里挪回 title-only,机器不会响。这里把两件事钉住:
 *   ① 短标签的字面写法 ② 完整说明在 DOM 里(不只挂在 title 上)。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import EvidenceTag from './EvidenceTag'
import { META } from './evidenceMeta'

afterEach(cleanup)

describe('EvidenceTag 默认形态（details/summary 可点展开）', () => {
  it('短标签写成「依据：xxx」,并且带 details/summary 结构', () => {
    const { container } = render(<EvidenceTag level="B" />)
    const summary = container.querySelector('summary')
    expect(summary).not.toBeNull()
    expect(summary?.textContent).toBe(`依据：${META.B.short}`)
    expect(container.querySelector('details')).not.toBeNull()
  })

  it('完整说明既在 title 里,也在展开区的 DOM 文本里（触屏没有 hover）', () => {
    const { container } = render(<EvidenceTag level="C" />)
    expect(container.querySelector('summary')?.getAttribute('title')).toBe(META.C.note)
    expect(screen.getByText(META.C.note)).toBeTruthy()
  })

  it('未标注档位（undefined）显示"没标依据等级",不会显示空白', () => {
    const { container } = render(<EvidenceTag level={undefined} />)
    expect(container.querySelector('summary')?.textContent).toBe(`依据：${META.none.short}`)
  })

  it('认不出的字符串也归到 none（后端 tier 是 string 类型）', () => {
    const { container } = render(<EvidenceTag level={'S' as never} />)
    expect(container.querySelector('summary')?.textContent).toBe(`依据：${META.none.short}`)
  })
})

describe('EvidenceTag withNote 形态（报告里摊开的那行）', () => {
  it('短标签与完整说明同屏可见', () => {
    const { container } = render(<EvidenceTag level="A" withNote />)
    const text = container.textContent ?? ''
    expect(text).toContain(META.A.short)
    expect(text).toContain(META.A.note)
    expect(container.querySelector('details')).toBeNull()
  })

  it('D 档（命理)不会在这一行里被说成科学', () => {
    const { container } = render(<EvidenceTag level="D" withNote />)
    expect(container.textContent ?? '').not.toMatch(/科学依据/)
  })
})
