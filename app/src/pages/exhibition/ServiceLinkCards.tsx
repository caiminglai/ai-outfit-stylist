// 11-03 大文件拆分轮：这一段从 ExhibitionHall.tsx 逐字搬来（1 个顶层声明，函数体一处未改）。
// ⛔ 对外入口不变：ExhibitionHall.tsx 仍旧默认导出那个组件，消费方的 import 写法一行不改。
import { Suspense, useState } from 'react'
import { AccountEntry } from './AccountEntry'
import { PaidReports } from './lazy'

// ============ 付款 / 创作者入驻卡片(仅模式选择页,不浮在3D展示层上)============
export function ServiceLinkCards({ onArchiveCleared }: { onArchiveCleared?: () => void }) {
  // 「我的报告」不开新页面（`App.tsx` 只有 `/` 一条真路由）：点开走覆盖层，同登录面板那套
  const [reportsOpen, setReportsOpen] = useState(false)
  const cards = [
    {
      href: '/pay.html',
      icon: '💳',
      title: '付款通道',
      sub: '在线付款 · 凭证提交',
      desc: '已选好服务?在这里付款并把付款凭证提交给我们核对.在线付款到账后,直接用下面那张「我的报告」领这一份细账.',
    },
    {
      href: '/creator.html',
      icon: '🎨',
      title: '创作者投稿与曝光',
      sub: '提交方案 · 审核展示 · 按热度曝光',
      desc: '上传你的搭配、化妆或推荐规则方案,审核通过后按市场推广度获得曝光.投稿目前只做展示,不涉及任何款项往来.',
    },
    {
      // 🔴 第十四阶段追加（他 10-22 的第三条指令：「给这个项目做个网页介绍……点一下就能跳转」）
      href: '/how-it-works.html',
      icon: '🧭',
      title: '这套系统是怎么造的',
      sub: '量化管线 · 依据分档 · 当前底数',
      desc: '讲清楚四件事:数据怎么量出来、规则从哪来、哪些结论有国标或论文撑着、哪些只是行业经验或命理体系.里面还写了库里现在的真实行数——样本薄我们就说薄.',
    },
  ]
  return (
    <div className="mt-4 space-y-3">
      {cards.map((c) => (
        <a
          key={c.href}
          href={c.href}
          className="block p-4"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
          }}
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{c.icon}</span>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {c.title}
              </h3>
              <p className="text-xs" style={{ color: '#b8c7d4' }}>
                {c.sub}
              </p>
            </div>
          </div>
          <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
            {c.desc}
          </p>
        </a>
      ))}

      {/* 第十二阶段·第一步：付款即交付的那一环。今天这句话第一次成立——
          到账后不用等人工，顾客自己在这层里领走这份细账（后端按订单号幂等，一单一份）。 */}
      <button
        onClick={() => setReportsOpen(true)}
        className="block w-full p-4 text-left"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          cursor: 'pointer',
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-2xl">📑</span>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              我的报告
            </h3>
            <p className="text-xs" style={{ color: '#b8c7d4' }}>
              付款即交付 · 可反复打开
            </p>
          </div>
        </div>
        <p className="text-xs" style={{ color: '#a8b8c4', lineHeight: '1.6' }}>
          到账后在这里领那一份深度细账:除了屏幕上这 8
          条,还列出参数与口径、排在名单之外的候选和交付回执,可以打印或存成文件.
        </p>
      </button>

      <AccountEntry onArchiveCleared={onArchiveCleared} />

      {reportsOpen && (
        <Suspense
          fallback={
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              加载我的报告…
            </div>
          }
        >
          <PaidReports onClose={() => setReportsOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
