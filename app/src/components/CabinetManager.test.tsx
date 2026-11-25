import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./WardrobeTab', () => ({ default: () => <button>衣橱内部控件</button> }))
vi.mock('./CosmeticTab', () => ({ default: () => <button>化妆品内部控件</button> }))
vi.mock('./AccessoryTab', () => ({ default: () => <button>配饰内部控件</button> }))

import CabinetManager from './CabinetManager'

afterEach(() => cleanup())

describe('CabinetManager 隐藏标签页', () => {
  it('已访问但非当前的面板保持挂载，同时对辅助技术和键盘导航隐藏', () => {
    render(<CabinetManager />)
    fireEvent.click(screen.getByRole('button', { name: '化妆品柜' }))
    fireEvent.click(screen.getByRole('button', { name: '配饰柜' }))
    fireEvent.click(screen.getByRole('button', { name: '衣橱管理' }))

    const wardrobeControl = screen.getByText('衣橱内部控件')
    const wardrobePanel = wardrobeControl.parentElement!
    expect(wardrobePanel.getAttribute('aria-hidden')).toBe('false')
    expect(wardrobePanel.hasAttribute('inert')).toBe(false)

    for (const name of ['化妆品内部控件', '配饰内部控件']) {
      const panel = screen.getByText(name).parentElement!
      expect(panel.style.display).toBe('none')
      expect(panel.getAttribute('aria-hidden')).toBe('true')
      expect(panel.hasAttribute('inert')).toBe(true)
    }
  })
})
