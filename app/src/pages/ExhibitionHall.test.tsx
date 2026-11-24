/**
 * 档案草稿与删除的竞态回归（2026-11-24 作品集加固 Task 6）。
 *
 * 这里只替换展厅的 iframe 与服务面板外壳，ExhibitionHall 的状态机、防抖、删除回调全是真代码。
 * 断言盯的是用户动作的后果：删除后旧草稿不能又打保存接口，已经在途的保存必须收到取消信号。
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { CustomerProfile } from '../types'
import type { ServicePanelProps } from './exhibition/ServicePanel'

const layout = vi.hoisted(() => ({
  mode: 'desktop-landscape',
  isLandscape: true,
  isMobile: false,
  width: 1280,
  height: 720,
}))

const api = vi.hoisted(() => ({
  clearExpiredSession: vi.fn(),
  createCustomerSession: vi.fn(),
  deleteCustomerSession: vi.fn(),
  getAccount: vi.fn(),
  getCustomerRecommendation: vi.fn(),
  getEngineRecommendation: vi.fn(),
  getProfileArchive: vi.fn(),
  getSessionId: vi.fn(),
  saveProfileArchive: vi.fn(),
  setGlobalErrorHandler: vi.fn(),
  syncCustomerToCloud: vi.fn(),
}))

vi.mock('../api', () => api)
vi.mock('../utils/toastOnce', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../hooks/useResponsive', () => ({
  useResponsive: () => layout,
}))
vi.mock('./exhibition/ModelViewer', () => ({
  ModelViewer: ({
    iframeRef,
    onLoad,
  }: {
    iframeRef: RefObject<HTMLIFrameElement | null>
    onLoad?: () => void
  }) => <iframe ref={iframeRef} title="3D模型展厅" onLoad={onLoad} />,
}))
vi.mock('./exhibition/ServicePanel', () => ({
  ServicePanel: (props: ServicePanelProps) => (
    <div>
      <span>stage:{props.stage}</span>
      <button onClick={() => props.onDraft(PROFILE)}>schedule-draft</button>
      <button onClick={() => void props.onSubmit(PROFILE)}>submit</button>
      <button onClick={props.onReset}>reset</button>
      {props.stage === 'report' && <button onClick={props.onDelete}>delete-session</button>}
      {props.stage === 'mode-select' && (
        <>
          <button onClick={props.onArchiveDeleteStart}>archive-delete-start</button>
          <button onClick={props.onArchiveCleared}>archive-cleared</button>
        </>
      )}
    </div>
  ),
}))

import ExhibitionHall from './ExhibitionHall'

const PROFILE = { gender: '女' } as CustomerProfile

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Object.assign(layout, {
    mode: 'desktop-landscape',
    isLandscape: true,
    isMobile: false,
    width: 1280,
    height: 720,
  })
  window.history.replaceState({}, '', '/?start=1')
  api.getAccount.mockReturnValue({ phone: '13800138000', sessionId: 'acct_test' })
  api.getProfileArchive.mockResolvedValue({ profile: null, tags: [] })
  api.createCustomerSession.mockResolvedValue({ session_id: 'sess_report' })
  api.getCustomerRecommendation.mockResolvedValue({
    recommendation: { summary: '测试报告' },
    privacy_notice: '',
  })
  api.deleteCustomerSession.mockResolvedValue({ deleted: true })
  api.saveProfileArchive.mockResolvedValue({ body: 1, face: 0 })
})

afterEach(() => {
  cleanup()
  activeGallery?.stopCarousel()
  activeGallery = undefined
  document.body.innerHTML = ''
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function enterReport(): Promise<void> {
  render(<ExhibitionHall />)
  await act(async () => {
    fireEvent.click(screen.getByText('submit'))
  })
  expect(screen.getByText('stage:report')).toBeTruthy()
}

describe('iframe 可见性', () => {
  it('手机竖屏切到服务页暂停 Three.js，切回模型页恢复', async () => {
    Object.assign(layout, {
      mode: 'mobile-portrait',
      isLandscape: false,
      isMobile: true,
      width: 390,
      height: 844,
    })
    render(<ExhibitionHall />)
    const iframe = screen.getByTitle('3D模型展厅') as HTMLIFrameElement
    const postMessage = vi.spyOn(iframe.contentWindow!, 'postMessage')
    postMessage.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '✨ 3D模型' }))
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'set-visible', visible: true },
      window.location.origin,
    )

    fireEvent.click(screen.getByRole('button', { name: '🎯 选择模式' }))
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'set-visible', visible: false },
      window.location.origin,
    )
  })
})

describe('档案草稿失效', () => {
  it('删除会话前清掉还没到点的草稿定时器：1.5 秒后也不保存', async () => {
    await enterReport()
    fireEvent.click(screen.getByText('schedule-draft'))

    await act(async () => {
      fireEvent.click(screen.getByText('delete-session'))
    })
    expect(api.deleteCustomerSession).toHaveBeenCalledWith('sess_report')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(api.saveProfileArchive).not.toHaveBeenCalled()
    expect(screen.queryByText('delete-session')).toBeNull()
  })

  it('删除会话时取消已经在途的草稿保存，并把 signal 传给 API', async () => {
    let finishSave: ((value: { body: number; face: number }) => void) | undefined
    api.saveProfileArchive.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    await enterReport()

    fireEvent.click(screen.getByText('schedule-draft'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(api.saveProfileArchive).toHaveBeenCalledTimes(1)
    const signal = api.saveProfileArchive.mock.calls[0][1] as AbortSignal | undefined
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByText('delete-session'))
    })
    expect(signal?.aborted).toBe(true)

    await act(async () => {
      finishSave?.({ body: 1, face: 0 })
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(api.saveProfileArchive).toHaveBeenCalledTimes(1)
  })

  it('账号面板 DELETE 等待期间就取消草稿，不等到成功回调', async () => {
    render(<ExhibitionHall />)
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByText('schedule-draft'))
    fireEvent.click(screen.getByText('archive-delete-start'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(api.saveProfileArchive).not.toHaveBeenCalled()
  })

  it('账号面板删除档案成功后也使旧草稿失效', async () => {
    render(<ExhibitionHall />)
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByText('schedule-draft'))
    fireEvent.click(screen.getByText('archive-cleared'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(api.saveProfileArchive).not.toHaveBeenCalled()
  })

  it('普通退出不误伤草稿：只删除档案才取消待存内容', async () => {
    render(<ExhibitionHall />)
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByText('schedule-draft'))
    fireEvent.click(screen.getByText('reset'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(api.saveProfileArchive).toHaveBeenCalledTimes(1)
  })
})

type GalleryHarness = {
  initParticles: () => void
  loadModelsFromAPI: () => Promise<boolean>
  stopCarousel: () => void
  requestAnimationFrame: Mock<typeof requestAnimationFrame>
  cancelAnimationFrame: Mock<typeof cancelAnimationFrame>
}

let activeGallery: GalleryHarness | undefined
const galleryHtml = readFileSync('public/model-gallery.html', 'utf8')

/**
 * 直接执行 model-gallery.html 里那段真实模块代码，只去掉 Three.js import 和自动启动。
 * DOM、fetch、定时器、可见性消息与按钮事件都是真的；替换的只有外部渲染依赖。
 */
