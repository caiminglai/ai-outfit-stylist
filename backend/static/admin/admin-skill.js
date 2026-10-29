/* ══════════════════════════════════════════════════════════════
   管理后台 — 编程水平与独立路线（「路线」页）

   目的：把「他现在能自己写多少这个项目」变成一个有证据、有刻度、
        有可自测判据的页面——终点是**没有 AI 辅助也能独立交付一轮改动**。

   数据不是猜的：十条轴的「证据」全部来自 2026-09-25 起 59 轮协作里
   他真实做过的事（下过的令、追过的数、执行过的命令、拒过的口径）。
   ⚠️ 诚实边界写在页面开头：这份评估只来自对话里看得见的行为，
      不是"看他独立写代码"的实测 ⇒ 每条轴旁边给他一个自评旋钮，
      做完 S1 的校准题让他自己改；两边不一致时**以他的为准**（产品判断权本来就在他的手上）。

   依赖: admin-utils.js（escapeHtml / showToast）——只用到这两个，
        任何接口都不打，⛔ 不写数据库、⛔ 不加新端点、⛔ 不吃限流闸。
        进度只存本机 localStorage，清浏览器数据就没了（导出按钮留一份文本）。
   ══════════════════════════════════════════════════════════════ */

var SKILL_SCALE = [
  { lv: 0, cn: '0 没碰过' },
  { lv: 1, cn: '1 能照抄跑通' },
  { lv: 2, cn: '2 看得懂别人改在哪' },
  { lv: 3, cn: '3 能独立小改并自己测' },
  { lv: 4, cn: '4 能独立设计＋交付一整轮' },
];

/* 十条轴。ai = 我按证据给的评；selfKey 用于 localStorage 里存他的自评 */
var SKILL_AXES = [
  {
    key: 'plan',
    name: '目标拆解与验收标准',
    ai: 3.5,
    group: '指挥',
    evidence:
      '第五十九轮你把「优化用户体验／优化商业模式／优化算法」排成第一、第二步并各自定了优先级；' +
      '「闸门」「验收」「判据」这三个词是你先用的，<code>docs/依据</code> 23 份规范里每一节都收在一条能跑的判据上。',
    note: '这一条是全页最高分，也是很多写了三年代码的人做不到的那条。',
  },
  {
    key: 'business',
    name: '业务与数据的直觉',
    ai: 3.5,
    group: '指挥',
    evidence:
      '你追过「227% 那个数怎么来的」；0.01 元测单是你的原话「链路是通的，跑一笔真钱」；' +
      '今天这个「后台再点一次通过＝同一笔钱能领两份细账」的钱级洞，方向是你先问出来的（付款即交付到底真交付了没）。',
    note: '',
  },
  {
    key: 'money-safety',
    name: '钱与凭据的边界感',
    ai: 3.5,
    group: '指挥',
    evidence:
      '商户口令／私钥／付款按钮你从不让别人碰，「掏钱前先摊开全部前置」是你定的规矩，<code>.env</code> 没贴过全文。',
    note: '这条守住了，项目就不会一夜回到解放前。',
  },
  {
    key: 'docs',
    name: '文档与可交接性',
    ai: 3,
    group: '指挥',
    evidence:
      '你会说「给下一个 AI 看」，逼出过自洽交接文档；<code>docs/依据</code> 只往末尾追加、台账一条一行也是你认的口径。',
    note: '',
  },
  {
    key: 'cli',
    name: '命令行与部署',
    ai: 2,
    group: '动手',
    evidence:
      '<code>docker compose build</code> / <code>up -d</code>、<code>git pull</code>、<code>git push</code>、<code>npm run build</code> 你都在服务器和本机手敲过，粘回来的报错是真的。',
    note: '界线在「报错你还给我读」——那条一过就是 3。',
  },
  {
    key: 'git',
    name: '版本控制 git',
    ai: 2,
    group: '动手',
    evidence:
      'add / commit / pull / push 会用；<code>git log -p</code>、<code>git diff HEAD -- 路径</code>、<code>git blame</code> 到现在一次都没用过。',
    note: '所以你现在改坏了，没法把改动缩到「只有这一处」，也没法自己回滚。',
  },
  {
    key: 'read-code',
    name: '读代码（Node / JS）',
    ai: 1.5,
    group: '动手',
    evidence: '能读我贴给你的 30 行并问出「这行为什么是 403 不是 401」；但「从 payment.js 里自己找到 markPaid」还做不到。',
    note: '',
  },
  {
    key: 'backend',
    name: '写后端（Express / SQL）',
    ai: 1,
    group: '动手',
    evidence: '到本轮为止，这个仓里没有一行后端代码是他亲手写的。',
    note: '⚠️ 这不是差评，是「还没测」。S2 就是第一行。',
  },
  {
    key: 'frontend',
    name: '写前端（HTML / CSS / React / TS）',
    ai: 1,
    group: '动手',
    evidence: '同上：改过 <code>pay.html</code> 的一句文案吗？没有 ⇒ 只能记 1。',
    note: '',
  },
  {
    key: 'test-debug',
    name: '测试与调试',
    ai: 1,
    group: '动手',
    evidence: '你一直要求「必须真浏览器点一次」「读数要带时刻」，但自己还没跑过 <code>npm test</code>，没读过一条断言的 expected / actual。',
    note: '这一条最值钱：它是别人写的代码能不能被你判死的能力。',
  },
];

