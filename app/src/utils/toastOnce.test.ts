/**
 * 一次性提示（toastOnce）的去重行为钉（11-03 前端测试通道第 4 条）
 *
 * 为什么测这份：它的规则是"同一句话在短窗口里只弹一次，后到的重复件丢掉"，
 * 而症状是"一次 429 弹两条一模一样红条"。这条逻辑全靠 sonner 的调用次数才看得出，
 * 页面里没法点出来（本机 UI 通道没有系统鼠标）⇒ 用 mock 数调用次数最快。
 * 窗口时长（ERROR_WINDOW_MS 4000 / PLAIN_WINDOW_MS 2000）不外露，所以这里用假时钟测。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from './toastOnce'

/**
 * sonner 的 toast 本体换成计桩：每条都记下 [文案, 通道]。
 * ⚠️ 必须走 `vi.hoisted`：`vi.mock` 会被提到所有 import 之前，而 `./toastOnce` 也在
 * import 阶段就把 'sonner' 解析掉——工厂函数若在那时读一个普通 const，会撞
 * "Cannot access before initialization"（11-03 写这份时踩点确认过）。
 */
const { calls, spy } = vi.hoisted(() => {
  const calls: Array<[unknown, string]> = []
  const make = (channel: string) => (message: unknown) => {
    calls.push([message, channel])
    return 'id'
  }
  const plain = make('plain')
  const spy = Object.assign(plain, {
    error: make('error'),
    success: make('success'),
    message: make('message'),
    info: make('info'),
    warning: make('warning'),
  })
  return { calls, spy }
})

vi.mock('sonner', () => ({ toast: spy }))

function channels() {
  return calls.map((c) => c[1])
}

describe('toast.error：同文案短窗口内只弹一次', () => {
  beforeEach(() => {
    calls.length = 0
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('全局处理器与页面 catch 各弹一次 ⇒ 实际只落一条', () => {
    toast.error('请求过于频繁，请稍后再试')
    toast.error('请求过于频繁，请稍后再试')
    expect(calls.length).toBe(1)
  })

  it('文案差一个字就不合并（⛔ 不许按语义相近去重）', () => {
    toast.error('删除失败')
    toast.error('删除失败，请重试')
    expect(calls.length).toBe(2)
  })

  it('过了 4 秒窗口，同一句话可以再弹（不被永久吞掉）', () => {
    toast.error('加载衣橱失败')
    vi.advanceTimersByTime(4001)
    toast.error('加载衣橱失败')
    expect(calls.length).toBe(2)
  })

  it('error 与 plain 是两个桶；但 toast() 和 toast.message() 共用 plain 桶 ⇒ 同文案互相压制', () => {
    toast.error('网络不通')
    toast('网络不通')
    toast.message('网络不通')
    // 现量结论：源码里 `message:` 走的也是 `shouldSuppress('plain', ...)`，
    // 所以第三条被第二条压住 ⇒ 只有两声。这是设计（"同一句话只弹一次"），不是漏弹。
    expect(channels()).toEqual(['error', 'plain'])
  })

  it('success 永不合并（连着做两次事就该有两条回执）', () => {
    toast.success('已保存')
    toast.success('已保存')
    toast.success('已保存')
    expect(calls.length).toBe(3)
  })

  it('info / warning 直通 sonner，不参与去重', () => {
    toast.info('提示')
    toast.info('提示')
    toast.warning('注意')
    toast.warning('注意')
    expect(calls.length).toBe(4)
  })

  it('被压制时回空串（调用方不会拿到一个假 id）', () => {
    expect(toast.error('同一句')).toBe('id')
    expect(toast.error('同一句')).toBe('')
  })

  it('普通提示的窗口是 2 秒（比 error 短）', () => {
    toast('稍等')
    vi.advanceTimersByTime(2001)
    toast('稍等')
    expect(calls.length).toBe(2)
  })
})
