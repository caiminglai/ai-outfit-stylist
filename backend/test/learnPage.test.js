/**
 * 教程页 `/admin/learn`（`backend/templates/learn-to-code.html`）的守卫单测
 * （2026-10-22 第十四阶段·第一步新建）。
 *
 * 为什么必须单独有这么一份测试：`backend/.prettierignore:7-8` 与
 * `backend/eslint.config.js:12-13` 把 `static/`、`templates/` 整个排除在门禁之外 ⇒
 * 这份 HTML 里写错的行号、漏掉的课、跑不开的脚本，**没有一道门会红**。而这一页跟别的
 * 后台页不一样：它的卖点是"每一句都指着仓库里真实的文件与行号"。锚点一旦漂了，
 * 它就从教材变成误导——比没有更糟。这里补的就是这道门：
 *   ① 入口三件：路由 `/learn` 真的 sendFile 这份模板、`admin.html` 里那颗按钮真的指向它、
 *      `admin.css` 里真的有配套样式（少第三条 ⇒ 按钮在深色后台里像一行坏掉的纯文本）；
 *   ② 分母：用法 1 节＋11 课＋4 附录 = 16 个 section，目录 15 条锚点全部指得到，
 *      每课都有「目标」与至少一颗打卡框，30 个 data-k 不许重号；
 *   ③ **逐条核 loc 锚点**：文件在仓库里在场、行号不越过该文件的真实行数（这一条是本页的信用）；
 *   ④ ext（仓外路径）只判形状 ⛔ 不判在不在盘上——CI 在 Linux 上没有 E: 盘，判存在会造成假红；
 *   ⑤ 页面不许伸手要外网：无 <script src>、无外链 CSS、无 @import、无 fonts.gstatic；
 *      正文里出现的 http 只准是 127.0.0.1 的本机地址；
 *   ⑥ 在假 DOM 上真跑一遍页尾那段脚本：不抛错、进度读数按 30 颗算出来、
 *      localStorage 里的旧打卡能读回来、新勾一颗能写回去。
 *
 * ⚠️ ⑥ 用的是假 `document`，只证明"脚本跑得通、读数算得对"，⛔ 不等于真浏览器点过了 ——
 *    真浏览器那一次记在 `docs/依据/22` 的教程页那一节。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const REPO = path.join(__dirname, '..', '..')
const PAGE = path.join(__dirname, '..', 'templates', 'learn-to-code.html')
const ADMIN_HTML = path.join(__dirname, '..', 'templates', 'admin.html')
const ADMIN_JS = path.join(__dirname, '..', 'routes', 'admin.js')
const ADMIN_CSS = path.join(__dirname, '..', 'static', 'admin', 'admin.css')

// compose 在仓库外面（本机是 `E:/website/compose/`），本文件头第 15 行自己定的口径是
// "ext 只判形状 ⛔ 不判在不在盘上——CI 在 Linux 上没有 E: 盘，判存在会造成假红"。
// 所以这一档改成：路径可注入、不在场就老实 skip，绝不让 `readFileSync` 抛 ENOENT 冒充门禁红灯。
const COMPOSE_YML =
  process.env.STYLEAI_COMPOSE_YML || path.join(REPO, '..', 'compose', 'docker-compose.yml')
const COMPOSE_PRESENT = fs.existsSync(COMPOSE_YML)

const html = fs.readFileSync(PAGE, 'utf-8')

/** 把 <span class="loc|ext">…</span> 全部抠出来（去重后保序） */
function anchors(cls) {
  const out = []
  const re = new RegExp('<span class="' + cls + '">([^<]+)</span>', 'g')
  let m
  while ((m = re.exec(html))) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

/**
 * `backend/db/schema.sql:7-9` 这种串切成 [路径, 行号引用]。
 * ⚠️ 盘符不能当分隔符：`E:/website/...` 的第一个冒号左边只有一个字母，切了就等于
 *    把整条仓外路径读成 "E"（本轮第一版探针就在这儿把 19 条 ext 全报成"不是 E:/website 开头"）。
 */
function splitRef(a) {
  const m = /^(.*?):(\d+(?:-\d+)?)$/.exec(a)
  if (!m || /^[A-Za-z]$/.test(m[1])) return [a, '']
  return [m[1], m[2]]
}

const lineCountCache = new Map()
function lineCount(abs) {
  if (!lineCountCache.has(abs)) {
    lineCountCache.set(abs, fs.readFileSync(abs, 'utf-8').split(/\r?\n/).length)
  }
  return lineCountCache.get(abs)
}

test('入口三件：路由发得出这份模板、后台按钮指得到它、样式也配了', () => {
  const js = fs.readFileSync(ADMIN_JS, 'utf-8')
  assert.ok(
    js.includes(`router.get('/learn'`),
    'routes/admin.js 里没有 /learn 路由 —— 那 /admin/learn 会被 server.js:362 那道 /admin 兜底吃成 JSON 404',
  )
  assert.ok(
    js.includes("path.join(ADMIN_DIR, 'learn-to-code.html')"),
    'routes/admin.js 的 /learn 没指向 templates/learn-to-code.html',
  )

  const admin = fs.readFileSync(ADMIN_HTML, 'utf-8')
  const link = /<a class="([^"]*)" href="\/admin\/learn"[^>]*>/.exec(admin)
  assert.ok(link, 'admin.html 里没有指向 /admin/learn 的那颗按钮')
  // ⛔ 按钮不许带 .nav-btn：admin.html 结尾那段循环把每个 .nav-btn 都绑成 switchSection，
  //    给链接绑上它 ⇒ 点一下当前面板被切成空的。这条判据就是钉住这个坑。
  assert.ok(
    !/\bnav-btn\b/.test(link[1]),
    '按钮的 class 里混进了 nav-btn —— 会被后台的导航循环当面板按钮绑上 switchSection',
  )
  assert.ok(
    /target="_blank"/.test(admin) && /rel="noopener"/.test(admin),
    '教程页按钮要新标签打开且带 rel="noopener"（后台面板里正在编辑的规则不该被这一跳带走）',
  )
  assert.ok(
    admin.includes('id="section-skill"'),
    '路线页 section 没了 —— 教程页正文第 8 课之外，那句互相指路的说明就失去了落点',
  )

  const css = fs.readFileSync(ADMIN_CSS, 'utf-8')
  assert.ok(
    /nav a\.nav-link\s*\{/.test(css),
    'admin.css 里缺 nav a.nav-link 的样式 —— 按钮会退化成深色背景上的下划线文本，看不出是可点的',
  )
  assert.ok(/p\.note\s*\{/.test(css), 'admin.css 里缺 p.note 的样式（路线页末尾指路那句靠它）')
})

test('分母：用法 1 节＋11 课＋4 附录＝16 个 section，目录与打卡框都对得上', () => {
  const ids = [...html.matchAll(/<section class="les" id="([^"]+)"/g)].map((m) => m[1])
  const lessons = ids.filter((i) => /^L\d+$/.test(i))
  const appendix = ids.filter((i) => /^[A-D]$/.test(i))
  assert.deepStrictEqual(lessons, [
    'L0',
    'L1',
    'L2',
    'L3',
    'L4',
    'L5',
    'L6',
    'L7',
    'L8',
    'L9',
    'L10',
  ])
  assert.deepStrictEqual(appendix, ['A', 'B', 'C', 'D'])
  assert.strictEqual(
    ids.length,
    16,
    `section 应是「用法＋11 课＋4 附录」共 16 个，现在 ${ids.length} 个`,
  )
  assert.strictEqual(ids[0], 'how', '第一节必须是「这门课怎么用」')

  // 目录：15 条 = 11 课 + 4 附录（#how 是开篇，不进目录）
  const toc = [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1])
  assert.strictEqual(toc.length, 15, `目录锚点应 15 条，现在 ${toc.length} 条`)
  for (const t of toc) {
    assert.ok(ids.includes(t), `目录里的 #${t} 在正文找不到对应 section`)
  }
  for (const i of ids) {
    if (i === 'how') continue
    assert.ok(toc.includes(i), `${i} 这一节没进目录 —— 读者滚不到它，它等于没写`)
  }

  // 每课：标题＋目标＋打卡框。L0~L9 固定 3 颗（30 颗＝10 课 × 3），
  // L10 是毕业考：⛔ 不给打卡框——"我算通过了"这种事不许自己勾，它给的是 9 行验收表＋三段考题。
  const parts = html.split(/(?=<section class="les" id=")/)
  for (const sec of parts.filter((p) => /^<section class="les" id="L/.test(p))) {
    const id = /id="(L\d+)"/.exec(sec)[1]
    assert.ok(/<h2>第 \d+ 课/.test(sec), `${id} 缺「第 N 课」标题`)
    assert.ok(sec.includes('<p class="aim">'), `${id} 缺「目标」那段`)
    if (id === 'L10') {
      assert.ok(!/data-k="/.test(sec), 'L10 出现了打卡框：毕业考要的是验收表逐行过，不是自己勾')
      assert.ok(
        (sec.match(/<tr>/g) || []).length >= 9,
        `L10 的验收表只剩 ${(sec.match(/<tr>/g) || []).length - 1} 行，九步收口被删过了`,
      )
      assert.ok(sec.includes('毕业考'), 'L10 里「毕业考」那三段考题没了')
      continue
    }
    assert.strictEqual(
      (sec.match(/data-k="/g) || []).length,
      3,
      `${id} 的打卡框不是 3 颗 —— 总数 30 与"每课三条"这两句口径得一起改`,
    )
  }

  // 打卡框：30 个、key 不重号
  const keys = [...html.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1])
  assert.strictEqual(keys.length, 30, `打卡框应 30 颗，现在 ${keys.length} 颗`)
  assert.strictEqual(new Set(keys).size, 30, 'data-k 有重号 —— 勾一颗会点亮两颗，进度也不准')

  // 代码块与复制按钮一对一
  const pre = (html.match(/<pre>/g) || []).length
  const cp = (html.match(/class="cp"/g) || []).length
  assert.strictEqual(cp, pre, `有 ${pre} 个代码块但只有 ${cp} 颗复制按钮 —— 少的那块没法一键复制`)
  assert.ok(pre >= 14, `代码块只剩 ${pre} 个，正文里"能复制去跑的命令"没了几条`)
})

test('loc 锚点逐条核：文件在场、行号不越界（本页的信用全在这条上）', () => {
  const list = anchors('loc')
  assert.ok(list.length >= 45, `蓝底锚点只剩 ${list.length} 条，正文的仓库引用被大面积删掉了`)
  const bad = []
  for (const a of list) {
    const [rel, ref] = splitRef(a)
    if (!/^(backend|app)\//.test(rel) && rel !== 'Dockerfile') {
      bad.push(`${a}：loc 只准写仓库内路径（backend/…、app/…、Dockerfile），仓外请用 ext`)
      continue
    }
    const abs = path.join(REPO, rel)
    if (!fs.existsSync(abs)) {
      bad.push(`${a}：文件不在仓库里`)
      continue
    }
    if (!ref) continue
    const max = Math.max(...ref.split('-').map(Number))
    if (max > lineCount(abs)) bad.push(`${a}：该文件只有 ${lineCount(abs)} 行`)
  }
  assert.deepStrictEqual(bad, [], '锚点核不过：\n  ' + bad.join('\n  '))

  // 教程页自称的两个数，钉住别漂移
  assert.ok(
    anchors('loc').includes('backend/test/learnPage.test.js'),
    '页面 footer 说要由本测试逐条核锚点，正文里却不再提这份测试 ⇒ 那句话和这条判据得一起改',
  )
  // 第 7 课还有一句"COPY backend/ ./ 在构建那一刻把代码拷进镜像"
  const dockerfile = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf-8').split(/\r?\n/)
  const copyLine = dockerfile.findIndex((l) => l.trim() === 'COPY backend/ ./') + 1
  assert.ok(
    anchors('loc').includes(`Dockerfile:${copyLine}`),
    `Dockerfile 里 COPY backend/ ./ 现在在第 ${copyLine} 行，教程页引的不是这一行`,
  )
})

// 第 7 课讲挂载：compose 的 volumes 段起始行要与教程页引的那一行一致，行号漂了这里先红。
// compose 在仓库外面 ⇒ 缺席时 skip（写清原因），不再让 ENOENT 冒充门禁红灯（CI 上必红就是这条）。
test(
  'compose 挂载段起始行＝教程页 ext 锚点引的那一行（仓外文件，不在场则 skip）',
  {
    skip: COMPOSE_PRESENT
      ? false
      : `compose 不在盘上：${COMPOSE_YML}（仓外文件，CI 的 Linux 上没有它；本机要跑就用 STYLEAI_COMPOSE_YML 指路）`,
  },
  () => {
    const compose = fs.readFileSync(COMPOSE_YML, 'utf-8')
    const volLine = compose.split(/\r?\n/).findIndex((l) => /^\s+volumes:\s*$/.test(l)) + 1
    assert.ok(volLine > 0, 'compose 里找不到 volumes 段')
    const cited = anchors('ext').find((a) => a.startsWith('E:/website/compose/docker-compose.yml:'))
    assert.ok(cited, '教程页没引用 compose 的挂载行段')
    const from = Number(splitRef(cited)[1].split('-')[0])
    assert.strictEqual(
      from,
      volLine,
      `教程页引用的挂载起始行 ${from} 与 compose 现量 ${volLine} 不符`,
    )
  },
)

test('ext 锚点只判形状：一律 E:/website/ 开头，⛔ 不判在不在盘上（CI 的 Linux 没 E: 盘）', () => {
  const list = anchors('ext')
  assert.ok(list.length >= 15, `仓外锚点只剩 ${list.length} 条，附录 C 的手册对照表被删空了`)
  const bad = list.filter((a) => !splitRef(a)[0].startsWith('E:/website/'))
  assert.deepStrictEqual(bad, [], '这些 ext 不是仓外路径的写法：\n  ' + bad.join('\n  '))
  // 附录 C 承诺过的那些手册，名字得真出现在正文里（拼错的路径读者照着找会找不到）
  for (const n of ['9.html文档', '站3产生临时文件', '算法知识大全', '全栈运维手册']) {
    assert.ok(html.includes(n), `正文里找不到「${n}」`)
  }
})

test('页面伸手不出外网：无外链脚本/样式、无 @import、http 只准是 127.0.0.1', () => {
  assert.strictEqual((html.match(/<script src=/g) || []).length, 0, '页面引了外部脚本')
  assert.strictEqual(
    (html.match(/<link/g) || []).length,
    0,
    '本页样式必须内联：引外部 CSS 就有断网变白皮的风险',
  )
  assert.strictEqual((html.match(/@import/g) || []).length, 0, 'CSS 里有 @import')
  assert.strictEqual((html.match(/<img/g) || []).length, 0, '正文引了图片')
  assert.ok(!/fonts\.(googleapis|gstatic)/.test(html), '不许引远程字体：这一页要离线也能读')
  assert.ok(!/file:\/\//.test(html), 'file:// 链接在浏览器里点不开（页面是 http 发出去的）')
  const urls = html.match(/https?:\/\/[^\s"'<>)]+/g) || []
  for (const u of urls) {
    assert.ok(u.startsWith('http://127.0.0.1'), `正文里出现了本机以外的地址：${u}`)
  }
  // 编码：整页 UTF-8，替换符＝中文写坏了
  assert.strictEqual(
    (html.match(/\uFFFD/g) || []).length,
    0,
    '页面里有 U+FFFD，中文写入过程中被截坏过',
  )
})

test('页尾脚本在假 DOM 上跑一遍：不抛错、进度按 30 颗算、打卡读得回来也写得回去', () => {
  const sm = /<script>([\s\S]*?)<\/script>/.exec(html)
  assert.ok(sm, '页面里没有内联 <script>')
  const script = sm[1]

  const store = { 'learn-checks-v1': JSON.stringify({ L1a: true }) }
  const writes = []
  const byId = {}
  const mk = (extra) =>
    Object.assign(
      {
        checked: false,
        _cls: new Set(),
        classList: {
          add(c) {
            this._s.add(c)
          },
          remove(c) {
            this._s.delete(c)
          },
        },
        style: {},
        textContent: '',
        _listeners: {},
        addEventListener(ev, fn) {
          this._listeners[ev] = fn
        },
      },
      extra,
    )
  const classOf = (el) => {
    el.classList._s = el._cls
    return el
  }

  const boxes = [...html.matchAll(/data-k="([^"]+)"/g)].map((m) => {
    const label = classOf(mk({}))
    const box = classOf(
      mk({
        _k: m[1],
        getAttribute: (k) => (k === 'data-k' ? m[1] : null),
        closest: () => label,
      }),
    )
    box._label = label
    return box
  })
  const pres = [...html.matchAll(/<pre><button class="cp">[\s\S]*?<code>([\s\S]*?)<\/code>/g)].map(
    (m) => {
      const btn = classOf(mk({ textContent: '复制' }))
      const code = classOf(mk({ textContent: m[1] }))
      return {
        querySelector: (sel) => (sel === '.cp' ? btn : sel === 'code' ? code : null),
        btn,
        code,
      }
    },
  )
  const tocLinks = [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => {
    const a = classOf(mk({ getAttribute: () => '#x' }))
    a.getAttribute = (k) => (k === 'href' ? '#' + m[1] : null)
    return a
  })
  for (const id of ['prog', 'progn']) byId[id] = classOf(mk({}))
  // 每一节的 scrollIntoView 都记账：假 DOM 里"平滑滚动"永远不动，正好用来验兜底
  const scrolls = []
  const scroller = { scrollTop: 0 }
  for (const m of html.matchAll(/<section class="les" id="([^"]+)"/g)) {
    byId[m[1]] = classOf(
      mk({
        id: m[1],
        scrollIntoView: (opt) => {
          scrolls.push({ id: m[1], behavior: (opt || {}).behavior })
        },
      }),
    )
  }

  const timers = []
  const ctx = {
    console,
    setTimeout: (fn) => {
      timers.push(fn)
    },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        writes.push([k, v])
        store[k] = String(v)
      },
    },
    navigator: {},
    window: {},
    document: {
      scrollingElement: scroller,
      documentElement: scroller,
      getElementById: (id) => byId[id] || null,
      createElement: () => classOf(mk({ select: () => {} })),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => false,
      querySelectorAll: (sel) => {
        if (sel === 'label.chk input[type=checkbox]') return boxes
        if (sel === 'pre') return pres
        if (sel === 'nav.toc a') return tocLinks
        return []
      },
    },
  }
  vm.createContext(ctx)
  vm.runInContext(script, ctx, { filename: PAGE })

  assert.strictEqual(
    ctx.document.getElementById('progn').textContent,
    '1 / 30 项已打卡',
    '起手读数不对',
  )
  // 打卡状态是按 data-k 认的，⛔ 不是按第几颗——L1a 在文档顺序里是第 5 颗
  const l1a = boxes.find((b) => b._k === 'L1a')
  assert.ok(l1a, '正文里没有 data-k="L1a" 这颗框，种子存的 key 就白给了')
  assert.ok(l1a.checked, 'localStorage 里 L1a 已打卡，页面没把它读回来')
  assert.ok(l1a._label._cls.has('on'), '勾过的框没被点亮（label 上的 .on 类没加上）')
  assert.ok(ctx.document.getElementById('prog').style.width.endsWith('%'), '进度条宽度没写成百分比')

  // 现勾第二颗 ⇒ 写回 localStorage、读数变 2/30
  const target = boxes.find((b) => !b.checked)
  target.checked = true
  target._listeners.change()
  assert.strictEqual(
    ctx.document.getElementById('progn').textContent,
    '2 / 30 项已打卡',
    '勾完没当场刷新读数（每勾一颗都要重画）',
  )
  assert.strictEqual(writes.length, 1, '勾选处理里 localStorage.setItem 应恰好调一次')
  const saved = JSON.parse(store['learn-checks-v1'])
  assert.strictEqual(Object.keys(saved).length, 2, '写回的打卡记录该是两条')

  // 取消勾选要能撤干净（不能只加不减）
  target.checked = false
  target._listeners.change()
  assert.strictEqual(
    ctx.document.getElementById('progn').textContent,
    '1 / 30 项已打卡',
    '取消勾选没退回去',
  )
  assert.strictEqual(Object.keys(JSON.parse(store['learn-checks-v1'])).length, 1)

  // 复制按钮：14 个代码块各绑一颗，按下不抛错（无 clipboard ⇒ 走 execCommand 兜底）
  assert.strictEqual(pres.length, 14, `代码块与复制按钮的配对数变了：${pres.length}`)
  for (const p of pres) {
    assert.ok(p.btn._listeners.click, '有一颗复制按钮没绑 click')
    p.btn._listeners.click()
  }
  assert.ok(
    ['已复制', '手动选'].includes(pres[0].btn.textContent),
    '复制按钮按下后没给反馈文案（假 DOM 里 clipboard 不存在 ⇒ 该落"手动选"）',
  )

  // 目录点击：preventDefault ＋ 滚到那一节 ＋ 高亮
  let prevented = false
  timers.length = 0 // 上面 14 颗复制按钮各自排过一次"文案回弹"的计时器，别混进来
  tocLinks[0]._listeners.click({ preventDefault: () => (prevented = true) })
  assert.ok(prevented, '目录点击没 preventDefault（会留下 #L0 这种脏地址，刷新后位置乱）')
  assert.ok(tocLinks[0]._cls.has('here'), '点过的目录项没高亮')

  // 平滑滚动兜底（10-22 真浏览器实测：这台机器上 behavior:'smooth' 一点不动，
  // 点了目录像没反应）：假 DOM 里 scrollTop 永远不变 ⇒ 计时器一跑就该补一次直接跳。
  assert.strictEqual(scrolls.length, 1, '点一次目录只准请求一次滚动')
  assert.strictEqual(scrolls[0].behavior, 'smooth', '第一次该请求平滑滚动')
  assert.strictEqual(timers.length, 1, '没安排兜底检查的计时器')
  timers.forEach((fn) => fn())
  assert.strictEqual(scrolls.length, 2, 'scrollTop 没变化时没补上直接跳（用户点了等于没反应）')
  assert.strictEqual(scrolls[1].behavior, undefined, '兜底那一次必须是直接跳，不能再要求平滑')
  assert.strictEqual(scrolls[1].id, scrolls[0].id, '兜底跳错了目标')
})
