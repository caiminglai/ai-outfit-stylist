/**
 * 后台「编程水平与独立路线」页的结构与渲染守卫（2026-10-22 第五十九轮新建）。
 *
 * 为什么要钉住它：这一页是**给站长自己用的判据表**，内容是数据不是接口
 * （`backend/static/admin/admin-skill.js` 顶部的 SKILL_AXES / SKILL_STAGES），
 * 而 `backend/.prettierignore` 与 `backend/eslint.config.js` 都把 `static/`、`templates/`
 * 排除在门禁之外 ⇒ 这两处**没有任何一道门会红**。少一条判据，页面上那句
 * "S0→S6 合计约 24 小时"就会悄悄变成假话。这里补的就是这道门：
 *   ① `admin.html` 必须真的把这个 section、这两个 id、这份 script 挂上（挂漏了页面是空白）；
 *   ② 十条轴 / 八段路线 / 九个动作 / 六道自测题 的分母与字段不许缺；
 *   ③ 页面里那句"合计约 24 小时"必须由 S0~S6 的小时数**当场加出来**，改了路线就得同步改文案；
 *   ④ 在假 DOM 上真渲染一遍：不抛错、起手那个 class="loading" 被清掉、
 *      就地刷新要用的 data-axis-readout / data-stage-bar / data-stage-count 全在场、
 *      点击与勾选的处理里不许出现整页重排；
 *   ⑤ 正文里不许出现 Markdown 的 **粗体** 与 `行内代码`（本页 innerHTML 直出、没有渲染器，
 *      路径 glob 里的星号除外——它在 <code> 里）。
 *
 * ⚠️ ④ 用的是假 `document` 与假 `escapeHtml`（真身在 admin-utils.js），
 *    所以这一条只证明"逻辑跑得通、内容出得来"，⛔ 不等于后台真点开看见了 ——
 *    真浏览器那一次记在 `docs/依据/22` §12.11。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ADMIN_JS = path.join(__dirname, '..', 'static', 'admin', 'admin-skill.js')
const ADMIN_HTML = path.join(__dirname, '..', 'templates', 'admin.html')

// require 得到的是文件末尾那段 CommonJS 导出（浏览器里 module 不存在 ⇒ 同份文件两种用法）
const skill = require(ADMIN_JS)

test('admin.html 把路线页的入口挂齐了（导航按钮＋侧栏＋section＋两个 id＋脚本标签）', () => {
  const html = fs.readFileSync(ADMIN_HTML, 'utf-8')
  const needles = [
    'data-section="skill"',
    'data-nav="skill"',
    'id="section-skill"',
    'id="skill-body"',
    '<script src="/static/admin/admin-skill.js"></script>',
  ]
  for (const n of needles) {
    assert.ok(html.includes(n), `admin.html 缺 ${n} —— 少了它这一页在后台根本点不开`)
  }
  // 脚本必须在 utils 之后（它用 escapeHtml / showToast）。
  // ⚠️ 只比 <script> 标签的位置：本文件里 'admin-skill.js' 这个字符串还出现在
  //    section 的注释和加载顺序注释里，拿裸字符串比会先撞上注释 ⇒ 假红（本轮实测踩过）。
  const tagAt = (f) => html.indexOf(`<script src="/static/admin/${f}"></script>`)
  assert.ok(
    tagAt('admin-utils.js') >= 0 && tagAt('admin-skill.js') >= 0,
    '两份脚本标签之一没写成标准形式',
  )
  assert.ok(
    tagAt('admin-utils.js') < tagAt('admin-skill.js'),
    'admin-skill.js 的 <script> 标签必须排在 admin-utils.js 后面',
  )
})

test('十条轴：分母恰好 10，指挥 4 条 / 动手 6 条，每轴都有证据与非空的注', () => {
  assert.strictEqual(skill.SKILL_AXES.length, 10)
  const groups = { 指挥: 0, 动手: 0 }
  const keys = new Set()
  for (const ax of skill.SKILL_AXES) {
    assert.ok(ax.key && !keys.has(ax.key), `轴 key 缺失或重复: ${ax.key}`)
    keys.add(ax.key)
    assert.ok(ax.name, `${ax.key} 缺轴名`)
    assert.ok(
      Object.prototype.hasOwnProperty.call(groups, ax.group),
      `${ax.key} 的 group 只能是指挥/动手`,
    )
    groups[ax.group] += 1
    assert.ok(ax.ai >= 0 && ax.ai <= 4, `${ax.key} 的 ai=${ax.ai} 越出 0~4 刻度`)
    // 证据是这张表的全部价值：没有原始行为的轴不许出现在页面上
    assert.ok(ax.evidence && ax.evidence.length >= 20, `${ax.key} 的证据太短，等于没证据`)
  }
  assert.strictEqual(groups['指挥'], 4)
  assert.strictEqual(groups['动手'], 6)
  assert.strictEqual(skill.SKILL_SCALE.length, 5, '刻度必须是 0~4 五档')
})

test('八段路线：S0~S7 顺序不跳号，每段步数≥3 且判据/卡住非空', () => {
  const ids = skill.SKILL_STAGES.map((s) => s.id)
  assert.deepStrictEqual(ids, ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])
  for (const st of skill.SKILL_STAGES) {
    assert.ok(
      Array.isArray(st.steps) && st.steps.length >= 3,
      `${st.id} 步数少于 3，不构成一段练习`,
    )
    for (const s of st.steps) {
      assert.ok(s.t && s.t.length > 4, `${st.id} 有一步没有正文`)
      if (s.c) assert.strictEqual(typeof s.c, 'string', `${st.id} 的命令字段必须是字符串`)
    }
    assert.ok(st.pass && st.pass.length >= 15, `${st.id} 的通过判据太短——判据要能当场验`)
    assert.ok(st.goal, `${st.id} 缺目标`)
    assert.ok(st.stuck, `${st.id} 缺"卡住怎么办"——这一段是整个路线的无 AI 部分`)
    assert.ok(st.hours, `${st.id} 缺时间`)
  }
  assert.strictEqual(skill.SKILL_TOOLS.length, 9, '无 AI 动作清单固定 9 条')
  assert.strictEqual(skill.SKILL_QUIZ.length, 6, '自测题固定 6 道')
  for (const q of skill.SKILL_QUIZ) {
    assert.ok(q.q && q.a, '自测题必须题答成对')
  }
})

test('页面里那句「S0→S6 合计约 24 小时」当场由路线数据加出来（改了路线就得改文案）', () => {
  const sum = skill.SKILL_STAGES.filter((s) => s.id !== 'S7').reduce((acc, s) => {
    const n = Number(String(s.hours).match(/\d+/))
    assert.ok(Number.isFinite(n), `${s.id} 的小时数没写成「N 小时」，加不出来: ${s.hours}`)
    return acc + n
  }, 0)
  assert.strictEqual(sum, 24, `S0~S6 实际加出来是 ${sum} 小时，与页面文案里的 24 不符`)
  const js = fs.readFileSync(ADMIN_JS, 'utf-8')
  assert.ok(js.includes('合计约 24 小时'), '页面文案里的"24 小时"字样不见了——要么改文案要么改路线')
})

test('假 DOM 上真渲染一遍：不抛错、就地更新所需的钩子在场、导出文本成形', () => {
  const store = {}
  const rendered = { html: '' }
  const el = {
    _html: '',
    _cls: 'loading',
    set innerHTML(v) {
      rendered.html = v
    },
    get innerHTML() {
      return rendered.html
    },
    set className(v) {
      rendered.cls = v
    },
    get className() {
      return this._cls
    },
    querySelectorAll() {
      return []
    },
    querySelector() {
      return null
    },
  }
  const ctx = {
    console,
    module: undefined,
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    showToast: () => {},
    window: {
      localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => {
          store[k] = String(v)
        },
      },
    },
    document: {
      readyState: 'complete',
      getElementById: (id) => (id === 'skill-body' ? el : null),
      addEventListener: () => {
        throw new Error('readyState=complete 时不该再挂 DOMContentLoaded')
      },
    },
  }
  vm.createContext(ctx)
  vm.runInContext(fs.readFileSync(ADMIN_JS, 'utf-8'), ctx, { filename: ADMIN_JS })

  const out = rendered.html
  assert.ok(out.length > 3000, `渲染只有 ${out.length} 字符，页面是空的`)
  for (const st of skill.SKILL_STAGES) {
    assert.ok(out.includes(st.id), `渲染结果里没有 ${st.id} 这一段`)
  }
  assert.ok(out.includes('通过判据'), '渲染结果里判据区块没出来')
  assert.ok(out.includes('诚实边界'), '开头那段"这评估不是实测"的诚实标注没出来')
  assert.ok(out.includes('证据：'), '轴表里的"证据"前缀没出来')
  // 自评旋钮：十条轴 × 五档按钮
  assert.strictEqual(out.split('data-axis=').length - 1, 50, '自评按钮应该是 10 轴 × 5 档 = 50 颗')
  // 步骤勾选框：全仓总步数
  const totalSteps = skill.SKILL_STAGES.reduce((a, s) => a + s.steps.length, 0)
  assert.strictEqual(out.split('data-step=').length - 1, totalSteps, '勾选框数与步数对不上')

  // ⑤ 起手那个 class="loading" 必须被清掉：admin.css 的 .loading 规则（现量 :257）是
  //    { color: muted; text-align: center; padding: 40px } 排版类，不清就整页居中变灰
  //    （10-22 真浏览器第一次点验实测到：innerHTML 已灌 36800 字符、className 仍是 loading）。
  assert.strictEqual(
    rendered.cls,
    '',
    '渲染后没把 .loading 排版类清掉（admin-data.js:327 的既有写法是 root.className = ""）',
  )

  // ⑥ 就地更新要有的三个钩子：十条轴的读数格、八段的进度条与读数
  for (const ax of skill.SKILL_AXES) {
    assert.ok(
      out.includes(`data-axis-readout="${ax.key}"`),
      `轴 ${ax.key} 缺 data-axis-readout，点完没法就地刷新`,
    )
  }
  for (const st of skill.SKILL_STAGES) {
    assert.ok(out.includes(`data-stage-row="${st.id}"`), `${st.id} 缺 data-stage-row`)
    assert.ok(out.includes(`data-stage-bar="${st.id}"`), `${st.id} 缺 data-stage-bar`)
    assert.ok(out.includes(`data-stage-count="${st.id}"`), `${st.id} 缺 data-stage-count`)
  }

  // ⑦ 点一颗旋钮／勾一步不许重建整页 innerHTML（否则跳滚动、丢焦点、闪一下）。
  //    从 skillWire 到导出按钮之间＝两条处理函数的正常路径，skillRefresh() 只准出现在
  //    「数据里找不到这一轴/这一段」的兜底分支（找不到钩子的兜底在 skillPatch* 里，不在这段）。
  const js = fs.readFileSync(ADMIN_JS, 'utf-8')
  const from = js.indexOf('function skillWire')
  const to = js.indexOf('var ex = root.querySelector')
  assert.ok(from >= 0 && to > from, 'skillWire 的结构变了，这段区间切不出来')
  const region = js.slice(from, to)
  assert.strictEqual(
    region.split('skillRefresh()').length - 1,
    2,
    '自评旋钮/步骤勾选的处理里 skillRefresh() 必须恰好 2 次（两条兜底），多了就是又改成整页重排',
  )
  assert.strictEqual(
    (region.match(/if \(!(ax|st)\) \{\n\s*skillRefresh\(\)/g) || []).length,
    2,
    '那两次 skillRefresh() 必须都写在「找不到这一轴/这一段」的兜底分支里',
  )
  assert.ok(
    region.includes('skillPatchAxis(root') && region.includes('skillPatchStage(root'),
    '处理函数没走就地刷新助手（skillPatchAxis / skillPatchStage）',
  )

  // ⑧ 本页是 innerHTML 直出、没有 markdown 渲染器 ⇒ 正文里不许有 **星号** 或反引号
  //    （10-22 第一次点验实测到：46 行数据是按 Markdown 写的，页面上原样显出星号）。
  //    路径 glob（backend/**/*.js、app/**）本来就该带星号，它已经在 <code>…</code> 里 ⇒ 判前剥掉。
  const bare = out.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '')
  assert.strictEqual(bare.split('**').length - 1, 0, '正文里有 Markdown 粗体星号，页面会原样显示')
  assert.strictEqual(
    bare.split(String.fromCharCode(96)).length - 1,
    0,
    '正文里有 Markdown 反引号，页面会原样显示',
  )
  assert.ok(
    out.includes('<code>'),
    '数据里的行内代码标签没了：要么全改回纯文本，要么这条判据该重写',
  )

  // 导出文本（进度为空时也要成形状）
  const exported = vm.runInContext('skillExportText()', ctx)
  assert.ok(exported.startsWith('# 我的编程水平与独立路线进度'), '导出文本标题变了')
  assert.ok(exported.includes('- S0 环境自证') && exported.includes('十条轴'), '导出文本缺段落')
})
