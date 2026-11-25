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
import { toast } from '../utils/toastOnce'
import type { ServicePanelProps } from './exhibition/ServicePanel'
// 使用页面实际 vendored 的 Three r160；vitest.config.ts 将裸 three 别名指向同一文件。
// @ts-expect-error -- 本地静态资源刻意不带 TypeScript 声明
import * as THREE from '../../public/three/build/three.module.js'
// @ts-expect-error -- 本地静态资源刻意不带 TypeScript 声明
import { MMDLoader } from '../../public/three/examples/jsm/loaders/MMDLoader.js'

const layout = vi.hoisted(() => ({
  mode: 'desktop-landscape',
  isLandscape: true,
  isMobile: false,
  width: 1280,
  height: 720,
}))

const api = vi.hoisted(() => ({
  ACCOUNT_CHANGE_EVENT: 'style-ai-account-change',
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
      <span>profile:{props.profile?.gender ?? 'none'}</span>
      <span>session:{props.sessionId ?? 'none'}</span>
      <span>recommendation:{props.recommendation?.穿搭[0]?.group_name ?? 'none'}</span>
      <span>{`submitting:${props.submitting}`}</span>
      <span>archive:{props.archiveProfile?.height ?? 'none'}</span>
      <span>tags:{props.profileTags.join(',') || 'none'}</span>
      <button onClick={() => props.onDraft(PROFILE)}>schedule-draft</button>
      <button onClick={() => void props.onSubmit(PROFILE)}>submit</button>
      <button onClick={props.onReset}>reset</button>
      {props.stage === 'report' && <button onClick={props.onDelete}>delete-session</button>}
      {props.stage === 'mode-select' && (
        <>
          <button onClick={() => props.onSelectMode('personal')}>select-personal</button>
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
    recommendation: { summary: '测试报告', 穿搭: [{ group_name: '测试报告' }] },
    privacy_notice: '',
  })
  api.deleteCustomerSession.mockResolvedValue({ deleted: true })
  api.saveProfileArchive.mockResolvedValue({ body: 1, face: 0 })
})

afterEach(() => {
  cleanup()
  activeGallery?.disposeGallery?.()
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
    expect(iframe.parentElement?.getAttribute('aria-hidden')).toBe('true')
    expect(iframe.parentElement?.hasAttribute('inert')).toBe(true)
    expect(
      screen.getByText('stage:mode-select').parentElement?.getAttribute('aria-hidden'),
    ).toBeNull()
  })
})

