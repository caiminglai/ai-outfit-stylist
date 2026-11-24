import type { RefObject } from 'react'
import { WARDROBE_CATEGORIES, btnStyle, getWardrobeCategoryLabel } from '../CabinetConstants'
import { UPLOAD_ACCEPT } from '../../lib/imagePick'
import { sameOriginImage } from './imageSrc'
import { WARDROBE_FORM_DEFAULT } from './formDefault'

type WardrobeForm = typeof WARDROBE_FORM_DEFAULT

export interface WardrobeFiltersProps {
  stats: {
    total: number
    byCategory: Record<string, number>
    byColor: Array<[string, number]>
    avgPrice: number | null
  }
  scanValue: string
  onScanValueChange: (value: string) => void
  onScan: (value: string) => void
  scanBusy: boolean
  onAdd: () => void
  showPhotoUpload: boolean
  photoInputRef: RefObject<HTMLInputElement | null>
  photoUploading: boolean
  onPhotoUpload: (file: File) => void
  compact?: boolean
  showAdd: boolean
  editing: boolean
  form: WardrobeForm
  onFormChange: (patch: Partial<WardrobeForm>) => void
  onSubmit: () => void
  onCloseForm: () => void
  submitting: boolean
}

const FIT_TYPE_CATEGORIES = ['top', 'outerwear', 'dress']
const FIT_TYPE_OPTIONS = ['修身', '合身', '宽松', '廓形']

