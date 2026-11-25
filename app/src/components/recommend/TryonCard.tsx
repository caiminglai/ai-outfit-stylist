/**
 * 虚拟试穿卡片组件
 *
 * 上传人物照片和衣服照片，选择衣服类别后调用虚拟试穿接口，展示试穿结果
 */
import { useEffect, useRef, useState } from 'react'
import type { TryonResult } from '../../types'
import { directTryon } from '../../api'
import { UPLOAD_ACCEPT, checkPickedImage } from '../../lib/imagePick'

/** 虚拟试穿类别 */
const TRYON_CATEGORIES: { value: string; label: string }[] = [
  { value: 'top', label: '上衣' },
  { value: 'bottom', label: '下装' },
  { value: 'dress', label: '连衣裙' },
  { value: 'outerwear', label: '外套' },
]

export default function TryonCard() {
  const [personImage, setPersonImage] = useState<File | null>(null)
  const [garmentImage, setGarmentImage] = useState<File | null>(null)
  const [category, setCategory] = useState<string>('top')
  const [result, setResult] = useState<TryonResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestGenerationRef = useRef(0)

  useEffect(
    () => () => {
      requestGenerationRef.current += 1
    },
    [],
  )

  function invalidateInput() {
    requestGenerationRef.current += 1
    setResult(null)
    setLoading(false)
    setError(null)
  }

  async function handleTryon(): Promise<void> {
    if (loading || !personImage || !garmentImage) return
    const generation = ++requestGenerationRef.current
    setResult(null)
    setLoading(true)
    setError(null)
    try {
      const r = await directTryon(personImage, garmentImage, category)
      if (generation !== requestGenerationRef.current) return
      setResult(r)
    } catch (e: unknown) {
      if (generation !== requestGenerationRef.current) return
      setError(e instanceof Error ? e.message : '试穿失败')
      setResult(null)
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false)
    }
  }

  return (
    <div className="glass-card p-3" style={{ borderColor: '#34d399' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">👗</span>
        <h3 className="text-sm font-semibold" style={{ color: '#34d399' }}>
          虚拟试穿
        </h3>
      </div>
      <div className="space-y-2">
        <p className="text-xs" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
          人物与衣服图片会私有保存；仅部署启用外部试穿时，才把必要图片提供给外部服务，未启用则返回人物原图。
          删除档案仅清理无其他记录引用的文件，支付凭证、已付费报告及其复读依据保留，清理失败可重试。
        </p>
        <div className="text-xs">
          <label className="block mb-1" style={{ color: 'var(--muted)' }}>
            人物照片
          </label>
          <input
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              invalidateInput()
              // 本机先挡一道：gif/heic/超 10MB 传上去也是被后端 400 打回，还白占一次试穿限流额度
              const err = file ? checkPickedImage(file, '人物照片') : null
              if (err) setError(err)
              setPersonImage(err ? null : file)
            }}
            disabled={loading}
            className="form-input text-xs"
            style={{ padding: '4px' }}
          />
        </div>
        <div className="text-xs">
          <label className="block mb-1" style={{ color: 'var(--muted)' }}>
            衣服照片
          </label>
          <input
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              invalidateInput()
              const err = file ? checkPickedImage(file, '衣服照片') : null
              if (err) setError(err)
              setGarmentImage(err ? null : file)
            }}
            disabled={loading}
            className="form-input text-xs"
            style={{ padding: '4px' }}
          />
        </div>
        <div className="text-xs">
          <label className="block mb-1" style={{ color: 'var(--muted)' }}>
            衣服类别
          </label>
          <select
            value={category}
            onChange={(e) => {
              invalidateInput()
              setCategory(e.target.value)
            }}
            disabled={loading}
            className="form-select text-xs"
            style={{ padding: '6px 10px' }}
          >
            {TRYON_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleTryon}
          disabled={loading || !personImage || !garmentImage}
          className="gradient-btn text-xs w-full py-2"
        >
          {loading ? (
            <span
              role="status"
              aria-live="polite"
              className="flex items-center justify-center gap-2"
            >
              <span className="spinner" style={{ width: '12px', height: '12px' }}></span>
              试穿生成中...
            </span>
          ) : (
            '✨ 生成试穿效果'
          )}
        </button>
        {error && (
          <div className="text-xs" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {result && (
          <div className="mt-2">
            <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>
              {result.degraded ? '原图（未生成试穿效果）：' : '试穿效果：'}
            </div>
            {result.degraded && (
              <div className="text-xs mb-2" style={{ color: 'var(--warning)', lineHeight: 1.6 }}>
                试穿模型未开通，下面这张就是你上传的人物照片，不是换装效果。
              </div>
            )}
            {/* saved=false 是后端如实带回的：图已经给你了，但这次没写进历史记录 */}
            {result.saved === false && (
              <div className="text-xs mb-2" style={{ color: 'var(--warning)', lineHeight: 1.6 }}>
                这张图能看，但没能存进你的试穿记录，下次进来找不到它。
              </div>
            )}
            <img
              src={result.result_url}
              alt={result.degraded ? '人物原图（未生成试穿效果）' : '虚拟试穿结果'}
              style={{
                width: '100%',
                borderRadius: '8px',
                border: '1px solid var(--line)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