describe('账号切换隔离', () => {
  it('切换到 B 账号时先清空 A 的档案和标签，再显示 B 的档案', async () => {
    api.getProfileArchive.mockResolvedValueOnce({
      profile: { height: 160 },
      tags: ['A档案'],
    })
    let finishB: ((value: { profile: { height: number }; tags: string[] }) => void) | undefined
    const bArchive = new Promise<{ profile: { height: number }; tags: string[] }>((resolve) => {
      finishB = resolve
    })
    api.getProfileArchive.mockReturnValueOnce(bArchive)
    render(<ExhibitionHall />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('archive:160')).toBeTruthy()
    expect(screen.getByText('tags:A档案')).toBeTruthy()

    const bAccount = { phone: '13900139000', sessionId: 'acct_b' }
    api.getAccount.mockReturnValue(bAccount)
    act(() => {
      window.dispatchEvent(
        new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
          detail: { account: bAccount, reason: 'login' },
        }),
      )
    })
    expect(screen.getByText('archive:none')).toBeTruthy()
    expect(screen.getByText('tags:none')).toBeTruthy()

    await act(async () => {
      finishB?.({ profile: { height: 170 }, tags: ['B档案'] })
      await bArchive
    })
    expect(screen.getByText('archive:170')).toBeTruthy()
    expect(screen.getByText('tags:B档案')).toBeTruthy()
  })

  it('进入个人表单后，当前账号迟到的档案仍能用于预填', async () => {
    let finishArchive:
      ((value: { profile: { height: number }; tags: string[] }) => void) | undefined
    const archive = new Promise<{ profile: { height: number }; tags: string[] }>((resolve) => {
      finishArchive = resolve
    })
    api.getProfileArchive.mockReturnValueOnce(archive)
    render(<ExhibitionHall />)
    fireEvent.click(screen.getByText('select-personal'))
    expect(screen.getByText('stage:form')).toBeTruthy()

    await act(async () => {
      finishArchive?.({ profile: { height: 170 }, tags: ['当前账号档案'] })
      await archive
    })
    expect(screen.getByText('archive:170')).toBeTruthy()
    expect(screen.getByText('tags:当前账号档案')).toBeTruthy()
  })

  it('A 账号迟到的档案响应不能覆盖已经切换到的 B 账号', async () => {
    let finishA: ((value: { profile: { height: number }; tags: string[] }) => void) | undefined
    const aArchive = new Promise<{ profile: { height: number }; tags: string[] }>((resolve) => {
      finishA = resolve
    })
    api.getProfileArchive.mockReturnValueOnce(aArchive)
    render(<ExhibitionHall />)

    const bAccount = { phone: '13900139000', sessionId: 'acct_b' }
    api.getAccount.mockReturnValue(bAccount)
    api.getProfileArchive.mockResolvedValueOnce({
      profile: { height: 170 },
      tags: ['B档案'],
    })
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
          detail: { account: bAccount, reason: 'login' },
        }),
      )
    })
    expect(screen.getByText('archive:170')).toBeTruthy()

    await act(async () => {
      finishA?.({ profile: { height: 160 }, tags: ['A档案'] })
      await aArchive
    })
    expect(screen.getByText('archive:170')).toBeTruthy()
    expect(screen.getByText('tags:B档案')).toBeTruthy()
  })

  it('账号切换清空 A 的本次报告、体型和门店会话，并回到模式选择', async () => {
    await enterReport()
    expect(screen.getByText('profile:女')).toBeTruthy()
    expect(screen.getByText('session:sess_report')).toBeTruthy()
    expect(screen.getByText('recommendation:测试报告')).toBeTruthy()

    api.getAccount.mockReturnValue({ phone: '13900139000', sessionId: 'acct_b' })
    act(() => {
      window.dispatchEvent(
        new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
          detail: { account: { phone: '13900139000', sessionId: 'acct_b' }, reason: 'login' },
        }),
      )
    })

    expect(screen.getByText('stage:mode-select')).toBeTruthy()
    expect(screen.getByText('profile:none')).toBeTruthy()
    expect(screen.getByText('session:none')).toBeTruthy()
    expect(screen.getByText('recommendation:none')).toBeTruthy()
    expect(screen.getByText('submitting:false')).toBeTruthy()
  })

  it('手动退出或认证失效后保留服务面板，游客能立即重新登录', async () => {
    render(<ExhibitionHall />)
    expect(screen.getByText('stage:mode-select')).toBeTruthy()

    for (const reason of ['manual', 'unauthorized']) {
      api.getAccount.mockReturnValue(null)
      act(() => {
        window.dispatchEvent(
          new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
            detail: { account: null, reason },
          }),
        )
      })
      expect(screen.getByText('stage:mode-select')).toBeTruthy()
      expect(screen.queryByText('stage:standby')).toBeNull()
    }
  })

  it('A 账号迟到的推荐响应不能覆盖 B 账号，且请求会收到取消信号', async () => {
    let finishSession: ((value: { session_id: string }) => void) | undefined
    api.createCustomerSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSession = resolve
        }),
    )
    render(<ExhibitionHall />)
    fireEvent.click(screen.getByText('submit'))
    const signal = api.createCustomerSession.mock.calls[0][1] as AbortSignal
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)

    api.getAccount.mockReturnValue({ phone: '13900139000', sessionId: 'acct_b' })
    act(() => {
      window.dispatchEvent(
        new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
          detail: { account: { phone: '13900139000', sessionId: 'acct_b' }, reason: 'login' },
        }),
      )
    })
    expect(signal.aborted).toBe(true)
    await act(async () => {
      finishSession?.({ session_id: 'sess_A_late' })
      await Promise.resolve()
    })
    expect(screen.getByText('stage:mode-select')).toBeTruthy()
    expect(screen.getByText('recommendation:none')).toBeTruthy()
    expect(api.getCustomerRecommendation).not.toHaveBeenCalled()
  })

  it('请求中退出展厅会取消推荐，迟到响应不能把页面切回报告', async () => {
    let finishRecommendation:
      | ((value: {
          recommendation: { 穿搭: { group_name: string }[] }
          privacy_notice: string
        }) => void)
      | undefined
    api.getEngineRecommendation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRecommendation = resolve
        }),
    )
    render(<ExhibitionHall />)
    fireEvent.click(screen.getByText('select-personal'))
    fireEvent.click(screen.getByText('submit'))
    const signal = api.getEngineRecommendation.mock.calls[0][3] as AbortSignal
    expect(signal.aborted).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '退出展厅' }))
    expect(signal.aborted).toBe(true)
    await act(async () => {
      finishRecommendation?.({
        recommendation: { 穿搭: [{ group_name: '迟到报告' }] },
        privacy_notice: '',
      })
      await Promise.resolve()
    })
    expect(screen.queryByText('stage:report')).toBeNull()
    expect(api.saveProfileArchive).not.toHaveBeenCalled()
  })

  it('快速重算只允许最后一份结果更新报告和忙碌状态', async () => {
    let finishFirst:
      | ((value: {
          recommendation: { 穿搭: { group_name: string }[] }
          privacy_notice: string
        }) => void)
      | undefined
    let finishSecond:
      | ((value: {
          recommendation: { 穿搭: { group_name: string }[] }
          privacy_notice: string
        }) => void)
      | undefined
    api.getEngineRecommendation
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = resolve
          }),
      )
    render(<ExhibitionHall />)
    fireEvent.click(screen.getByText('select-personal'))
    fireEvent.click(screen.getByText('submit'))
    fireEvent.click(screen.getByText('submit'))
    expect(api.getEngineRecommendation).toHaveBeenCalledTimes(2)
    expect((api.getEngineRecommendation.mock.calls[0][3] as AbortSignal).aborted).toBe(true)

    await act(async () => {
      finishSecond?.({
        recommendation: { 穿搭: [{ group_name: '最新报告' }] },
        privacy_notice: '',
      })
      await Promise.resolve()
    })
    expect(screen.getByText('recommendation:最新报告')).toBeTruthy()
    expect(screen.getByText('submitting:false')).toBeTruthy()

    await act(async () => {
      finishFirst?.({
        recommendation: { 穿搭: [{ group_name: '旧报告' }] },
        privacy_notice: '',
      })
      await Promise.resolve()
    })
    expect(screen.getByText('recommendation:最新报告')).toBeTruthy()
    expect(screen.queryByText('recommendation:旧报告')).toBeNull()
  })

  it('账号切换时取消 A 账号还没到点的草稿，不能写进 B 账号', async () => {
    render(<ExhibitionHall />)
    fireEvent.click(screen.getByText('schedule-draft'))

    const bAccount = { phone: '13900139000', sessionId: 'acct_b' }
    api.getAccount.mockReturnValue(bAccount)
    act(() => {
      window.dispatchEvent(
        new CustomEvent(api.ACCOUNT_CHANGE_EVENT, {
          detail: { account: bAccount, reason: 'login' },
        }),
      )
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(api.saveProfileArchive).not.toHaveBeenCalled()
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

  it('删除门店会话时明说已付费报告与复读依据仍保留', async () => {
    api.deleteCustomerSession.mockResolvedValue({
      deleted: true,
      paid_reports_retained: 1,
      report_basis_retained: 2,
    })
    await enterReport()
    await act(async () => {
      fireEvent.click(screen.getByText('delete-session'))
    })
    expect(toast.success).toHaveBeenCalledWith(
      '门店会话与免费记录已删除；为保障已购权益，保留了 1 份已付费报告及 2 条复读依据',
    )
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

  it('账号面板删除档案成功后清空旧画像、会话和报告，不能再次预填保存', async () => {
    api.getProfileArchive.mockResolvedValue({
      profile: { height: 170 } as CustomerProfile,
      tags: [],
    })
    render(<ExhibitionHall />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('archive:170')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByText('submit'))
    })
    expect(screen.getByText('stage:report')).toBeTruthy()
    expect(screen.getByText('profile:女')).toBeTruthy()
    expect(screen.getByText('recommendation:测试报告')).toBeTruthy()

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { type: 'start-service' },
        }),
      )
    })
    expect(screen.getByText('stage:mode-select')).toBeTruthy()
    fireEvent.click(screen.getByText('archive-cleared'))

    expect(screen.getByText('stage:mode-select')).toBeTruthy()
    expect(screen.getByText('profile:none')).toBeTruthy()
    expect(screen.getByText('session:none')).toBeTruthy()
    expect(screen.getByText('recommendation:none')).toBeTruthy()
    expect(screen.getByText('archive:none')).toBeTruthy()
    fireEvent.click(screen.getByText('select-personal'))
    expect(screen.getByText('stage:form')).toBeTruthy()
    expect(screen.getByText('profile:none')).toBeTruthy()
    expect(screen.getByText('archive:none')).toBeTruthy()
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

type TestTexture = {
  isTexture: true
  dispose: () => void
  addEventListener?: (type: string, listener: () => void) => void
  colorSpace?: string
  anisotropy?: number
  minFilter?: number
  magFilter?: number
  needsUpdate?: boolean
}

type TestMaterial = {
  isMMDToonMaterial?: boolean
  uniforms?: Record<string, { value: unknown }>
  dispose: () => void
  needsUpdate?: boolean
  extraTexture?: TestTexture
}

type TestMeshObject = {
  isMesh?: boolean
  geometry?: { dispose: () => void } | null
  material?: TestMaterial | TestMaterial[] | null
  traverse?: (callback: (object: TestMeshObject) => void) => void
}

type TestMesh = TestMeshObject & {
  isMesh: true
  geometry: { dispose: () => void }
  material: TestMaterial
  traverse: (callback: (object: TestMeshObject) => void) => void
  userData: Record<string, unknown>
  uuid: string
  name: string
  position: { x: number; y: number; z: number; toFixed: (digits: number) => string }
  scale: { x: number; y: number; z: number; toFixed: (digits: number) => string }
}

type ModelLoaderLoad = (
  url: string,
  onLoad: (mesh: TestMesh) => void,
  onProgress?: (event: { loaded: number; total: number }) => void,
  onError?: (error: Error) => void,
) => void

type GalleryCore = {
  loadProgress: (loaded: number, total: number) => number | null
  reduceLoadState: (
    state: {
      status: 'idle' | 'loading' | 'success' | 'error'
      progress: number
      error: string | null
    },
    event:
      | { type: 'start' }
      | { type: 'progress'; loaded: number; total: number }
      | { type: 'success' }
      | { type: 'error'; message: string },
  ) => { status: 'idle' | 'loading' | 'success' | 'error'; progress: number; error: string | null }
  collectMeshResources: (mesh: TestMeshObject) => {
    geometries: Set<{ dispose: () => void }>
    materials: Set<{ dispose: () => void }>
    textures: Set<TestTexture>
  }
  createResourceReleaser: () => (mesh: TestMeshObject, retainedRoots?: TestMeshObject[]) => void
}

type GalleryHarness = {
  core: GalleryCore | undefined
  initParticles: () => void
  loadModelsFromAPI: () => Promise<boolean>
  retryModelList: () => Promise<void>
  loadModel: (index: number) => void
  disposeMesh: (mesh: TestMeshObject, retainedRoots?: TestMeshObject[]) => void
  disposeGallery: (() => void) | null
  getState: () => {
    loadState?: { status: string; progress: number; error: string | null }
    pivot: { childrenCount: number } | null
  }
  stopCarousel: () => void
  requestAnimationFrame: Mock<typeof requestAnimationFrame>
  cancelAnimationFrame: Mock<typeof cancelAnimationFrame>
}

let activeGallery: GalleryHarness | undefined
const galleryHtml = readFileSync('public/model-gallery.html', 'utf8')

/**
 * 直接执行 model-gallery.html 里的独立核心与真实模块代码，只去掉 Three.js import 和自动启动。
 * DOM、fetch、定时器、可见性消息与按钮事件都是真的；替换的只有外部渲染依赖。
 */
function createGalleryHarness(
  fetchImplementation: typeof fetch,
  loadImplementation: ModelLoaderLoad = () => {},
): GalleryHarness {
  const moduleScript = galleryHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]
  const coreScript = galleryHtml.match(/<script id="model-gallery-core">([\s\S]*?)<\/script>/)?.[1]
  const body = galleryHtml.match(/<body>([\s\S]*?)<\/body>/)?.[1]
  if (!moduleScript || !body) throw new Error('model-gallery.html 结构不符合测试前提')
  document.body.innerHTML = body
  window.history.replaceState({}, '', '/')

  // 仅夹具：不启动 initScene，但把 animate / loadModel 依赖的渲染器与 pivot 换成可用 stub。
  // 其余 gallery 模块（包括加载状态机、释放、消息与按钮事件）原样执行。
  const executable = moduleScript
    .replace(/^\s*import .*;\s*$/gm, '')
    .replace(/\n\s*startApp\(\);/, '')
    .replace(
      'let scene, camera, renderer, controls, clock;',
      'let scene, camera, renderer = { render() {}, capabilities: { getMaxAnisotropy() { return 1; } } }, controls = { update() {} }, clock = { getDelta() { return 0; } };',
    )
  class RendererStub {}
  let nextFrameId = 1
  const requestAnimationFrameMock = vi.fn<typeof requestAnimationFrame>(() => nextFrameId++)
  const cancelAnimationFrameMock = vi.fn<typeof cancelAnimationFrame>()
  const harness = runInNewContext(
    `${coreScript || ''}\n${executable}\n
      pivot = {
        children: [],
        add(child) { this.children.push(child); },
        remove(child) { this.children = this.children.filter((item) => item !== child); },
      };
      ;({
        core: globalThis.ModelGalleryCore,
        initParticles,
        loadModelsFromAPI,
        retryModelList,
        loadModel,
        disposeMesh,
        disposeGallery: typeof disposeGallery === 'function' ? disposeGallery : null,
        getState: __debugApi.getState,
        stopCarousel,
        requestAnimationFrame,
        cancelAnimationFrame,
      })`,
    {
      THREE: { Cache: { enabled: true }, DefaultLoadingManager: {} },
      OrbitControls: RendererStub,
      MMDLoader: class extends RendererStub {
        setResourcePath() {}
        load(
          url: string,
          onLoad: (mesh: TestMesh) => void,
          onProgress?: (event: { loaded: number; total: number }) => void,
          onError?: (error: Error) => void,
        ) {
          loadImplementation(url, onLoad, onProgress, onError)
        }
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

function createTestMesh(
  options: {
    sharedTexture?: TestTexture
    throwOnOptimize?: boolean
    enumerableTexture?: boolean
  } = {},
): TestMesh {
  const texture = options.sharedTexture ?? { isTexture: true, dispose: vi.fn() }
  const material: TestMaterial = {
    isMMDToonMaterial: true,
    uniforms: {
      map: { value: texture },
      gradientMap: { value: texture },
    },
    dispose: vi.fn(),
  }
  Object.defineProperty(material, 'map', {
    configurable: true,
    get: () => material.uniforms?.map.value,
    set: (value: unknown) => {
      if (material.uniforms?.map) material.uniforms.map.value = value
    },
  })
  Object.defineProperty(material, 'gradientMap', {
    configurable: true,
    get: () => material.uniforms?.gradientMap.value,
    set: (value: unknown) => {
      if (material.uniforms?.gradientMap) material.uniforms.gradientMap.value = value
    },
  })
  if (options.enumerableTexture) material.extraTexture = texture

  let traversals = 0
  return {
    isMesh: true,
    geometry: { dispose: vi.fn() },
    material,
    userData: {},
    uuid: `test-${Math.random()}`,
    name: 'test-model',
    position: { x: 0, y: 0, z: 0, toFixed: (digits) => (0).toFixed(digits) },
    scale: { x: 1, y: 1, z: 1, toFixed: (digits) => (1).toFixed(digits) },
    traverse(callback) {
      traversals += 1
      if (options.throwOnOptimize && traversals === 1) throw new Error('optimize exploded')
      callback(this)
    },
  }
}

type CapturedModelLoad = {
  url: string
  onLoad: (mesh: TestMesh) => void
  onProgress?: (event: { loaded: number; total: number }) => void
  onError?: (error: Error) => void
}

const GALLERY_MODELS = [
  { id: 1, name: '测试模特 A', source: '测试来源', file: '/models/a.pmx' },
  { id: 2, name: '测试模特 B', source: '测试来源', file: '/models/b.pmx' },
]

async function createLoadedGallery(loads: CapturedModelLoad[]): Promise<GalleryHarness> {
  const gallery = createGalleryHarness(
    vi.fn<typeof fetch>().mockResolvedValue(galleryJson({ success: true, data: GALLERY_MODELS })),
    (url, onLoad, onProgress, onError) => loads.push({ url, onLoad, onProgress, onError }),
  )
  await gallery.retryModelList()
  return gallery
}

/** 现场生成最小合法 PMX 2.0：不读取、不复制任何第三方模型，干净检出也能跑。 */
function createFixturePmx(): ArrayBuffer {
  const bytes: number[] = []
  const scalar = new ArrayBuffer(4)
  const view = new DataView(scalar)
  const u8 = (value: number) => bytes.push(value)
  const u16 = (value: number) => {
    view.setUint16(0, value, true)
    bytes.push(...new Uint8Array(scalar, 0, 2))
  }
  const u32 = (value: number) => {
    view.setUint32(0, value, true)
    bytes.push(...new Uint8Array(scalar))
  }
  const f32 = (value: number) => {
    view.setFloat32(0, value, true)
    bytes.push(...new Uint8Array(scalar))
  }
  const text = (value: string) => {
    // header 的 encoding=0 表示 UTF-16LE；PMX 文本长度按字节计，不是字符数。
    const encoded = Array.from(value, (character) => character.charCodeAt(0))
    u32(encoded.length * 2)
    encoded.forEach((character) => u16(character))
  }

  new TextEncoder().encode('PMX ').forEach((value) => u8(value))
  view.setFloat32(0, 2.0, true)
  bytes.push(...new Uint8Array(scalar))
  ;[8, 0, 0, 1, 1, 1, 1, 1, 1].forEach((value) => u8(value))
  text('Fixture')
  text('Fixture')
  text('Synthetic PMX for loader regression')
  text('')

  u32(3)
  for (const position of [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]) {
    position.forEach(f32)
    ;[0, 0, 1].forEach(f32)
    ;[0, 0].forEach(f32)
    u8(0) // BDEF1
    u8(0) // 1 字节 bone index
    f32(0) // edge ratio
  }
  u32(3)
  ;[0, 1, 2].forEach((index) => u8(index))
  u32(1)
  text('fixture.png')

  u32(1)
  text('fixture-material')
  text('')
  ;[1, 1, 1, 1].forEach(f32) // diffuse
  ;[0, 0, 0].forEach(f32) // specular
  f32(0) // shininess
  ;[1, 1, 1].forEach(f32) // ambient
  u8(0) // material flags
  ;[0, 0, 0, 1].forEach(f32) // edge color
  f32(0) // edge size
  u8(0) // texture index
  u8(255) // no environment texture (-1)
  u8(0) // environment flag
  u8(0) // explicit toon texture
  u8(255) // no toon texture (-1)
  text('')
  u32(3) // one triangle

  u32(1)
  text('root')
  text('')
  ;[0, 0, 0].forEach(f32) // position
  u8(255) // no parent (-1)
  u32(0) // transformation class
  u16(0) // no optional bone fields
  ;[0, 0, 0].forEach(f32) // offset position
  ;[0, 0, 0, 0].forEach((count) => u32(count)) // morph/frame/rigid body/constraint

  return Uint8Array.from(bytes).buffer
}

/** 真 PMX 字节 → 真 MMDParser/MeshBuilder/MMDToonMaterial；只把网络与图片解码换成受控输入。 */
function loadLocalPmxThroughRealLoader(): {
  mesh: TestMesh
  materials: TestMaterial[]
  textures: TestTexture[]
} {
  const manager = new THREE.LoadingManager()
  manager.addHandler(/.*/, {
    load(_url: string) {
      return new THREE.Texture()
    },
  })
  const loader = new MMDLoader(manager)
  const buffer = createFixturePmx()
  loader.loader.load = (
    _url: string,
    onLoad: (value: ArrayBuffer) => void,
    onProgress: (event: { loaded: number; total: number }) => void,
  ) => {
    onProgress({ loaded: buffer.byteLength, total: buffer.byteLength })
    onLoad(buffer)
  }

  let mesh: TestMesh | undefined
  loader.load(
    '/api/models/file/integration.pmx',
    (value: TestMesh) => {
      mesh = value
    },
    () => {},
    (error: Error) => {
      throw error
    },
  )
  if (!mesh) throw new Error('真实 MMDLoader 未返回 PMX mesh')

  const materials = new Set<TestMaterial>()
  const textures = new Set<TestTexture>()
  mesh.traverse((object) => {
    const list = Array.isArray(object.material) ? object.material : [object.material]
    list.forEach((material) => {
      if (!material) return
      materials.add(material)
      Object.getOwnPropertyNames(material).forEach((key) => {
        let value: unknown
        try {
          value = (material as unknown as Record<string, unknown>)[key]
        } catch {
          // r160 的 MMDToonMaterial 有若干暴露了但 shader uniforms 未提供的访问器。
          return
        }
        if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
          textures.add(value as TestTexture)
        }
      })
      Object.values(material.uniforms || {}).forEach((uniform) => {
        if (
          uniform.value &&
          typeof uniform.value === 'object' &&
          (uniform.value as { isTexture?: boolean }).isTexture
        ) {
          textures.add(uniform.value as TestTexture)
        }
      })
    })
  })
  return { mesh, materials: [...materials], textures: [...textures] }
}

describe('model-gallery 模型列表', () => {
  it('模型卡片是可用键盘选择的原生按钮，并标记当前模型', async () => {
    await createLoadedGallery([])

    const first = document.querySelector<HTMLButtonElement>('.model-card[data-index="0"]')
    expect(first?.tagName).toBe('BUTTON')
    expect(first?.type).toBe('button')
    expect(first?.getAttribute('aria-pressed')).toBe('true')

    const second = screen.getByRole('button', { name: /测试模特 B/ })
    expect(second.getAttribute('aria-pressed')).toBe('false')
    second.focus()
    fireEvent.click(second)

    expect(first?.getAttribute('aria-pressed')).toBe('false')
    expect(second.getAttribute('aria-pressed')).toBe('true')
  })

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

describe('model-gallery PMX 失败出口', () => {
  it('进度到 99% 后成功回调抛错，也显示可重试错误而不是永久转圈', async () => {
    const loads: CapturedModelLoad[] = []
    const gallery = await createLoadedGallery(loads)
    loads[0].onProgress?.({ loaded: 99, total: 100 })
    expect(document.getElementById('loading-text')?.textContent).toContain('99%')

    expect(() => loads[0].onLoad(createTestMesh({ throwOnOptimize: true }))).not.toThrow()
    expect(document.getElementById('model-status')?.classList.contains('hidden')).toBe(false)
    expect(screen.getByRole('status').textContent).toContain('optimize exploded')
    expect(document.getElementById('loading-text')?.textContent).toContain('加载失败')
    expect(document.getElementById('loading-text')?.textContent).toContain('optimize exploded')
    expect(document.getElementById('model-retry')?.classList.contains('hidden')).toBe(false)
    expect(gallery.getState().loadState).toMatchObject({ status: 'error', progress: 99 })
    expect(gallery.getState().pivot?.childrenCount).toBe(0)
  })

  it('onError 保留失败卡片与明确错误，不再把唯一模型永久藏起来', async () => {
    const loads: CapturedModelLoad[] = []
    const gallery = await createLoadedGallery(loads)
    loads[0].onError?.(new Error('PMX 下载 404'))

    const card = document.querySelector<HTMLElement>('.model-card[data-index="0"]')
    expect(card?.classList.contains('load-error')).toBe(true)
    expect(card?.style.display).not.toBe('none')
    expect(document.getElementById('loading-text')?.textContent).toContain('PMX 下载 404')
    expect(document.getElementById('model-retry')?.classList.contains('hidden')).toBe(false)
    expect(gallery.getState().loadState).toMatchObject({ status: 'error', error: 'PMX 下载 404' })
  })

  it('失败后重试重新请求同一模型，成功后退出错误状态', async () => {
    const loads: CapturedModelLoad[] = []
    const gallery = await createLoadedGallery(loads)
    loads[0].onError?.(new Error('临时断网'))

    const retry = document.getElementById('model-retry')
    expect(retry).not.toBeNull()
    fireEvent.click(retry!)
    expect(loads).toHaveLength(2)
    expect(loads[1].url).toContain('a.pmx')
    expect(document.getElementById('loading-text')?.textContent).toContain('测试模特 A')

    loads[1].onLoad(createTestMesh())
    expect(document.getElementById('model-status')?.classList.contains('hidden')).toBe(true)
    expect(
      document.querySelector('.model-card[data-index="0"]')?.classList.contains('load-error'),
    ).toBe(false)
    expect(gallery.getState().loadState).toMatchObject({ status: 'success', progress: 100 })
  })

  it('PMX 加载超时把 99% 变成错误状态并提供重试', async () => {
    const loads: CapturedModelLoad[] = []
    const gallery = await createLoadedGallery(loads)
    loads[0].onProgress?.({ loaded: 99, total: 100 })

    await vi.advanceTimersByTimeAsync(60000)
    expect(document.getElementById('model-status')?.classList.contains('hidden')).toBe(false)
    expect(document.getElementById('loading-text')?.textContent).toContain('加载超时')
    expect(document.getElementById('model-retry')?.classList.contains('hidden')).toBe(false)
    expect(gallery.getState().loadState).toMatchObject({ status: 'error', progress: 99 })
  })
})

describe('model-gallery 资源生命周期', () => {
  it('切模型释放 uniforms/访问器共享的同一纹理，且只释放一次', async () => {
    const loads: CapturedModelLoad[] = []
    const gallery = await createLoadedGallery(loads)
    const first = createTestMesh()
    const firstGeometry = first.geometry
    const firstMaterial = first.material
    const firstTexture = firstMaterial.uniforms?.map.value as TestTexture
    loads[0].onLoad(first)

    gallery.loadModel(1)
    const second = createTestMesh()
    loads[1].onLoad(second)

    expect(firstGeometry.dispose).toHaveBeenCalledTimes(1)
    expect(firstMaterial.dispose).toHaveBeenCalledTimes(1)
    expect(firstTexture.dispose).toHaveBeenCalledTimes(1)
    expect(second.geometry.dispose).not.toHaveBeenCalled()
  })

  it('过期模型不释放仍被当前模型使用的共享纹理', async () => {
    const loads: CapturedModelLoad[] = []
    const gallery = await createLoadedGallery(loads)
    const sharedTexture: TestTexture = { isTexture: true, dispose: vi.fn() }
    const stale = createTestMesh({ sharedTexture, enumerableTexture: true })
    const staleGeometry = stale.geometry

    gallery.loadModel(1)
    const current = createTestMesh({ sharedTexture })
    loads[1].onLoad(current)
    loads[0].onLoad(stale)

    expect(sharedTexture.dispose).not.toHaveBeenCalled()
    expect(staleGeometry.dispose).toHaveBeenCalledTimes(1)
    gallery.loadModel(0)
    expect(sharedTexture.dispose).toHaveBeenCalledTimes(1)
  })

  it('pagehide 进入 bfcache 不销毁渲染器，真正卸载才释放当前模型', async () => {
    const loads: CapturedModelLoad[] = []
    await createLoadedGallery(loads)
    const mesh = createTestMesh()
    const geometry = mesh.geometry
    loads[0].onLoad(mesh)

    const cached = new Event('pagehide')
    Object.defineProperty(cached, 'persisted', { value: true })
    window.dispatchEvent(cached)
    expect(geometry.dispose).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('pagehide'))
    expect(geometry.dispose).toHaveBeenCalledTimes(1)
  })

  it('pagehide 卸载释放当前模型，重复卸载与清理不重复 dispose', async () => {
    const loads: CapturedModelLoad[] = []
    const gallery = await createLoadedGallery(loads)
    const mesh = createTestMesh()
    const geometry = mesh.geometry
    const material = mesh.material
    const texture = material.uniforms?.map.value as TestTexture
    loads[0].onLoad(mesh)
    expect(typeof gallery.disposeGallery).toBe('function')

    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('pagehide'))
    gallery.disposeMesh(mesh)

    expect(geometry.dispose).toHaveBeenCalledTimes(1)
    expect(material.dispose).toHaveBeenCalledTimes(1)
    expect(texture.dispose).toHaveBeenCalledTimes(1)
    expect(gallery.getState().pivot?.childrenCount).toBe(0)
  })
})

describe('model-gallery 可独立测试核心', () => {
  it('下载进度封顶 99%，只有真正成功才能到 100%', () => {
    const core = createGalleryHarness(vi.fn<typeof fetch>()).core
    expect(core).toBeDefined()
    expect(core?.loadProgress(99, 100)).toBe(99)
    expect(core?.loadProgress(100, 100)).toBe(99)
    expect(core?.loadProgress(227, 100)).toBe(99)
    expect(core?.loadProgress(10, 0)).toBeNull()

    const loading = { status: 'loading' as const, progress: 99, error: null }
    expect(core?.reduceLoadState(loading, { type: 'success' })).toEqual({
      status: 'success',
      progress: 100,
      error: null,
    })
    expect(core?.reduceLoadState(loading, { type: 'error', message: '下载失败' })).toEqual({
      status: 'error',
      progress: 99,
      error: '下载失败',
    })
  })

  it('资源收集覆盖访问器与 uniforms，按对象身份去重并保护仍被引用的资源', () => {
    const core = createGalleryHarness(vi.fn<typeof fetch>()).core
    expect(core).toBeDefined()
    const sharedTexture: TestTexture = { isTexture: true, dispose: vi.fn() }
    const ownTexture: TestTexture = { isTexture: true, dispose: vi.fn() }
    const stale = createTestMesh({ sharedTexture, enumerableTexture: true })
    const staleGeometry = stale.geometry
    const staleMaterial = stale.material
    const current = createTestMesh({ sharedTexture })
    if (staleMaterial.uniforms?.gradientMap) staleMaterial.uniforms.gradientMap.value = ownTexture

    expect(core?.collectMeshResources(stale).textures.size).toBe(2)
    const release = core?.createResourceReleaser()
    expect(release).toBeDefined()
    release?.(stale, [current])
    release?.(stale, [current])
    expect(sharedTexture.dispose).not.toHaveBeenCalled()
    expect(ownTexture.dispose).toHaveBeenCalledTimes(1)
    expect(staleGeometry.dispose).toHaveBeenCalledTimes(1)
    expect(staleMaterial.dispose).toHaveBeenCalledTimes(1)

    release?.(current)
    expect(sharedTexture.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('model-gallery 真实 Three/PMX 受控集成', () => {
  it('真实 PMX 生成的 MMDToonMaterial 在卸载时释放全部 uniform 纹理且不重复', () => {
    const { mesh, materials, textures } = loadLocalPmxThroughRealLoader()
    expect(mesh.isMesh).toBe(true)
    expect(materials.length).toBeGreaterThan(0)
    expect(materials.every((material) => material.isMMDToonMaterial)).toBe(true)
    expect(textures.length).toBeGreaterThan(0)

    const textureDisposals = textures.map((texture) => {
      const disposed = vi.fn()
      texture.addEventListener?.('dispose', disposed)
      return disposed
    })
    const materialDisposals = materials.map((material) => vi.spyOn(material, 'dispose'))
    const geometryDisposal = vi.spyOn(mesh.geometry, 'dispose')
    const gallery = createGalleryHarness(vi.fn<typeof fetch>())

    gallery.disposeMesh(mesh)
    gallery.disposeMesh(mesh)
    expect(geometryDisposal).toHaveBeenCalledTimes(1)
    materialDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1))
    textureDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1))
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