/* 八段路线。steps 里的 {cmd:...} 会渲染成可复制的代码块 */
var SKILL_STAGES = [
  {
    id: 'S0',
    title: '环境自证：确认「我改的东西真出厂了」',
    hours: '1 小时',
    goal: '不看任何说明，自己把本机跑起来，并能说出「改完要跑什么」。',
    steps: [
      {
        t: '看容器活着没（活着才有下面一切）',
        c: 'cd /e/website/compose && docker compose ps',
      },
      { t: '自证后端真的在回话（200 且 83 字节，不是 SPA 那个假 200）', c: 'curl -s -o /dev/null -w "%{http_code} %{size_download}\\n" http://127.0.0.1:5000/api/health' },
      { t: '改一处看得见的文字：<code>app/public/how-it-works.html</code> 里随便一个 <code>&lt;h2&gt;</code> 末尾加「·测试」', c: null },
      { t: '重建镜像并起来，再打开那页看新文字', c: 'docker compose up -d --build' },
      { t: '反证：这次只 <code>docker compose up -d</code>（不加 --build），再开那页——文字没变。说出为什么。', c: null },
    ],
    pass: '一句话答得出：改 <code>backend/**/*.js</code> 要 build 镜像；改 <code>app/**</code> 要先 <code>npm run build</code> 再 build 镜像；只 up -d 用的是旧镜像里的旧代码。',
    stuck: 'docker 命令报连不上＝Docker Desktop 没起（本机实测：<code>cmd //c start "" "C:\\Program Files\\Docker Desktop\\Docker Desktop.exe"</code> 一条即起）。',
  },
  {
    id: 'S1',
    title: '读一份真代码 ＋ 校准题（做完回来改自评）',
    hours: '2 小时',
    goal: '从「看我贴给你的代码」变成「自己能定位到代码」。',
    steps: [
      { t: '后台「接口路由」页列出全部 GET/POST，挑 <code>GET /api/payment/order/:outTradeNo</code>', c: null },
      { t: '自己找到它在哪个文件第几行（这条 grep 就是本仓所有「找代码」的起手式）', c: 'cd /e/website/3.personal-image-ai && grep -rn "order/:outTradeNo" backend --include=*.js' },
      { t: '从那一行往下连续读 40 行，在纸上写三行：① 请求进来带什么 ② 中间查了哪张表 ③ 什么条件回什么码', c: null },
      { t: '校准题（别查答案，先猜再验）：这 40 行里有几处 <code>return</code>？<code>order.user_id !== req.user.id</code> 为什么是 403 不是 401？<code>status</code> 在库里出现过哪几种值？', c: 'grep -n "status !== \'paid\'\\|status = \'paid\'\\|status:" backend/routes/payment.js | head -30' },
    ],
    pass: '三个数/三行纸图能自己讲通；讲不通就再读一遍。做完把上面十条轴的自评按你新的感觉改一遍——两边不一致时以你的为准。',
    stuck: '读到 <code>markPaid(...)</code> 这种别处的函数就跳进去看，看完跳回来；跳三次以内还说不清，就是这一条不是你写的，很正常。',
  },
  {
    id: 'S2',
    title: '亲手写第一个只读接口（你的第一行代码进这个仓）',
    hours: '3 小时',
    goal: '写一个不会闯祸的接口，并让它过全部门禁。',
    steps: [
      { t: '新建 <code>backend/routes/skill.js</code>：<code>GET /api/skill/ping</code> 回 <code>{ ok: true, tables: &lt;库里的表数&gt; }</code>（表数用 <code>db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type=\'table\'").get()</code>）', c: null },
      { t: '在 <code>backend/server.js</code> 挂上：照 <code>admin</code> 那两行抄（<code>require</code> 一行、<code>app.use</code> 一行）', c: 'grep -n "adminRoutes" backend/server.js' },
      { t: '新建 <code>backend/test/skillRoute.test.js</code>，先只断言一件事：未登录时它回 401 或 403（别先断言 200）', c: null },
      { t: '格式与门禁（这一步就是你以后每次改完必跑的四条）', c: 'cd backend && npm run format && npm test && npx eslint .' },
      { t: '真取一次数据（本机 5000 起来之后）', c: 'curl -s -i http://127.0.0.1:5000/api/skill/ping | head -5' },
    ],
    pass: '<code>npm test</code> 的输出里出现你那条 test 的名字并且是 ✔；<code>curl</code> 拿到的 JSON 与你断言的一致；<code>git status --porcelain</code> 只剩你改的那三个文件。',
    stuck: 'test 红了先读 ✔/✖ 那一行的 expected / actual，别改期望凑绿——改期望把绿变成假绿，这一步练的正是这个。',
  },
  {
    id: 'S3',
    title: 'SQL 亲手查账（钱的口径自己算一遍）',
    hours: '2 小时',
    goal: '第一次自己写 SELECT 算出真钱数，并和后台读数对上。',
    steps: [
      { t: '⛔ 不碰活库：拿只读副本，模板现成（<code>backup()</code> 出来的那份）。复制成自己的名字再改 SQL', c: 'ls /e/website/files | grep -i p14' },
      { t: '算三个数：① <code>payment_orders</code> 里 <code>status=\'paid\'</code> 的笔数 ② 实收元数（<code>SUM(amount_fen)/100</code>） ③ <code>deposits</code> 里 <code>status=\'approved\'</code> 且不是镜像的行数', c: null },
      { t: '对答案：后台「收款凭证」那三张读数卡的数', c: null },
      { t: '解释一句话：<code>amount_fen</code> 为什么要除 100？（答：SQLite 这版没有可靠的定点小数，钱按「分」存整数，<code>99 元</code> 存成 <code>9900</code>）', c: null },
    ],
    pass: '三个数与后台逐一对上；对不上时你能自己写出为什么（多半是镜像行/在线单的口径差）。',
    stuck: '查询报「no such column」＝列名记错了，用 <code>PRAGMA table_info(payment_orders)</code> 现量列名，别猜。',
  },
  {
    id: 'S4',
    title: '改一处前端（React ＋ TS 的第一次）',
    hours: '3 小时',
    goal: '在顾客端的报告卡上多显示一行真数据，并且构建链全绿。',
    steps: [
      { t: '定位组件：<code>app/src/components/PaidReports.tsx</code>（后台「源代码」页也能读到它）', c: 'grep -rn "领取\\|created_at\\|paid_at" app/src/components/PaidReports.tsx | head' },
      { t: '在卡片上多加一行显示「领取时间」——字段后端回执里已有，⛔ 不要为了显示去改后端', c: null },
      { t: '先类型后构建（这个仓 <code>tsc --noEmit</code> 是假通过，只认 <code>-b</code>）', c: 'cd app && npm run typecheck && npm run build && npm run lint' },
      { t: '真浏览器打开 <code>http://127.0.0.1:5000</code> 走到「我的报告」看那一行', c: null },
    ],
    pass: 'typecheck 0 错、build rc=0、lint 没新增 error，页面上真看得见那行时间——四样缺一样都不算过。',
    stuck: 'TS 报的「Property x does not exist on type y」＝你以为回执里有 x，其实没有；回去看接口真实 JSON，别加 <code>as any</code> 消音。',
  },
  {
    id: 'S5',
    title: '独立修一个真 bug（我第一次不给分析）',
    hours: '5 小时',
    goal: '只用日志＋测试定位问题，练「红→绿」的顺序。',
    steps: [
      { t: '我提供一个已在本机复现的小 bug（只给现象，不给原因）', c: null },
      { t: '你先写一条<b>能红</b>的测试把它钉住', c: 'cd backend && npm test' },
      { t: '再看日志（本机尺子：<code>tail -n 60 backend/logs/*.log</code>）——日志里哪一行是你怀疑的那句？', c: null },
      { t: '改代码到那条测试变绿；其余测试一条不许动', c: null },
      { t: '全部门禁重跑', c: 'cd backend && npm run format:check && npx eslint . && cd ../app && npm run lint' },
    ],
    pass: '你能指出「哪条测试先红、改完变绿、其它没动」，并且中间没有改过任何一条既有期望值。',
    stuck: '找不到入口时用 <code>grep -rn "报错文案里那半句中文" backend</code> ——本站的报错文案是唯一的，比栈还好用。',
  },
  {
    id: 'S6',
    title: '独立做完一整轮闭环（毕业前的最后一关）',
    hours: '8 小时',
    goal: '从想法到提交，全程不需要别人替你读代码。',
    steps: [
      { t: '① 先写规范：新建一份 <code>docs/依据/NN-xxx输入输出规范-日期.md</code>，每节都必须带一条能跑的判据（这是你最强的那一格）', c: null },
      { t: '② 改码：一次一个改动，改完立刻跑对应测试', c: null },
      { t: '③ 单测：新功能至少一条正向＋一条负向', c: null },
      { t: '④ 六门：后端 prettier / eslint / node --test，前端 prettier / eslint / tsc -b + build', c: 'cd backend && npm run format:check && npx eslint . && npm test && cd ../app && npm run format:check && npm run lint && npm run build' },
      { t: '⑤ 文档定位符重扫：动了被按行号引用的东西，全仓重扫一遍（<code>grep -rn "payment.js:[0-9]" docs</code>）', c: null },
      { t: '⑥ 提交块自己写（<code>-F</code> 走文件，含中文别用 <code>-m</code>）', c: null },
    ],
    pass: '我一行不改，六门全绿；每处改动你讲得出「为什么在这、为什么不是别处」；提交块粘上去一次过。',
    stuck: '第 ⑤ 步最容易漏：只扫 <code>docs/依据</code> 会漏掉 <code>路线</code>／<code>清单</code>，扫描面要覆盖全部 md。',
  },
  {
    id: 'S7',
    title: '毕业线（长期，不排时间表）',
    hours: '—',
    goal: '没有 AI 也能维护它，并且敢改它的算法。',
    steps: [
      { t: '连续两轮由你主导、我旁观（我只在你开口时读代码）', c: null },
      { t: '看得懂别人提的 diff：<code>git log -p -1</code> 读一份我自己的提交，讲出三处疑点', c: 'git log -p -1 | head -120' },
      { t: '敢在服务器上做完整序列：热备份 → <code>git pull</code> → 自检脚本 → <code>--build</code> → 冒烟', c: null },
      { t: '改一次算法并自己判它好不好（比如调 <code>colorMetrics.js</code> 的融合闸门）', c: null },
    ],
    pass: '这四条都打勾，这个仓就离得开 AI 了。',
    stuck: '卡住不是水平问题，是顺序问题——先能读，再能改，最后能判。',
  },
];

