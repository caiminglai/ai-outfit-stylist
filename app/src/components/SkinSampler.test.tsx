import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkinSampler from './SkinSampler'

class ControlledImage {
  static instances: ControlledImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  complete = false
  naturalWidth = 0
  naturalHeight = 0
  src = ''

  constructor() {
    ControlledImage.instances.push(this)
  }

  load(width: number, height: number) {
    this.naturalWidth = width
    this.naturalHeight = height
    this.complete = true
    this.onload?.()
  }

  fail() {
    this.onerror?.()
  }
}

const originalImage = globalThis.Image
let revokeObjectURL: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  ControlledImage.instances = []
  vi.stubGlobal('Image', ControlledImage)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
  revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal('Image', originalImage)
})

async function pick(container: HTMLElement, name: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['image'], name, { type: 'image/png' })] } })
  await act(async () => {})
}

describe('SkinSampler 图片解码竞态', () => {
  it('旧照片迟到成功不能覆盖新照片的画布和当前对象 URL', async () => {
    const { container } = render(<SkinSampler onConfirm={() => {}} />)
    await pick(container, 'old.png')
    await pick(container, 'new.png')

    await act(async () => ControlledImage.instances[1].load(200, 100))
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(100)

    await act(async () => ControlledImage.instances[0].load(100, 50))
    expect(canvas.width).toBe(200)
    expect(canvas.height).toBe(100)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('旧照片迟到失败不能撤销新照片或显示过期错误', async () => {
    const { container } = render(<SkinSampler onConfirm={() => {}} />)
    await pick(container, 'old.png')
    await pick(container, 'new.png')
    await act(async () => ControlledImage.instances[1].load(200, 100))

    await act(async () => ControlledImage.instances[0].fail())
    expect(container.textContent).not.toContain('这张读不出来')
    expect((container.querySelector('canvas') as HTMLCanvasElement).width).toBe(200)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('取消选择会使在途解码失效，卸载不会重复释放当前 URL', async () => {
    const { container, unmount } = render(<SkinSampler onConfirm={() => {}} />)
    await pick(container, 'old.png')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [] } })
    await act(async () => ControlledImage.instances[0].load(100, 50))

    expect((container.querySelector('canvas') as HTMLCanvasElement).width).toBe(0)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})
