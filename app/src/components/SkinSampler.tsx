/**
 * 肤色取色组件（第十阶段·第一步）
 *
 * 规范 = `docs/依据/18-肤色采集输入输出规范-20261021.md`。这个文件只管三件事：
 * 把用户选的照片画进本机 canvas → 让用户把方框对准脸颊 → 调 `sampleSkinFromImageData` 出一个色。
 *
 * 🔴 三条硬约束（18 §三）：
 * · **照片不出设备**：全程只 `URL.createObjectURL` 给 `<img>` 解码，不 `fetch`、不 `toDataURL`、
 *   不进 `localStorage`；换图/卸载时 `revokeObjectURL` 并把 canvas 尺寸归零。
 * · **默认不接管**：取样出来的档名只在用户点「用它」之后才写进表单；手选按钮照常能覆盖。
 * · **取不到就明说**：闸门不过 ⇒ 原样显示 `reason`，⛔ 不兜底成「自然」、⛔ 不写任何值。
 *
 * 深浅那一轴这里不碰（18 §2.3：照片判不了明暗，请照镜子自己确认）。
 */
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { UPLOAD_ACCEPT, checkPickedImage } from '../lib/imagePick'
import {
  facePriorBox,
  sampleSkinFromImageData,
  undertoneFromHue,
  type SkinSample,
  type SkinSampleOutcome,
  type SkinUndertone,
} from '../lib/skinSample'

interface SkinSamplerProps {
  /** 点「用它」之后写进表单：档名 + 色相角（请求体那一格 `skin_hue`）+ 取样 hex（只拆账） */
  onConfirm: (undertone: SkinUndertone, sample: SkinSample) => void
  /**
   * 点「清空这次取色」时上抛（10-21 第十三阶段·§四·3）：
   * 让上层把这一屏表单里的连续值（`skin_hue`／`skin_hex`）撤掉。
   * ⛔ 不写库——照片本来就不出设备，库里没有任何取色结果可删；
   * ⛔ 所以这一口不叫"删除数据"，只叫"清空这次取色"。
   */
  onClear?: () => void
  /** 紧凑模式：门店一屏塞很多字段时用，只留一句短提示 */
  compact?: boolean
}

/** 取样框最大边长（CSS 像素，C 档手拍：320px 显示宽下 64px ≈ 脸的三分之一） */
const MAX_BOX_EDGE = 64

/** 没选图时的取样框（`useState` 初值与「清空这次取色」共用同一份，避免两处写歪） */
const INITIAL_BOX = { x: 0, y: 0, size: 16 }