/* 没有 AI 时的替代动作（这一栏才是「以后没有 AI」那一半答案） */
var SKILL_TOOLS = [
  { k: '读报错', v: '从最后一行往上，找第一个<b>你自己改过的</b>文件名:行号；那一行以上全是框架，先别看。' },
  { k: '找代码', v: '<code>grep -rn "关键字" backend app/src --include=*.js --include=*.ts</code>。中文报错文案比函数名更好用，本站文案唯一。' },
  { k: '看改动面', v: '<code>git diff HEAD -- 路径</code>；<code>git log -p -1</code> 看上一次提交到底改了什么；<code>git blame -L 20,60 路径</code> 看某一行是为谁而写的。' },
  { k: '只跑一条测试', v: '<code>cd backend &amp;&amp; node --test --test-name-pattern="关键词" test/*.test.js</code> ——改哪块就跑哪块，不用等 795 条。' },
  { k: 'lint 读数', v: 'eslint 的 ruleId 在输出<b>最右列</b>，不是第二列；按第二列数会数出假规则名。' },
  { k: '排版 vs 对错', v: '<code>prettier</code> 只统一长相，不判你写得对；<code>format:check</code> 红了跑 <code>npm run format</code> 就绿，跟功能无关。' },
  { k: '假 200', v: '<code>curl -s -o /dev/null -w "%{http_code} %{size_download}" URL</code>——200 但字节数像 HTML 就是 SPA 兜底，不是接口活着。' },
  { k: '库的真相', v: '列名用 <code>PRAGMA table_info(表名)</code>，行数用 <code>SELECT COUNT(*)</code>。⛔ 别照文档里的「N 个」写代码。' },
  { k: '查文档', v: 'Node 官方（nodejs.org）、MDN、SQLite 文档（sqlite.org/json1.html）。搜索词写成「sqlite json_extract」这种「产品名+函数名」，比问句子准。' },
];