export function WardrobeFilters({
  stats,
  scanValue,
  onScanValueChange,
  onScan,
  scanBusy,
  onAdd,
  showPhotoUpload,
  photoInputRef,
  photoUploading,
  onPhotoUpload,
  compact,
  showAdd,
  editing,
  form,
  onFormChange,
  onSubmit,
  onCloseForm,
  submitting,
}: WardrobeFiltersProps) {
  const pillCls = 'pill-tag'
  const fitTypeRequired = FIT_TYPE_CATEGORIES.includes(form.category)

  return (
    <>
      {/* 顶部状态栏 */}
      <div
        className="glass-card p-3 mb-3"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}
      >
        <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: '13px' }}>
          共 {stats.total} 件
        </span>
        {Object.entries(stats.byCategory).map(([cat, count]) => (
          <span key={cat} className={pillCls}>
            {getWardrobeCategoryLabel(cat)} {count}
          </span>
        ))}
        {stats.avgPrice != null && (
          <span className={pillCls} style={{ marginLeft: 'auto' }}>
            均价 ¥{stats.avgPrice}
          </span>
        )}
      </div>

      {/* 色彩洞察（借鉴 AI衣橱：颜色比例看板） */}
      {stats.byColor.length > 0 && (
        <div className="glass-card p-3 mb-3">
          <div className="text-xs font-semibold mb-2" style={{ color: 'var(--accent)' }}>
            🎨 色彩构成
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.byColor.map(([color, count]) => {
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
              return (
                <div key={color} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-full border"
                    style={{
                      backgroundColor: color.startsWith('#') ? color : '#ccc',
                      borderColor: 'var(--line)',
                    }}
                  />
                  <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {color} {pct}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 扫码录入（2026-10-20 第五阶段·第一步「门店扫码快速录入」）。
          键盘式扫码枪＝模拟键盘敲一串字符再自动按回车 ⇒ 只吃 Enter 一个动作就够，
          手打吊牌编号再回车走同一条路。查完三种结果都会说一句话，不静默。 */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
        <input
          className="form-input"
          style={{ flex: 1 }}
          placeholder="扫码枪扫条码 / 手打吊牌编号"
          value={scanValue}
          autoComplete="off"
          onChange={(e) => onScanValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onScan(scanValue)
          }}
        />
        <button className="ghost-btn" onClick={() => onScan(scanValue)} disabled={scanBusy}>
          {scanBusy ? <span className="spinner" /> : '查'}
        </button>
      </div>

      {/* 添加按钮 */}
      <button
        className="gradient-btn"
        style={{ width: '100%', ...btnStyle(compact) }}
        onClick={onAdd}
      >
        + 添加衣物
      </button>

      {/* 拍照上传（AI 识别） */}
      {showPhotoUpload && (
        <>
          <input
            ref={photoInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onPhotoUpload(file)
              e.target.value = ''
            }}
          />
          <button
            className="ghost-btn"
            style={{ width: '100%', ...btnStyle(compact), marginTop: '8px' }}
            disabled={photoUploading}
            onClick={() => photoInputRef.current?.click()}
          >
            {photoUploading ? <span className="spinner" /> : '📷 拍照上传'}
          </button>
        </>
      )}

      {/* 添加表单弹窗 */}
      {showAdd && (
        <div
          className="glass-card p-3 mt-3 animate-fade-in"
          style={{ borderColor: 'var(--accent)' }}
        >
          <div className="section-title">{editing ? '修改衣物' : '添加衣物'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              className="form-input"
              placeholder="名称"
              value={form.name}
              onChange={(e) => onFormChange({ name: e.target.value })}
            />
            <select
              className="form-select"
              value={form.category}
              onChange={(e) => onFormChange({ category: e.target.value })}
            >
              {WARDROBE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              className="form-input"
              placeholder="颜色"
              value={form.color}
              onChange={(e) => onFormChange({ color: e.target.value })}
            />
            {/* 版型（fit_type，10-19 第三阶段·模块一）：上衣/外套/连衣裙**必选**这一档。
                量不了软尺的人靠它把松量估出来（后端按区间中值估、覆盖率只按半格计），
                所以它是必填项，而下面的实测四格反而是选填。
                老的 fit_style（合体/宽松）从这一轮起退役成只读展示标签，表单不再产生它。 */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <select
                className="form-select"
                style={{ flex: 1 }}
                value={form.fit_type}
                onChange={(e) => onFormChange({ fit_type: e.target.value })}
              >
                <option value="">
                  {fitTypeRequired ? '版型（必选）' : '版型（这一类不需要）'}
                </option>
                {FIT_TYPE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                className="form-select"
                style={{ flex: 1 }}
                value={form.fabric_weight}
                onChange={(e) => onFormChange({ fabric_weight: e.target.value })}
              >
                <option value="">面料厚薄（选填）</option>
                <option value="薄">薄</option>
                <option value="中">中</option>
                <option value="厚">厚</option>
              </select>
            </div>
            <select
              className="form-select"
              value={form.pattern}
              onChange={(e) => onFormChange({ pattern: e.target.value })}
            >
              <option value="">条纹方向（选填，纯色就不选）</option>
              <option value="竖条">竖条</option>
              <option value="横条">横条</option>
            </select>
            {/* 成衣实测四格（10-19 第二阶段「最后一公里」）：量到了就按实测打分，优先级高于版型档。
                第三阶段把它折进"高级选项"——不挡人，量了更准；空着＝没量＝那一维不进分，系统不替你猜。 */}
            <details style={{ margin: '4px 0' }}>
              <summary style={{ fontSize: '12px', color: 'var(--muted)', cursor: 'pointer' }}>
                高级选项（选填）：用软尺量一下这四格，比只选版型更准
              </summary>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '6px' }}>
                衣服平铺量：肩宽＝两肩缝点直线距离，胸围＝袖窿下方一周最宽处，
                衣长＝肩颈点到下摆，腰头高＝腰头缝带自身高度（没有就填 0）
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="肩宽 cm"
                  value={form.shoulder_cm}
                  onChange={(e) => onFormChange({ shoulder_cm: e.target.value })}
                />
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="胸围 cm"
                  value={form.bust_cm}
                  onChange={(e) => onFormChange({ bust_cm: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="衣长 cm"
                  value={form.length_cm}
                  onChange={(e) => onFormChange({ length_cm: e.target.value })}
                />
                <input
                  className="form-input"
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  placeholder="腰头高 cm（无腰头填 0）"
                  value={form.waistband_cm}
                  onChange={(e) => onFormChange({ waistband_cm: e.target.value })}
                />
              </div>
            </details>
            <input
              className="form-input"
              placeholder="风格标签（逗号分隔）"
              value={form.style_tags}
              onChange={(e) => onFormChange({ style_tags: e.target.value })}
            />
            <input
              className="form-input"
              placeholder="季节标签（逗号分隔）"
              value={form.season_tags}
              onChange={(e) => onFormChange({ season_tags: e.target.value })}
            />
            <input
              className="form-input"
              placeholder="场合标签（逗号分隔）"
              value={form.occasion_tags}
              onChange={(e) => onFormChange({ occasion_tags: e.target.value })}
            />
            <input
              className="form-input"
              placeholder="价格"
              type="number"
              value={form.price}
              onChange={(e) => onFormChange({ price: e.target.value })}
            />
            {/* 条码／店内编号（第五阶段·第一步）。扫出来的这一格可以被手改：
                吊牌码与店内自编码常常两套并存，锁死改不了就成死账。清空＝这件不算扫来的。 */}
            <input
              className="form-input"
              placeholder="条码 / 店内编号（扫码枪扫一下会自动填）"
              value={form.sku}
              onChange={(e) => onFormChange({ sku: e.target.value })}
            />
            {/* 照片这一格（第五阶段·第一步「只存图」）：上面点了「📷 拍照上传」就有地址、
                预览出来让人核对拍的是不是这件；没有就只挂一句提示。⛔ 这里不做识别，
                地址是后端 /uploads/xxx.jpg 原样回的那串。外部地址只当文本摊出来、不让浏览器去取。 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {sameOriginImage(form.image_url) ? (
                <img
                  src={form.image_url}
                  alt="这件衣物的照片"
                  className="w-11 h-11 rounded-lg object-cover flex-shrink-0"
                  style={{ border: '1px solid var(--line)' }}
                />
              ) : form.image_url ? (
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>外部地址不显示</span>
              ) : null}
              <span style={{ fontSize: '12px', color: 'var(--muted)', flex: 1 }}>
                {form.image_url
                  ? '照片已挂在这一件上'
                  : '没拍照：要带照片就点上方「📷 拍照上传」（只存图，系统不识别）'}
              </span>
              {form.image_url && (
                <button
                  className="ghost-btn"
                  style={{ padding: '4px 8px', fontSize: '11px' }}
                  onClick={() => onFormChange({ image_url: '' })}
                >
                  不挂这张
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="gradient-btn"
                style={{ flex: 1, ...btnStyle(compact) }}
                onClick={onSubmit}
                disabled={submitting}
              >
                {editing ? '保存修改' : '确认添加'}
              </button>
              <button
                className="ghost-btn"
                style={{ flex: 1, ...btnStyle(compact) }}
                onClick={onCloseForm}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