function createGalleryHarness(fetchImplementation: typeof fetch): GalleryHarness {
  const moduleScript = galleryHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]
  const body = galleryHtml.match(/<body>([\s\S]*?)<\/body>/)?.[1]
  if (!moduleScript || !body) throw new Error('model-gallery.html 结构不符合测试前提')
  document.body.innerHTML = body
  window.history.replaceState({}, '', '/')

  // 仅夹具：不启动 initScene，但把 animate 依赖的 renderer/clock 声明改成可用 stub。
  // 其余 gallery 模块（包括 syncAnimation 与 message/visibilitychange 监听）原样执行。
  const executable = moduleScript
    .replace(/^\s*import .*;\s*$/gm, '')
    .replace(/\n\s*startApp\(\);/, '')
    .replace(
      'let scene, camera, renderer, controls, clock;',
      'let scene, camera, renderer = { render() {} }, controls = { update() {} }, clock = { getDelta() { return 0; } };',
    )
  class RendererStub {}
  let nextFrameId = 1
  const requestAnimationFrameMock = vi.fn<typeof requestAnimationFrame>(() => nextFrameId++)
  const cancelAnimationFrameMock = vi.fn<typeof cancelAnimationFrame>()
  const harness = runInNewContext(
    `${executable}\n;({ initParticles, loadModelsFromAPI, stopCarousel, requestAnimationFrame, cancelAnimationFrame })`,
    {
      THREE: { Cache: { enabled: true }, DefaultLoadingManager: {} },
      OrbitControls: RendererStub,
      MMDLoader: class extends RendererStub {
        setResourcePath() {}
        load() {}
      },
      document,
      window,
      location: window.location,
      AbortController,
      fetch: fetchImplementation,
      console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      requestAnimationFrame: requestAnimationFrameMock,
      cancelAnimationFrame: cancelAnimationFrameMock,
      URLSearchParams,
    },
  ) as GalleryHarness
  activeGallery = harness
  return harness
}