export default function SkinSampler({ onConfirm, onClear, compact }: SkinSamplerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const [box, setBox] = useState(INITIAL_BOX)
  const [confirmed, setConfirmed] = useState<{
    undertone: SkinUndertone
    sample: SkinSample
  } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  /** 重绘：底图 + 取样框。拖动时靠它把框画出来，⛔ 不往 canvas 写任何会被取样的东西 */
  function repaint() {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#34d399'
    ctx.lineWidth = 2
    ctx.strokeRect(box.x, box.y, box.size, box.size)
  }

  // 卸载时把本机解码出来的那张图彻底放掉：objectURL、img 引用、canvas 位图都不留在内存里。
  // canvas 在 effect 体内就把 ref 现值抄进局部变量（lint 那条 exhaustive-deps 的要求：
  // cleanup 跑的时候 ref 可能已经指向别的节点了）
  useEffect(() => {
    const canvasAtMount = canvasRef.current
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
      imageRef.current = null
      if (canvasAtMount) {
        canvasAtMount.width = 0
        canvasAtMount.height = 0
      }
    }
  }, [])

  // 换图或挪框之后重绘。repaint 读的是 ref，所以不进依赖表（eslint 那条注释写在下面一行）
  useEffect(() => {
    repaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, ready])

  async function handlePick(file: File | null): Promise<void> {
    setConfirmed(null)
    if (!file) {
      setMessage(null)
      return
    }
    // 这条链路不走网络，但沿用 imagePick 那份词表挡住误选的 pdf/heic/gif（18 §2.1 第一行）
    const err = checkPickedImage(file, '这张照片')
    if (err) {
      setMessage(err)
      return
    }
    const url = URL.createObjectURL(file)
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = url
    const img = new Image()
    // 🔴 10-21 真浏览器点验实测：⛔ 不能用 `img.decode()`——Chromium 的 decode() 要等"下一次能出帧"
    // 的时机才 resolve，标签页不可见／后台节流时永远不 resolve，整个取色框就再也出不来（组件卡在半路，
    // 连错误提示都不显示）。`load`/`error` 事件不依赖出帧，后台标签照样触发 ⇒ 改成事件版，
    // 再补一次 `complete` 兜底（缓存命中时 load 可能已经跑完了）。
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('解码失败'))
        img.src = url
        if (img.complete && img.naturalWidth > 0) resolve()
      })
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('尺寸为 0')
    } catch {
      URL.revokeObjectURL(url)
      objectUrlRef.current = null
      imageRef.current = null
      setReady(false)
      setMessage('这张读不出来，换一张 JPG / PNG / WebP 再试')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    // 显示上限 320px：够看清脸颊，又不让手机原片（常 4000px）占满内存
    const scale = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight, 1))
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    imageRef.current = img
    setBox(facePriorBox(canvas.width, canvas.height))
    setReady(true)
    setMessage(null)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current
    const canvas = canvasRef.current
    if (!d || !canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const dx = (event.clientX - d.startX) * scaleX
    const dy = (event.clientY - d.startY) * scaleY
    setBox((prev) => ({
      ...prev,
      x: Math.min(Math.max(0, d.originX + dx), Math.max(0, canvas.width - prev.size)),
      y: Math.min(Math.max(0, d.originY + dy), Math.max(0, canvas.height - prev.size)),
    }))
  }

  function handleSample() {
    setConfirmed(null)
    const canvas = canvasRef.current
    if (!canvas) {
      setMessage('还没有选好照片')
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setMessage('这台浏览器的 canvas 用不了，换浏览器再试')
      return
    }
    const size = Math.max(1, Math.min(box.size, canvas.width, canvas.height))
    const outcome: SkinSampleOutcome = sampleSkinFromImageData(
      ctx.getImageData(box.x, box.y, size, size),
    )
    if (!outcome.ok) {
      setMessage(outcome.reason)
      return
    }
    // sampleSkinFromImageData 内部已过 undertoneFromHue 那道闸，这里取回来只为显示档名
    const undertone = undertoneFromHue(outcome.sample.h)
    if (!undertone) {
      setMessage('这块的颜色偏出人群皮肤色范围了，请把方框往脸颊中间挪一挪或换一张光好的照片')
      return
    }
    setConfirmed({ undertone, sample: outcome.sample })
    setMessage(null)
  }

  /**
   * 「清空这次取色」（10-21 第十三阶段·§四·3）
   *
   * 只做三件事：清组件内的 `box`／`confirmed`／`message`，再把"连续值请上层撤掉"这一句上抛。
   * · ⛔ 不碰 `skin_tone` 那一格——取色时它是被一起写进去的档名，清色之后色彩侧要退回
   *   手选肤色档（`18` §三 的缺测降级链），顺手把它清了等于把用户自己选的档位也抹了。
   * · ⛔ 不写库、不发请求：照片只在本地 canvas 解码过，库里从来没有取色结果，所以这一口
   *   没有"删除数据"的语义，只有"这一次不用了"。
   * · 照片留着、`ready` 不动：想换个位置再取一次，不必重新选图。
   */
  function handleClear() {
    const canvas = canvasRef.current
    setBox(canvas ? facePriorBox(canvas.width, canvas.height) : INITIAL_BOX)
    setConfirmed(null)
    setMessage(null)
    onClear?.()
  }

  return (
    <div
      className="mt-3 rounded-lg p-2"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div className="text-xs mb-1" style={{ opacity: 0.7 }}>
        肤色取色（选填）
      </div>
      <div className="text-[10px] mb-2" style={{ color: 'var(--muted)' }}>
        {compact
          ? '只在你手机上算，照片不上传'
          : '取色只在你手机上算，照片不会上传。方框对准脸颊中间，深浅那一栏请照镜子自己确认。'}
      </div>

      <input
        type="file"
        accept={UPLOAD_ACCEPT}
        onChange={(e) => void handlePick(e.target.files?.[0] ?? null)}
        className="form-input text-xs mb-2"
        style={{ padding: '4px' }}
      />

      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            originX: box.x,
            originY: box.y,
          }
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => {
          dragRef.current = null
          e.currentTarget.releasePointerCapture?.(e.pointerId)
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        style={{
          display: ready ? 'block' : 'none',
          maxWidth: '100%',
          touchAction: 'none',
          borderRadius: '8px',
          border: '1px solid var(--line)',
        }}
      />

      {ready && (
        <div className="flex items-center gap-2 mt-2">
          <label className="text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>
            取样框
          </label>
          <input
            type="range"
            min={8}
            max={MAX_BOX_EDGE}
            value={Math.min(box.size, MAX_BOX_EDGE)}
            onChange={(e) => setBox((prev) => ({ ...prev, size: Number(e.target.value) }))}
            style={{ flex: 1 }}
          />
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <button
          onClick={handleSample}
          disabled={!ready}
          className="opt-btn flex-1"
          style={{ textAlign: 'center', padding: '8px 4px', fontSize: '12px' }}
        >
          取这块的颜色
        </button>
        <button
          onClick={() => {
            const canvas = canvasRef.current
            if (!canvas) return
            setBox(facePriorBox(canvas.width, canvas.height))
            setConfirmed(null)
            setMessage(null)
          }}
          disabled={!ready}
          className="opt-btn flex-1"
          style={{ textAlign: 'center', padding: '8px 4px', fontSize: '12px' }}
        >
          方框回中间
        </button>
      </div>

      {/* 清空这次取色（§四·3）：只在取过色的这一屏出现，点了把这一屏的连续肤色撤掉。
          ⛔ 文案不许写"删除数据"——库里没有取色结果可删（照片不出设备）。 */}
      {ready && (
        <button
          onClick={handleClear}
          className="opt-btn w-full mt-2"
          style={{ textAlign: 'center', padding: '6px 4px', fontSize: '11px', opacity: 0.75 }}
        >
          清空这次取色
        </button>
      )}

      {confirmed && (
        <div className="flex items-center gap-2 mt-2">
          <span
            aria-label="取到的颜色"
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              border: '1px solid var(--line)',
              background: confirmed.sample.hex,
              display: 'inline-block',
            }}
          />
          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
            {confirmed.sample.hex} · h {confirmed.sample.h.toFixed(2)}° · C{' '}
            {confirmed.sample.c.toFixed(2)} · {confirmed.sample.samples} 个点 ·{' '}
            {confirmed.undertone}
          </span>
        </div>
      )}

      {message && (
        <div className="text-[10px] mt-2" style={{ color: '#f0a3a3' }}>
          {message}
        </div>
      )}

      {confirmed && (
        <button
          onClick={() => onConfirm(confirmed.undertone, confirmed.sample)}
          className="opt-btn active w-full mt-2"
          style={{ textAlign: 'center', padding: '8px 4px', fontSize: '12px' }}
        >
          用这个：{confirmed.undertone}（深浅请自己确认）
        </button>
      )}
    </div>
  )
}
