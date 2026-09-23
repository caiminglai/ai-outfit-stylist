/**
 * 虚拟试穿卡片组件
 *
 * 上传人物照片和衣服照片，选择衣服类别后调用虚拟试穿接口，展示试穿结果
 */
import { useState } from 'react';
import type { TryonResult } from '../../types';
import { directTryon } from '../../api';

/** 虚拟试穿类别 */
const TRYON_CATEGORIES: { value: string; label: string }[] = [
  { value: 'top', label: '上衣' },
  { value: 'bottom', label: '下装' },
  { value: 'dress', label: '连衣裙' },
  { value: 'outerwear', label: '外套' },
];

export default function TryonCard() {
  const [personImage, setPersonImage] = useState<File | null>(null);
  const [garmentImage, setGarmentImage] = useState<File | null>(null);
  const [category, setCategory] = useState<string>('top');
  const [result, setResult] = useState<TryonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTryon(): Promise<void> {
    if (!personImage || !garmentImage) return;
    setLoading(true);
    setError(null);
    try {
      const r = await directTryon(personImage, garmentImage, category);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '试穿失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card p-3" style={{ borderColor: '#34d399' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">👗</span>
        <h3 className="text-sm font-semibold" style={{ color: '#34d399' }}>虚拟试穿</h3>
      </div>
      <div className="space-y-2">
        <div className="text-xs">
          <label className="block mb-1" style={{ color: 'var(--muted)' }}>人物照片</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setPersonImage(e.target.files?.[0] ?? null)}
            className="form-input text-xs"
            style={{ padding: '4px' }}
          />
        </div>
        <div className="text-xs">
          <label className="block mb-1" style={{ color: 'var(--muted)' }}>衣服照片</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setGarmentImage(e.target.files?.[0] ?? null)}
            className="form-input text-xs"
            style={{ padding: '4px' }}
          />
        </div>
        <div className="text-xs">
          <label className="block mb-1" style={{ color: 'var(--muted)' }}>衣服类别</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="form-select text-xs"
            style={{ padding: '6px 10px' }}
          >
            {TRYON_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleTryon}
          disabled={loading || !personImage || !garmentImage}
          className="gradient-btn text-xs w-full py-2"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="spinner" style={{ width: '12px', height: '12px' }}></span>
              试穿生成中...
            </span>
          ) : '✨ 生成试穿效果'}
        </button>
        {error && (
          <div className="text-xs" style={{ color: 'var(--danger)' }}>{error}</div>
        )}
        {result && (
          <div className="mt-2">
            <div className="text-xs mb-1" style={{ color: 'var(--muted)' }}>试穿效果：</div>
            <img
              src={result.result_url}
              alt="虚拟试穿结果"
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
  );
}
