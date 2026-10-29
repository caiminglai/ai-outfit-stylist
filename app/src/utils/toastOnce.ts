/**
 * 一次性提示（第十四阶段·第一步 X2，规范 `docs/依据/22` §三）
 * ============================================================
 * 症状：一次 429 会弹**两条**一模一样的红条。原因不在这两个调用点，而在架构上——
 * `api.ts` 里每个失败分支先喊一次全局处理器（`ExhibitionHall.tsx` 把它接成 `toast.error`），
 * 再把同一句话包进 `Error` 抛出；页面 `catch` 拿到 `e.message` 又弹一次。
 * ⛔ 不砍全局那一条：它是"页面没自己处理"时唯一的出口；⛔ 不砍页面那一条：那 44 个 `toast.error`
 * 点位里多数带上下文（"加载衣橱失败"），全局那句只有后端原话。
 * 正解＝**同一句话在一个短窗口里只弹一次**：谁先到谁弹，后到的重复件丢掉。
 * 这条尺子只合并"文案逐字相同"的重复，⛔ 不判语义相近（那会把"删除失败"和"删除失败，请重试"
 * 合成一条，等于替用户丢信息）。
 */
import { toast as sonner } from 'sonner'

/** 相同文案在这个毫秒窗口内只弹一次（两条重复之间通常差 0～几十毫秒，4 秒绰绰有余） */
const ERROR_WINDOW_MS = 4000
const PLAIN_WINDOW_MS = 2000

const lastShown = new Map<string, number>()

function shouldSuppress(kind: string, message: unknown, windowMs: number): boolean {
  const key = kind + '::' + String(message)
  const now = Date.now()
  const prev = lastShown.get(key)
  // 顺手清掉过期项：这个 Map 若只增不减，长时间开着的门店屏会攒下几千条键
  if (lastShown.size > 50) {
    for (const [k, t] of lastShown) {
      if (now - t > windowMs) lastShown.delete(k)
    }
  }
  if (prev !== undefined && now - prev < windowMs) return true
  lastShown.set(key, now)
  return false
}

type Msg = Parameters<typeof sonner>[0]
type Opts = Parameters<typeof sonner>[1]

/**
 * 与 `sonner` 的 `toast` 同名同形（可直接 `toast(...)`、`toast.error(...)`），
 * 只多了"重复文案合并"这一条。⛔ 不改 sonner 本体、⛔ 不加依赖。
 */
export const toast = Object.assign(
  (message: Msg, options?: Opts) => {
    if (shouldSuppress('plain', message, PLAIN_WINDOW_MS)) return ''
    return sonner(message, options)
  },
  {
    error: (message: Msg, options?: Opts) => {
      if (shouldSuppress('error', message, ERROR_WINDOW_MS)) return ''
      return sonner.error(message, options)
    },
    // 成功提示是"每做一件事都要有一条"的语义，⛔ 合并：连着存两次就该弹两次
    success: (message: Msg, options?: Opts) => sonner.success(message, options),
    message: (message: Msg, options?: Opts) => {
      if (shouldSuppress('plain', message, PLAIN_WINDOW_MS)) return ''
      return sonner.message(message, options)
    },
    info: (message: Msg, options?: Opts) => sonner.info(message, options),
    warning: (message: Msg, options?: Opts) => sonner.warning(message, options),
  },
)