var SKILL_QUIZ = [
  {
    q: '<code>npm test</code> 报「795 pass」——795 这个数的单位是什么？',
    a: '一条 test（一个 <code>it</code>/一次断言组），不是文件数、不是端点数。本仓 <code>test/*.test.js</code> 是 54 份文件、795 条用例。',
  },
  {
    q: '403 和 401 什么时候各用哪个？',
    a: '401＝没证明自己是谁（没带/带错 token）；403＝知道你是谁但不让你动（登录了却去查别人的单）。',
  },
  {
    q: '为什么提交时要 <code>git restore --staged backend/db/styleai.db</code>？',
    a: '那是在跑的运行库（WAL 里全是实时行），盘上和 HEAD 常年不一致；<code>git add -u</code> 会把它一起塞进提交，等于把「正在跑的账」和「代码」混成一笔，回滚代码时连带把数据也滚了。',
  },
  {
    q: '<code>tsc -b --force</code> 回 0 错，代表页面一定正常吗？',
    a: '不代表。它只保证类型说得通；文案错、条件反了、数据没接，全都可能 0 错。所以本仓的规矩是「类型门 + 真浏览器点一次」两条都要有。',
  },
  {
    q: 'prettier 说「All matched files use Prettier code style!」但 eslint 报 142 warning，谁要紧？',
    a: '都不拦 CI：eslint 只卡 error，warning 是台账。真要紧的是 error 数＝0 和 test fail＝0。',
  },
  {
    q: '你改完 <code>backend/routes/payment.js</code> 直接刷新浏览器，什么也没变。最可能的两个原因？',
    a: '① 代码在容器里，盘上改了没 build 镜像，跑的还是旧那份（<code>docker compose up -d --build</code> 才换）；② 改了 <code>app/**</code> 但没 <code>npm run build</code>，出厂的 <code>dist/</code> 还是旧产物。',
  },
];