function startParticles(gallery: GalleryHarness): void {
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
  }
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D)
  try {
    gallery.initParticles()
  } finally {
    getContext.mockRestore()
  }
  // 初始化本身会排一帧；接下来的断言只盯可见性切换造成的增减。
  gallery.requestAnimationFrame.mockClear()
  gallery.cancelAnimationFrame.mockClear()
}

function galleryJson(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('model-gallery 模型列表', () => {
  it('请求 12 秒不结束就显示加载失败，而不是一直转圈', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}))
    const gallery = createGalleryHarness(fetchMock)
    const result = gallery.loadModelsFromAPI()

    await vi.advanceTimersByTimeAsync(12000)
    expect(await result).toBe(false)
    expect(document.getElementById('error-desc')?.textContent).toContain('12 秒')
    expect(document.getElementById('error-title')?.textContent).toContain('加载失败')
    expect(document.getElementById('api-error-overlay')?.classList.contains('show')).toBe(true)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })

  it('响应体一直不结束也受同一个 12 秒上限约束', async () => {
    const response = {
      ok: true,
      status: 200,
      json: () => new Promise<unknown>(() => {}),
    } as Response
    const gallery = createGalleryHarness(vi.fn<typeof fetch>().mockResolvedValue(response))
    const result = gallery.loadModelsFromAPI()

    await vi.advanceTimersByTimeAsync(12000)
    expect(await result).toBe(false)
    expect(document.getElementById('error-desc')?.textContent).toContain('12 秒')
    expect(document.getElementById('error-title')?.textContent).toContain('加载失败')
  })

  it('列表失败后点击重试重新请求，并恢复模型卡片', async () => {
    vi.useRealTimers()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('测试断网'))
      .mockResolvedValueOnce(
        galleryJson({
          success: true,
          data: [
            {
              id: 1,
              name: '测试模特',
              source: '测试来源',
              icon: '🧍',
              file: '/models/test.pmx',
            },
          ],
        }),
      )
    const gallery = createGalleryHarness(fetchMock)
    await gallery.loadModelsFromAPI()
    expect(document.getElementById('api-error-overlay')?.classList.contains('show')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('测试模特')).toBeTruthy())
    expect(document.getElementById('api-error-overlay')?.classList.contains('show')).toBe(false)
    expect(document.querySelector<HTMLElement>('.model-bar')?.style.display).not.toBe('none')
  })
})

describe('model-gallery 可见性暂停/恢复', () => {
  it('同源 set-visible 消息隐藏时取消两套 rAF，恢复可见时重新调度', () => {
    const gallery = createGalleryHarness(vi.fn<typeof fetch>())
    startParticles(gallery)

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'set-visible', visible: false },
      }),
    )
    expect(gallery.cancelAnimationFrame).toHaveBeenCalledTimes(2)
    expect(gallery.cancelAnimationFrame).toHaveBeenCalledWith(1)
    expect(gallery.cancelAnimationFrame).toHaveBeenCalledWith(2)
    expect(gallery.requestAnimationFrame).not.toHaveBeenCalled()

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'set-visible', visible: true },
      }),
    )
    expect(gallery.requestAnimationFrame).toHaveBeenCalledTimes(2)
    expect(gallery.cancelAnimationFrame).toHaveBeenCalledTimes(2)
  })

  it('document.hidden 的 visibilitychange 隐藏时取消两套 rAF，恢复可见时重新调度', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    try {
      const gallery = createGalleryHarness(vi.fn<typeof fetch>())
      startParticles(gallery)

      hidden.mockReturnValue(true)
      document.dispatchEvent(new Event('visibilitychange'))
      expect(gallery.cancelAnimationFrame).toHaveBeenCalledTimes(2)
      expect(gallery.cancelAnimationFrame).toHaveBeenCalledWith(1)
      expect(gallery.cancelAnimationFrame).toHaveBeenCalledWith(2)
      expect(gallery.requestAnimationFrame).not.toHaveBeenCalled()

      hidden.mockReturnValue(false)
      document.dispatchEvent(new Event('visibilitychange'))
      expect(gallery.requestAnimationFrame).toHaveBeenCalledTimes(2)
      expect(gallery.cancelAnimationFrame).toHaveBeenCalledTimes(2)
    } finally {
      hidden.mockRestore()
    }
  })
})
