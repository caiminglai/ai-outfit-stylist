// 11-03 大文件拆分轮：这一段从 ExhibitionHall.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：ExhibitionHall.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import { useEffect, useState } from 'react'
import { toast } from '../../utils/toastOnce'
import {
  deleteProfileArchive,
  getAccount,
  getProfileArchive,
  loginAccount,
  logoutAccount,
  registerAccount,
} from '../../api'
import type { AccountInfo, ProfileField } from '../../api'
import type { ProfileTag } from '../../types'
import { maskPhone } from './maskPhone'

// ============ 我的账号:登录 / 注册(覆盖在 3D 展示上,不跳页)============
export function AccountEntry({ onArchiveCleared }: { onArchiveCleared?: () => void }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<AccountInfo | null>(() => getAccount())
  /** 打开面板时读一次:后端把档案与草稿变成了中文清单,这里只负责列出来 */
  const [stored, setStored] = useState<{ fields: ProfileField[]; tags: ProfileTag[] } | null>(null)

  useEffect(() => {
    if (!open || !account || stored) return
    getProfileArchive()
      .then((res) => setStored({ fields: res.fields || [], tags: res.tags || [] }))
      .catch(() => setStored({ fields: [], tags: [] }))
  }, [open, account, stored])

  const panelStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--line)',
    borderRadius: '12px',
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const next =
        tab === 'login'
          ? await loginAccount(phone.trim(), password)
          : await registerAccount(phone.trim(), password, nickname.trim() || undefined)
      const { merged, ...accountInfo } = next
      setAccount(accountInfo)
      setOpen(false)
      setPassword('')
      const movedCount = merged ? Object.values(merged.moved).reduce((a: number, b) => a + b, 0) : 0
      const base = tab === 'login' ? '已登录' : '注册成功,已为你保留这份身份'
      const withData = movedCount
        ? `${base};之前游客期间攒的 ${movedCount} 条记录已并入本账号${
            merged && merged.dropped
              ? `,另有 ${merged.dropped} 条与账号里已有的重复,以已有的为准`
              : ''
          }`
        : base
      toast.success(withData)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  /** 兑现隐私承诺:可随时删掉本机档案与属于本人的全部记录(含上传的照片文件) */
  const removeArchive = async () => {
    if (busy) return
    if (
      !window.confirm(
        '将删除你存下的身体档案、面容档案、没点生成的表单草稿、形象标签、点过的建议评价、推荐与搭配记录、试穿结果,以及上传过的照片和它在服务器上的文件.删除后无法恢复,确定继续?',
      )
    )
      return
    setBusy(true)
    try {
      const r = await deleteProfileArchive()
      const deleted = [
        `身体档案 ${r.body} 份`,
        `面容档案 ${r.face} 份`,
        `表单草稿 ${r.draft} 份`,
        `形象标签 ${r.tags} 条`,
        `建议评价 ${r.feedback} 条`,
        `推荐记录 ${r.logs} 条`,
        `搭配记录 ${r.records} 条`,
        `试穿结果 ${r.tryon} 条`,
        `照片 ${r.photos} 张`,
      ].join('、')
      toast.success(
        `已删除:${deleted}${r.files ? `,同时清掉 ${r.files} 个文件` : ''}${r.files_failed ? `;${r.files_failed} 个文件没删掉,请联系管理员` : ''}`,
      )
      setOpen(false)
      setStored(null)
      // 后端已经把身体档案／标签全删了，上层内存里那三份预填源必须一起清掉：
      // 两个表单的预填取的是 `profile || archiveProfile`，不清就等于刚点完"已删除"，
      // 再进表单还是带着那份被删掉的身体数据，用户点一次生成又把它存回库里。
      // 这三份 state 在 ExhibitionHall 上，AccountEntry 够不着，只能回上去让上层清。
      onArchiveCleared?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败,请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setError('')
          setOpen(true)
        }}
        className="block p-4 w-full text-left"
        style={panelStyle}
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">👤</span>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              {account ? `已登录:${maskPhone(account.phone)}` : '我的账号'}
            </h3>
            <p className="text-xs" style={{ color: '#b8c7d4' }}>
              {account ? '换浏览器或换设备后,登录同一个手机号就能找回' : '登录 · 注册'}
            </p>
          </div>
        </div>
        <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
          {account
            ? '你提交的作品、衣橱和推荐记录都挂在这个手机号上,不会再随浏览器变化.'
            : '不登录也能逛和试用;注册后方案与作品会一直跟着这个手机号,投稿审核结果也发到这儿.'}
        </p>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 flex items-end sm:items-center sm:justify-center"
          style={{ zIndex: 100, background: 'rgba(0,0,0,0.65)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-sm p-5"
            style={{
              background: '#141b26',
              border: '1px solid var(--line)',
              borderRadius: '14px 14px 0 0',
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
                我的账号
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="text-xs px-2 py-1"
                style={{
                  color: 'var(--muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                关闭
              </button>
            </div>

            {account ? (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: 'var(--text)' }}>
                  当前:{maskPhone(account.phone)}
                  {account.nickname ? ` · ${account.nickname}` : ''}
                </p>
                <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
                  退出后这台设备回到游客身份,之前的方案与作品仍在账号里,重新登录即可继续.
                </p>
                <button
                  onClick={() => {
                    logoutAccount()
                    setAccount(null)
                    setOpen(false)
                    toast('已退出登录')
                  }}
                  className="w-full py-2 text-sm"
                  style={{ ...panelStyle, color: 'var(--text)', cursor: 'pointer' }}
                >
                  退出登录
                </button>
                <div className="p-3 text-xs" style={{ ...panelStyle, lineHeight: '1.8' }}>
                  <p className="font-semibold" style={{ color: 'var(--text)' }}>
                    我存的信息
                  </p>
                  {!stored && <p style={{ color: 'var(--muted)' }}>读取中…</p>}
                  {stored && stored.fields.length === 0 && stored.tags.length === 0 && (
                    <p style={{ color: 'var(--muted)' }}>
                      还没替你记住任何东西.填一次点生成,或只在表单里改几项,都会自动存下来.
                    </p>
                  )}
                  {stored && (stored.fields.length > 0 || stored.tags.length > 0) && (
                    <div className="mt-1" style={{ maxHeight: '170px', overflowY: 'auto' }}>
                      {stored.fields.map((f) => (
                        <div key={f.key} style={{ color: '#a8b8c4' }}>
                          <span style={{ color: 'var(--muted)' }}>{f.label}：</span>
                          {f.value}
                        </div>
                      ))}
                      {stored.tags.map((t) => (
                        <div key={t.key} style={{ color: '#a8b8c4' }}>
                          <span style={{ color: 'var(--muted)' }}>
                            {t.label.includes('（算出）') ? t.label : `${t.label}（算出）`}：
                          </span>
                          {t.value}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
                  下面这项删除的是我们替你记住的身体与面容档案、以及挂在账号下的推荐记录,删完仍可随时重新填写试用.
                </p>
                <button
                  onClick={removeArchive}
                  disabled={busy}
                  className="w-full py-2 text-sm"
                  style={{
                    ...panelStyle,
                    color: 'var(--danger)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  删除我的形象档案与记录
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex" style={panelStyle}>
                  {(['login', 'register'] as const).map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        setTab(key)
                        setError('')
                      }}
                      className="flex-1 py-2 text-sm"
                      style={{
                        background: tab === key ? 'rgba(255,255,255,0.06)' : 'transparent',
                        border: 'none',
                        borderRadius: '12px',
                        color: tab === key ? 'var(--text)' : 'var(--muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {key === 'login' ? '登录' : '注册'}
                    </button>
                  ))}
                </div>

                <input
                  className="form-input w-full"
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="手机号"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                />
                <input
                  className="form-input w-full"
                  type="password"
                  maxLength={64}
                  placeholder={tab === 'login' ? '密码' : '设一个密码,至少 6 位'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {tab === 'register' && (
                  <input
                    className="form-input w-full"
                    maxLength={40}
                    placeholder="昵称(可选,展示在创作者广场)"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                )}
                {tab === 'login' && (
                  <p className="text-xs" style={{ color: 'var(--muted)', lineHeight: '1.6' }}>
                    忘记密码?找门店管理员或本站管理员,报手机号即可重置;你的档案、衣橱和作品都不会受影响.
                  </p>
                )}

                <button
                  onClick={submit}
                  disabled={busy || !phone || !password}
                  className="w-full py-2.5 text-sm font-semibold"
                  style={{
                    background: 'var(--accent)',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#0d1117',
                    cursor: busy || !phone || !password ? 'not-allowed' : 'pointer',
                    opacity: busy || !phone || !password ? 0.5 : 1,
                  }}
                >
                  {busy ? '处理中…' : tab === 'login' ? '登录' : '注册并登录'}
                </button>

                {error && (
                  <p className="text-xs" style={{ color: '#f87171' }}>
                    {error}
                  </p>
                )}
                <p className="text-xs" style={{ color: 'var(--muted)', lineHeight: '1.6' }}>
                  手机号只用来找回你自己的数据和联系你付款,不会展示给别人.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