/* ── 状态读写：只走 localStorage，清浏览器数据即失（导出留文本） ── */
function skillStore() {
  try {
    return window.localStorage
  } catch (e) {
    return null
  }
}

function skillRead(key, fallback) {
  var s = skillStore()
  if (!s) return fallback
  try {
    var raw = s.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (e) {
    return fallback
  }
}

function skillWrite(key, val) {
  var s = skillStore()
  if (!s) return
  try {
    s.setItem(key, JSON.stringify(val))
  } catch (e) {
    /* 隐私模式写不进：页面照样能用，只是不留进度 */
  }
}

function skillEsc(v) {
  return typeof escapeHtml === 'function' ? escapeHtml(String(v)) : String(v)
}

/* 允许在数据里写少量 <code>/<b>，其余一律走 skillEsc：文案全是本文件内 authored 的，
   唯一可能带用户内容的是「自评」，那是数字，安全。 */
function skillRaw(v) {
  return String(v)
}

function skillBar(lv) {
  var pct = Math.max(0, Math.min(100, (lv / 4) * 100))
  var color = lv >= 3 ? '#22c55e' : lv >= 2 ? '#eab308' : '#f97316'
  return (
    '<div style="background:#1e293b;border-radius:4px;height:10px;min-width:90px;overflow:hidden">' +
    '<div style="width:' +
    pct +
    '%;height:10px;background:' +
    color +
    '"></div></div>'
  )
}

/* 「你自评」读数＋差异徽章。渲染时和点完按钮后就地刷新时用同一段，两边不会走岔。
   10-22：原来点一下自评就 skillRefresh() 整页重排（3.7 万字 innerHTML 重建），
   后果是滚动位置跳、焦点丢、屏幕闪一下——这页本身是给人一条条点的，第一条就打断。
   现在只换这一格的读数，见 skillWire 里的 data-axis-readout 更新。 */
function skillAxisReadout(ax, selfLv) {
  var diff =
    selfLv === null
      ? '<span class="badge">自评未填</span>'
      : selfLv > ax.ai
        ? '<span class="badge badge-green">自评 +' + (selfLv - ax.ai).toFixed(1) + '</span>'
        : selfLv < ax.ai
          ? '<span class="badge badge-red">自评 −' + (ax.ai - selfLv).toFixed(1) + '</span>'
          : '<span class="badge badge-accent">一致</span>'
  return (
    '<span style="min-width:52px">你自评 <b>' +
    (selfLv === null ? '—' : selfLv) +
    '</b>／4</span>' +
    diff
  )
}

function skillRenderAxes(selfMap) {
  var rows = SKILL_AXES.map(function (ax) {
    var selfLv = typeof selfMap[ax.key] === 'number' ? selfMap[ax.key] : null
    var btns = SKILL_SCALE.map(function (s) {
      var on = selfLv === s.lv
      return (
        '<button class="btn btn-sm ' +
        (on ? 'btn-primary' : '') +
        '" data-axis="' +
        ax.key +
        '" data-lv="' +
        s.lv +
        '" title="你自己判这一轴为 ' +
        s.lv +
        ' 分" style="margin:2px 3px 0 0">' +
        s.lv +
        '</button>'
      )
    }).join('')
    return (
      '<div class="card" style="margin-bottom:10px" data-axis-row="' +
      ax.key +
      '">' +
      '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<div style="flex:1 1 200px"><b>' +
      skillEsc(ax.name) +
      '</b> <span class="badge ' +
      (ax.group === '指挥' ? 'badge-purple' : 'badge-orange') +
      '">' +
      ax.group +
      '轴</span></div>' +
      skillBar(ax.ai) +
      '<span style="min-width:52px">我评 <b>' +
      ax.ai +
      '</b>／4</span>' +
      '<span data-axis-readout="' +
      ax.key +
      '">' +
      skillAxisReadout(ax, selfLv) +
      '</span>' +
      '</div>' +
      '<div style="margin-top:8px;font-size:13px">证据：' +
      skillRaw(ax.evidence) +
      '</div>' +
      (ax.note ? '<div style="margin-top:6px;font-size:12px;color:var(--muted)">注：' + skillRaw(ax.note) + '</div>' : '') +
      '<div style="margin-top:8px;border-top:1px dashed #334155;padding-top:6px">' +
      '<span style="font-size:12px;color:var(--muted)">你自己判：</span>' +
      btns +
      '</div></div>'
    )
  }).join('')
  var cmd = SKILL_AXES.filter(function (a) {
    return a.group === '指挥'
  })
  var hands = SKILL_AXES.filter(function (a) {
    return a.group === '动手'
  })
  function avg(list) {
    return list.reduce(function (s, a) {
      return s + a.ai
    }, 0) / list.length
  }
  return (
    '<div class="card" style="border-left:3px solid #38bdf8">' +
    // 10-22 真浏览器实测：这里原先写的是 Markdown 的 **…**，本页走 innerHTML 直出、
    // 没有 markdown 渲染器 ⇒ 星号原样出现在页面上。改成 <b>。
    '综合：<b>指挥侧 ' +
    avg(cmd).toFixed(2) +
    '／4</b>，<b>动手侧 ' +
    avg(hands).toFixed(2) +
    '／4</b>。你缺的不是理解力，是「亲手写过」的次数——所以下面八段全部是动手题，每段都有当场能验的判据。' +
    '</div>' +
    rows
  )
}

function skillRenderStage(st, doneMap) {
  var steps = st.steps
    .map(function (s, i) {
      var cb = st.id + ':' + i
      var on = !!doneMap[cb]
      var code = s.c
        ? '<pre style="background:#0f172a;border-left:3px solid #38bdf8;padding:8px;margin:6px 0;overflow:auto;font-size:12px">' +
          skillEsc(s.c) +
          '</pre>'
        : ''
      return (
        '<label style="display:block;margin:8px 0;cursor:pointer">' +
        '<input type="checkbox" data-step="' +
        cb +
        '"' +
        (on ? ' checked' : '') +
        ' style="margin-right:8px">' +
        '<span style="font-size:13px">' +
        skillRaw(s.t) +
        '</span>' +
        code +
        '</label>'
      )
    })
    .join('')
  var all = st.steps.length
  var done = st.steps.filter(function (_, i) {
    return !!doneMap[st.id + ':' + i]
  }).length
  return (
    '<div class="card" style="margin-bottom:12px" data-stage-row="' +
    st.id +
    '">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
    '<b>' +
    st.id +
    '｜' +
    skillEsc(st.title) +
    '</b><span class="badge badge-accent">' +
    skillEsc(st.hours) +
    '</span></div>' +
    '<div style="margin-top:6px;font-size:13px;color:var(--muted)">' +
    skillRaw(st.goal) +
    '</div>' +
    '<div style="margin-top:6px;background:#1e293b;height:8px;border-radius:4px;overflow:hidden">' +
    '<div data-stage-bar="' +
    st.id +
    '" style="height:8px;width:' +
    ((done / all) * 100).toFixed(0) +
    '%;background:#22c55e"></div></div>' +
    '<div data-stage-count="' +
    st.id +
    '" style="font-size:12px;color:var(--muted);margin-top:2px">' +
    done +
    '/' +
    all +
    ' 步</div>' +
    steps +
    '<div style="margin-top:8px;font-size:13px"><b>通过判据：</b>' +
    skillRaw(st.pass) +
    '</div>' +
    (st.stuck ? '<div style="margin-top:4px;font-size:13px;color:#fbbf24"><b>卡住：</b>' + skillRaw(st.stuck) + '</div>' : '') +
    '</div>'
  )
}

function skillBuild() {
  var selfMap = skillRead('skill_self_axes_v1', {})
  var doneMap = skillRead('skill_steps_v1', {})
  var head =
    '<div class="card" style="border-left:3px solid #f97316">' +
    '<b>这页在量什么</b>' +
    '<div style="margin-top:6px;font-size:13px">把「你能自己写多少这个项目」变成有证据、有刻度、有当场能验的判据的一张表。' +
    '终点按你的原话定：<b>以后没有 AI 辅助，你也能把这个项目接着编程做完一整轮改动。</b></div>' +
    '<div style="margin-top:6px;font-size:13px"><b>⚠️ 诚实边界：</b>下面十条轴的「证据」只来自我们 59 轮协作里<b>看得见的事</b>' +
    '（你下过的令、追过的数、执行过的命令、拒过的口径），<b>不是你独立写代码的实测</b>。所以每条轴旁边都有五个按钮，' +
    '是给你自己改的——做完 S1 那道校准题再改一轮，<b>两边不一致时以你的为准</b>。</div>' +
    '<div style="margin-top:6px;font-size:12px;color:var(--muted)">刻度：' +
    SKILL_SCALE.map(function (s) {
      return s.cn
    }).join(' → ') +
    '。评级日期 2026-10-22（第五十九轮收口）。进度只存在<b>这台浏览器</b>，不写库、不发请求，清数据即没；下面有导出按钮。</div>' +
    '</div>'

  var tools =
    '<h3 style="margin:18px 0 8px">没有 AI 时，你要有这九个动作</h3>' +
    '<div class="card">' +
    SKILL_TOOLS.map(function (t) {
      return (
        '<div style="padding:6px 0;border-bottom:1px solid #1e293b;font-size:13px"><b>' +
        skillEsc(t.k) +
        '</b>｜' +
        skillRaw(t.v) +
        '</div>'
      )
    }).join('') +
    '</div>'

  var quiz =
    '<h3 style="margin:18px 0 8px">六道自测题（先答再看答案）</h3>' +
    SKILL_QUIZ.map(function (q, i) {
      return (
        '<div class="card" style="margin-bottom:8px"><b>' +
        (i + 1) +
        '. </b>' +
        skillRaw(q.q) +
        '<details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;color:#38bdf8">看答案</summary>' +
        '<div style="font-size:13px;margin-top:6px">' +
        skillRaw(q.a) +
        '</div></details></div>'
      )
    }).join('')

  var stages =
    '<h3 style="margin:18px 0 8px">八段路线（每段的判据都是当场能验的）</h3>' +
    SKILL_STAGES.map(function (st) {
      return skillRenderStage(st, doneMap)
    }).join('')

  var foot =
    '<div class="card" style="border-left:3px solid #22c55e">' +
    '<b>最后一句实话</b><div style="margin-top:6px;font-size:13px">这个仓 59 轮里没有一轮是 AI 一个人做完的——每一轮的「这算不算好」都是你判的。' +
    '你现在缺的是动手那一半，而动手是可以按小时堆出来的：S0→S6 合计约 24 小时，摊成每周两次、每次 3 小时，八周。' +
    '到 S6 你就离得开 AI 维护它；到 S7 你能改它的算法。</div>' +
    '<div style="margin-top:10px"><button class="btn btn-primary" id="skill-export">导出我的进度（文本）</button>' +
    '<button class="btn btn-red" id="skill-reset" style="margin-left:8px">清空进度</button></div>' +
    '<textarea id="skill-out" rows="8" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:6px" placeholder="点上面的按钮，进度文本出来在这里，复制走贴进任何 md 存档"></textarea>' +
    '</div>'

  return (
    head +
    '<h3 style="margin:18px 0 8px">十条轴：我现在判你</h3>' +
    skillRenderAxes(selfMap) +
    stages +
    tools +
    quiz +
    foot
  )
}

function skillExportText() {
  var selfMap = skillRead('skill_self_axes_v1', {})
  var doneMap = skillRead('skill_steps_v1', {})
  var lines = ['# 我的编程水平与独立路线进度（导出于 ' + new Date().toISOString().slice(0, 10) + '）', '']
  lines.push('## 轴的自评（AI 评 / 我评）')
  SKILL_AXES.forEach(function (ax) {
    lines.push('- ' + ax.name + '：' + ax.ai + ' / ' + (typeof selfMap[ax.key] === 'number' ? selfMap[ax.key] : '未填'))
  })
  lines.push('')
  lines.push('## 路线完成度')
  SKILL_STAGES.forEach(function (st) {
    var done = st.steps.filter(function (_, i) {
      return !!doneMap[st.id + ':' + i]
    }).length
    lines.push('- ' + st.id + ' ' + st.title + '：' + done + '/' + st.steps.length + ' 步')
    st.steps.forEach(function (s, i) {
      lines.push('    - [' + (doneMap[st.id + ':' + i] ? 'x' : ' ') + '] ' + s.t.replace(/<[^>]+>/g, ''))
    })
  })
  lines.push('')
  lines.push('## 待办')
  lines.push('- 做完 S1 校准题后重判十条轴；S6 达成即视为「无 AI 辅助可独立交付一轮」。')
  return lines.join('\n')
}

/* ════════════════════════════════════════════════
   就地刷新（10-22 第三次点验后改）
   原来点一颗自评旋钮／勾一步都调 skillRefresh() 重建整页 innerHTML（约 3.7 万字），
   代价是滚动位置跳、焦点丢、整页闪一下，而且这页正是给人一条条点的。
   拆成两个 patch：处理函数只调它们，⛔ 不在正常路径里整页重排；
   只有找不到钩子（= 渲染与这里的 data-* 走岔了）才退回整页重排，宁可闪一下也不静默失灵。
   ════════════════════════════════════════════════ */
function skillPatchAxis(root, ax, nowLv) {
  var row = root.querySelector('[data-axis-row="' + ax.key + '"]')
  if (!row) {
    skillRefresh()
    return
  }
  row.querySelectorAll('button[data-axis]').forEach(function (x) {
    if (Number(x.dataset.lv) === nowLv) x.classList.add('btn-primary')
    else x.classList.remove('btn-primary')
  })
  var holder = row.querySelector('[data-axis-readout="' + ax.key + '"]')
  if (holder) holder.innerHTML = skillAxisReadout(ax, nowLv)
}

function skillPatchStage(root, st, doneMap) {
  var card = root.querySelector('[data-stage-row="' + st.id + '"]')
  if (!card) {
    skillRefresh()
    return
  }
  var all = st.steps.length
  var done = st.steps.filter(function (_, i) {
    return !!doneMap[st.id + ':' + i]
  }).length
  var bar = card.querySelector('[data-stage-bar="' + st.id + '"]')
  var cnt = card.querySelector('[data-stage-count="' + st.id + '"]')
  if (bar) bar.style.width = ((done / all) * 100).toFixed(0) + '%'
  if (cnt) cnt.textContent = done + '/' + all + ' 步'
}

function skillFindBy(list, keyName, key) {
  var hit = null
  list.forEach(function (it) {
    if (it[keyName] === key) hit = it
  })
  return hit
}

function skillWire(root) {
  root.querySelectorAll('button[data-axis]').forEach(function (b) {
    b.addEventListener('click', function () {
      var m = skillRead('skill_self_axes_v1', {})
      var key = b.dataset.axis
      var lv = Number(b.dataset.lv)
      var same = m[key] === lv
      if (same) delete m[key]
      else m[key] = lv
      skillWrite('skill_self_axes_v1', m)
      var ax = skillFindBy(SKILL_AXES, 'key', key)
      if (!ax) {
        skillRefresh()
        return
      }
      skillPatchAxis(root, ax, typeof m[key] === 'number' ? m[key] : null)
      if (typeof showToast === 'function') showToast(same ? '已撤销这一轴的自评' : '已记下你的自评', 'success')
    })
  })
  root.querySelectorAll('input[data-step]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var m = skillRead('skill_steps_v1', {})
      if (cb.checked) m[cb.dataset.step] = 1
      else delete m[cb.dataset.step]
      skillWrite('skill_steps_v1', m)
      var st = skillFindBy(SKILL_STAGES, 'id', cb.dataset.step.split(':')[0])
      if (!st) {
        skillRefresh()
        return
      }
      // 勾选框自身的选中态由浏览器维护，这里只改进度条与「n/m 步」
      skillPatchStage(root, st, m)
    })
  })
  var ex = root.querySelector('#skill-export')
  if (ex) {
    ex.addEventListener('click', function () {
      var out = root.querySelector('#skill-out')
      if (out) out.value = skillExportText()
    })
  }
  var rs = root.querySelector('#skill-reset')
  if (rs) {
    rs.addEventListener('click', function () {
      skillWrite('skill_self_axes_v1', {})
      skillWrite('skill_steps_v1', {})
      skillRefresh()
    })
  }
}

