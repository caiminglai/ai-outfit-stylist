/**
 * 报告页那一行五星（11-03 拆分轮跟着 RecommendationReport.tsx 搬出来的那段）
 *
 * 为什么测：这条的唯一出口是"点同一颗最高的星＝取消这把星，送 null 而不是送 0"，
 * 而 0 会被后端拦成 400。搬文件时如果把 `n === shown ? null : n` 写成 `? 0 : n`，
 * 界面照样能点、只是顾客再也删不掉评分——所以必须用 onPick 的实参来钉，不能只测渲染。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { StarRow } from './StarRow'
import { STAR_LABELS } from './starLabels'

afterEach(cleanup)

const stars = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>('button.star-btn'),
]

describe('StarRow', () => {
  it('渲染这把星的名字与五颗星（value 为 null 时五颗全空）', () => {
    const { container } = render(<StarRow kind="fit" value={null} busy={false} onPick={() => {}} />)
    expect(container.textContent).toContain(STAR_LABELS.fit.label)
    expect(stars(container)).toHaveLength(5)
    expect(container.textContent).not.toContain('★')
  })

  it('点第 3 颗送 3；已评 3 星时再点第 3 颗送 null（清空，不是 0）', () => {
    const onPick = vi.fn()
    const { container, rerender } = render(
      <StarRow kind="aesthetic" value={null} busy={false} onPick={onPick} />,
    )
    stars(container)[2].click()
    expect(onPick).toHaveBeenLastCalledWith(3)

    rerender(<StarRow kind="aesthetic" value={3} busy={false} onPick={onPick} />)
    expect(container.textContent).toContain('★'.repeat(3))
    stars(container)[2].click()
    expect(onPick).toHaveBeenLastCalledWith(null)
  })

  it('提交中（busy）五颗全禁用，点不动', () => {
    const onPick = vi.fn()
    const { container } = render(<StarRow kind="fit" value={2} busy onPick={onPick} />)
    expect(stars(container).every((b) => b.disabled)).toBe(true)
    stars(container)[0].click()
    expect(onPick).not.toHaveBeenCalled()
  })
})