function skillRefresh() {
  var root = document.getElementById('skill-body')
  if (!root) return
  // admin.html 里 #skill-body 起手带 class="loading"，而 admin.css 的 .loading 规则（现量 :257）是
  // .loading { color: muted; text-align: center; padding: 40px } 是排版类不是显隐类 ——
  // 不清掉，整页内容会渲染出来但全居中、全灰、四周多 40px（10-22 真浏览器实测 innerHTML 36800 字符、class 仍是 loading）。
  // 本站既有渲染器（admin-data.js:327 renderFunctions / :456 renderRoutes）都是先 className = '' 再灌内容，这里跟齐。
  root.className = ''
  root.innerHTML = skillBuild()
  skillWire(root)
}

function skillInit() {
  var root = document.getElementById('skill-body')
  if (!root) return
  skillRefresh()
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', skillInit)
  else skillInit()
}

/* 供后台单测（backend/test/adminSkillPage.test.js）直接读数据结构；浏览器里 module 不存在 ⇒ 这段是空跳 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SKILL_SCALE: SKILL_SCALE,
    SKILL_AXES: SKILL_AXES,
    SKILL_STAGES: SKILL_STAGES,
    SKILL_TOOLS: SKILL_TOOLS,
    SKILL_QUIZ: SKILL_QUIZ,
  }
}
