/**
 * 行号定位符体检工具（2026-10-30 第六十四轮起常驻）
 *
 * 全仓文档与代码注释里写着「某文件.js:某行」这类定位符，代码一改这些号就会静默挪歪，
 * 而 html／md 都不在任何门禁射程内（prettier 只覆盖 js 那批 glob，eslint 也只看 js），
 * 所以历史上没人报这一下——10-29 引擎拆分＋10-30 排版与窄屏补正之后，实测积到 275 条。
 * 这个脚本把那把盘外临时尺搬进仓库：它只读、不改文件、不联网。
 *
 * 判据（五问里的第三、第五问，能机械判的部分）：
 *   越界    号超过被指文件行数
 *   空行    那一行是空的
 *   号偏    它点名的标识符出现在 ±2 行内（11-04 起，锚点前面最近两条反引号标识符参与"赦免"，分母口径不动）
 *   指错句  那一行非空、但没写它点名的标识符（号活着、句子已经不是那句）
 *   在位    那一行确实含它点名的标识符
 *   判不了  锚点后面没有反引号标识符可当尺子（这一类只计数，不当它是对的）
 *
 * 用法: node scripts/check-locators.js [--list]
 *   --list  额外逐条打印「引用方:行号 ⇒ 被指文件:号 原因」
 * 第二向：代码注释里指向 `.md:行号` 的锚点（md 不在门禁里，往它插行会静默挪歪被引用的硬规矩那几行）。
 * 第三向：同一行里裸写的续号 `:1013`（不带文件名，归属＝它之前、行内最近且能定位的那个文件名）。
 *   这一向只判「越界／空行」，判不了内容——裸号旁边没有标识符可对，所以它的数是上限、不是精确欠账。
 * 退出码恒为 0（这是体检不是门禁；要让 CI 拦红请另加阈值判断，别默认打开）。
 *
 * 11-03 扩容：被指文件的索引面从「backend|app/src 的 js/ts」扩到再加
 * 「app/public|backend/static|backend/templates 的 html/css」，扫描面同步加 html/css
 * （html 注释里也写定位符）。这层跟着 assets:check 门禁一起立：静态页有门禁管内容，
 * 但它被按行号引用这件事以前没人查。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const readTracked = () =>
  execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {
    cwd: REPO,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((f) => f && !/node_modules|package-lock/.test(f))

// 被指文件只索引 backend/ 与 app/src/ 下的 js/ts（11-03 起再加 app/ 根下那份单层配置，
// 教程页按行号引 `app/vite.config.ts` 的 proxy 块），外加 11-03 起入门禁的静态页与样式
// （仓内的 html/css/js：app/public 那几页、backend/static、backend/templates、app/index.html、
//  app/src/index.css，连 vendor 进来的 three.js 也算——文档按行号引它们，而往 html 插一行
//  会静默挪歪全仓对它的行号引用，不设这层索引就查不到。app/dist 是构建产物、不索引）；
// 同名多份时靠目录前缀消歧
const buildIndex = (files, restrict) => {
  const src = files.filter((f) =>
    restrict
      ? (/\.(js|ts)$/.test(f) &&
          (/^(backend|app\/src)\//.test(f) || /^app\/[^/]+\.[jt]s$/.test(f))) ||
        (/\.(html|css|js)$/.test(f) && !/^app\/dist\//.test(f))
      : true,
  )
  const byPath = new Set(src)
  const byName = {}
  for (const f of src) {
    const b = path.basename(f)
    byName[b] = byName[b] || []
    byName[b].push(f)
  }
  return { byPath, byName }
}

const resolve = (token, idx) => {
  const t = token.replace(/^\.\//, '')
  if (idx.byPath.has(t)) return t
  const hits = idx.byName[path.basename(t)] || []
  if (hits.length === 1) return hits[0]
  const suf = hits.filter((h) => h.endsWith(t))
  return suf.length === 1 ? suf[0] : null
}

// 11-04 加的"判留名单"：这些引用方是**带日期的记录**（快照/台账/一次性实施计划），
// 里面的行号是当时现量，按台账规矩只加限定、不改写，所以它们进"要动"不等于欠账。
// 原口径提醒只点了三类（docs/复盘/、docs/进展报告/、路线本文档），实测漏了
// docs/依据/（台账本身，只往末尾追加、快照不回头改）、文件名带 8 位日期的 md
// （如 docs/架构审计与优化蓝图-20261019.md，43 条）、docs/superpowers/plans/（一次性计划，10 条）。
// ⛔ 这是给"要动"加一个拆法，不是改"要动"的定义——趋势数照旧可比，多的那一行才是要干活的量。
const SNAPSHOT =
  /^(?:docs\/(?:复盘|进展报告|依据|superpowers\/plans)\/|docs\/形象设计模型-现状与路线\.md)|-20\d{6}\.md$/
const isSnapshot = (f) => SNAPSHOT.test(f)

const main = () => {
  const all = readTracked()
  const files = all.filter((f) => /\.(md|js|ts|html|css)$/.test(f))
  const idx = buildIndex(all, true)
  const idxAny = buildIndex(all, false)
  const cache = {}
  const load = (rel) => {
    if (!cache[rel]) {
      try {
        const L = fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n').split('\n')
        cache[rel] = { L, max: L[L.length - 1] === '' ? L.length - 1 : L.length }
      } catch {
        cache[rel] = null
      }
    }
    return cache[rel]
  }
  const re = /([A-Za-z0-9._/-]+\.(?:js|ts|html|css)):(\d{1,5})/g
  const cls = { 在位: 0, 越界: 0, 空行: 0, 号偏: 0, 指错句: 0, 定位不到: 0, 判不了: 0 }
  const split = { 判留: 0, 待办: 0 }
  const todoSrc = {}
  const tailSplit = { 判留: 0, 待办: 0 }
  const perTarget = {}
  const perSrc = {}
  const rows = []
  for (const f of files) {
    let text
    try {
      text = fs.readFileSync(path.join(REPO, f), 'utf8')
    } catch {
      continue
    }
    text.split(/\r?\n/).forEach((ln, i) => {
      let m
      re.lastIndex = 0
      while ((m = re.exec(ln)) !== null) {
        const rel = resolve(m[1], idx)
        const n = Number(m[2])
        const key = f + ':' + (i + 1) + ' ⇒ ' + m[1] + ':' + n
        if (!rel) {
          cls.定位不到++
          rows.push('定位不到 ' + key)
          continue
        }
        const c = load(rel)
        if (!c) {
          cls.定位不到++
          rows.push('定位不到(读不出) ' + key)
          continue
        }
        const tail = ln.slice(m.index + m[0].length, m.index + m[0].length + 60)
        // 11-04 加赦免尺：锚点**前面**那两条反引号标识符也参与"在位"判定。
        // 原盲区③实测把「`markPaid`（`routes/payment.js:209-236`）」这种主语在前的写法
        // 误报成指错句（后面那条抓到的是 `paid`，行里写的是 markPaid，大小写不同就判歪）。
        // 只留像标识符的 token（反引号里是文件路径的丢掉）。
        const cands = (seg) =>
          (seg.match(/`([^`\s]{3,40})`/g) || [])
            .map((s) => s.slice(1, -1).replace(/[（(，,、。:：].*$/, ''))
            .filter((s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s))
        const beforeIds = cands(ln.slice(Math.max(0, m.index - 70), m.index))
          .slice(-2)
          .reverse()
        // ⛔ 分母一字不动：能不能判，只看锚点后面**第一条**反引号里的 token 是不是标识符
        // （与 10-30 起同一把尺）。试过两种放宽：取后面两条 ⇒ 可判 609⇒713；前后都算可判
        // ⇒ 一趟把 339 条"判不了"新判成"指错句"、要动 558⇒773。那都是换尺子不是收口，
        // 趋势数立刻不可比。前面那两条只当**赦免尺**：主语写在锚点前的句子（原盲区③）
        // 靠它回到在位，不新增定罪。
        const firstRaw = (tail.match(/`([^`\s]{3,40})`/) || [])[1]
        const firstId = firstRaw ? firstRaw.replace(/[（(，,、。:：].*$/, '') : null
        const judgeable = !!(firstId && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(firstId))
        const ids = judgeable ? beforeIds.concat([firstId]) : []
        const id = judgeable ? firstId : null
        let why = '在位'
        if (n > c.max || n < 1) why = '越界'
        else if (c.L[n - 1].trim() === '') why = '空行'
        else if (!judgeable) why = '判不了'
        else if (ids.some((s) => c.L[n - 1].includes(s))) why = '在位'
        else if (
          [n - 2, n - 1, n].some(
            (k) => k >= 1 && k <= c.max && ids.some((s) => c.L[k - 1].includes(s)),
          )
        )
          why = '号偏'
        else why = '指错句'
        cls[why]++
        if (why === '越界' || why === '空行' || why === '号偏' || why === '指错句') {
          perTarget[rel] = (perTarget[rel] || 0) + 1
          perSrc[f] = (perSrc[f] || 0) + 1
          if (isSnapshot(f)) split.判留++
          else {
            split.待办++
            todoSrc[f] = (todoSrc[f] || 0) + 1
          }
          rows.push(
            why +
              ' ' +
              key +
              (id ? ' 点名 ' + id : '') +
              ' ⇒ 那行=' +
              JSON.stringify(c.L[n - 1] === undefined ? '越界' : c.L[n - 1].trim().slice(0, 46)),
          )
        }
      }
    })
  }
  const bad = cls.越界 + cls.空行 + cls.号偏 + cls.指错句
  const judged = cls.在位 + bad
  console.log(
    '[定位符体检] 扫描面 ' +
      files.length +
      ' 份（tracked 的 md+js+ts+html+css，除 node_modules/package-lock）',
  )
  console.log(
    '  第一向（带文件名的锚点）' +
      (judged + cls.判不了 + cls.定位不到) +
      ' 个：可判 ' +
      judged +
      ' ⇒ 在位 ' +
      cls.在位 +
      '／要动 ' +
      bad,
  )
  console.log(
    '    要动拆解：越界 ' +
      cls.越界 +
      '／空行 ' +
      cls.空行 +
      '／号偏(±2 行) ' +
      cls.号偏 +
      '／指错句 ' +
      cls.指错句,
  )
  console.log(
    '    要动按引用方拆（判留名单＝check-locators.js 里 SNAPSHOT 那条正则）：快照判留 ' +
      split.判留 +
      '／待办(引用方是现状文档或代码注释) ' +
      split.待办 +
      (split.待办
        ? '：' +
          Object.entries(todoSrc)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([k, v]) => v + ' ' + k)
            .join('｜')
        : ''),
  )
  console.log(
    '    判不了（锚点旁没有反引号标识符，不计入在位也不计入要动）' +
      cls.判不了 +
      '／定位不到（文件名不在索引面：backend|app/src 的 js/ts ＋ 除 app/dist 外的 html/css）' +
      cls.定位不到,
  )
  const top = (o) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  console.log(
    '  要动条数最多的被指文件：' +
      top(perTarget)
        .map(([k, v]) => v + ' ' + k)
        .join('｜'),
  )
  console.log(
    '  要动条数最多的引用方：' +
      top(perSrc)
        .map(([k, v]) => v + ' ' + k)
        .join('｜'),
  )
  // 第二向：代码注释里指向 .md 的行号锚点。md 不在任何门禁里，往它插一行会静默挪歪被引用的那一句，
  // 而被引用的往往是硬规矩那几行（docs/依据/README.md:64「缺测不出分」现量被 5 处代码注释引着）。
  const mdFiles = files.filter((x) => x.endsWith('.md'))
  const resolveMd = (tok) => {
    const t = tok.replace(/^\.\//, '')
    if (mdFiles.includes(t)) return t
    const hits = mdFiles.filter((m) => m.endsWith('/' + t))
    return hits.length ? hits[0] : null
  }
  const reMd = /([^\s`<>|:*?"'()（）]+\.md):(\d{1,5})/g
  const codeFiles = files.filter((x) => /^(backend|app\/src)\//.test(x) && /\.(js|ts)$/.test(x))
  const mdCls = { 在场: 0, 越界: 0, 空行: 0, 定位不到: 0 }
  for (const f of codeFiles) {
    const text = fs.readFileSync(path.join(REPO, f), 'utf8').replace(/\r\n/g, '\n')
    text.split('\n').forEach((ln, i) => {
      let m2
      reMd.lastIndex = 0
      while ((m2 = reMd.exec(ln)) !== null) {
        const rel2 = resolveMd(m2[1])
        const n2 = Number(m2[2])
        const key2 = f + ':' + (i + 1) + ' ⇒ ' + m2[1] + ':' + n2
        if (!rel2) {
          mdCls.定位不到++
          rows.push('md定位不到 ' + key2)
          continue
        }
        const c2 = load(rel2)
        if (!c2) {
          mdCls.定位不到++
          rows.push('md定位不到(读不出) ' + key2)
          continue
        }
        if (n2 > c2.max || n2 < 1) {
          mdCls.越界++
          rows.push('md越界 ' + key2 + '（该 md 共 ' + c2.max + ' 行）')
          continue
        }
        if (c2.L[n2 - 1].trim() === '') {
          mdCls.空行++
          rows.push('md空行 ' + key2)
          continue
        }
        mdCls.在场++
      }
    })
  }
  console.log(
    '  第二向（代码注释→.md 的行号）：' +
      (mdCls.在场 + mdCls.越界 + mdCls.空行 + mdCls.定位不到) +
      ' 条 ⇒ 在场 ' +
      mdCls.在场 +
      '／越界 ' +
      mdCls.越界 +
      '／空行 ' +
      mdCls.空行 +
      '／定位不到 ' +
      mdCls.定位不到,
  )
  // 第三向：同一行里裸写的续号。归属＝该裸号之前、行内最近出现且能在仓内定位的那个文件名（不限扩展名，
  // 因为文档常用「`README.md:55`⇒`:58`」这种 md 引 md 的写法，只索引 js/ts 会把它错归给同行的代码文件）。
  const NAME = '[A-Za-z0-9._/-]+\\.(?:js|ts|tsx|jsx|md|html|css|json|yml|yaml|sql|sh|cjs|mjs|txt)'
  // 11-04 收掉盲区⑤的第一类：`)` 之后的 `:NNN` 不再当裸续号认领。
  // 判据（可复跑）＝仓根 `git ls-files '*.md' '*.js' '*.ts' | xargs grep -oE "\\):[0-9]{1,5}" | wc -l`
  // = **79 处**，落在 **68 行**（`grep -c` 逐文件求和），逐行读过全是期刊"卷(期):起页"
  // （`Coloration Technology 135(4):292`、`Photochem Photobiol 98(1):127`、`Proc R Soc B 266(1415):211`），
  // **没有一处是行号锚点**——本仓写锚点一律是 `文件名:NN`，冒号前必是文件名。
  // ⚠️ 这是收紧认领、不是放宽判据：分母会掉（原来这些页码被当成"归属某文件的裸续号"计进可判）。
  //    实测前后：第三向 可判 1865⇒1862／要动 674⇒671／待办 3⇒1（余下那条是 README 端口，同轮把写法改成"5000 端口"⇒待办 0）。
  // ⛔ 别顺手把 `)` 加回字符类：那等于让每条期刊引用都变成一条假"续号越界"。
  // ⛔ 标准年号（`CIE 15:2004`）不在这 79 里——它冒号前是数字，本来就被 `\\w` 挡着，别把它当成本改动的功劳。
  const reTail = new RegExp(
    '(' + NAME + ')(?::\\d{1,5}(?:-\\d{1,5})?)?|(?<![\\w./:\\-)]):(\\d{1,5})(?![\\d%])',
    'g',
  )
  const tailCls = { 在位: 0, 越界: 0, 空行: 0, 归属不在仓内: 0, 之前无文件名: 0 }
  const tailPerDoc = {}
  for (const f of files) {
    let text
    try {
      text = fs.readFileSync(path.join(REPO, f), 'utf8')
    } catch {
      continue
    }
    text.split(/\r?\n/).forEach((ln, i) => {
      let owner = null
      reTail.lastIndex = 0
      let m3
      while ((m3 = reTail.exec(ln)) !== null) {
        if (m3[1]) {
          owner = resolve(m3[1], idxAny)
          continue
        }
        const n3 = Number(m3[2])
        if (!Number.isFinite(n3) || n3 < 1) continue
        if (!owner) {
          tailCls.之前无文件名++
          continue
        }
        const c3 = load(owner)
        if (!c3) {
          tailCls.归属不在仓内++
          continue
        }
        let why = '在位'
        if (n3 > c3.max) why = '越界'
        else if (c3.L[n3 - 1].trim() === '') why = '空行'
        tailCls[why]++
        if (why !== '在位') {
          tailPerDoc[f] = (tailPerDoc[f] || 0) + 1
          if (isSnapshot(f)) tailSplit.判留++
          else {
            tailSplit.待办++
            todoSrc[f + '（裸续号）'] = (todoSrc[f + '（裸续号）'] || 0) + 1
          }
          if (rows.length < 4000)
            rows.push(
              '续号' +
                why +
                ' ' +
                f +
                ':' +
                (i + 1) +
                ' ⇒ 裸 :' +
                n3 +
                ' 归 ' +
                owner +
                '（' +
                c3.max +
                ' 行）',
            )
        }
      }
    })
  }
  const tailBad = tailCls.越界 + tailCls.空行
  console.log(
    '  第三向（同行裸续号 `:NNN`，只判行数不判内容）：可判 ' +
      (tailCls.在位 + tailBad) +
      ' ⇒ 在位 ' +
      tailCls.在位 +
      '／要动 ' +
      tailBad +
      '（越界 ' +
      tailCls.越界 +
      '＋空行 ' +
      tailCls.空行 +
      '）／判不了：归属不在仓内 ' +
      tailCls.归属不在仓内 +
      '＋之前无文件名 ' +
      tailCls.之前无文件名,
  )
  console.log(
    '    续号要动最多的文档：' +
      top(tailPerDoc)
        .map(([k, v]) => v + ' ' + k)
        .join('｜'),
  )
  console.log(
    '    续号要动按引用方拆：快照判留 ' + tailSplit.判留 + '／待办(非判留名单) ' + tailSplit.待办,
  )
  if (process.argv.includes('--list')) rows.forEach((r) => console.log('    ' + r))
  console.log(
    '[定位符体检] 已知盲区：①第三向能数裸续号，但它只判「越界／空行」、判不了内容，且归属靠"行内最近的文件名"——' +
      '一句话里跨文件、跨栏时会归错，所以第三向的数是上限而不是精确欠账；' +
      '②目标是 html/css 的锚点从 11-03 起也算进第一向（含 app/index.html、app/src/index.css 这类构建入口与样式，但 app/dist 那份产物不建索引）；' +
      '③"锚点前带主语的句子误报成指错句"这条从 11-04 起已收掉：判据仍只看锚点后第一个反引号标识符（分母一字没动），' +
      '但把锚点前最近两条也当**赦免项**用——前后任一命中即算在位。⚠️ 别把它改成"前后都算判据"，实测那样可判 609⇒892、' +
      '要动 558⇒773，同一把尺子的分母被自己吹大，趋势数就没法比了；' +
      '残余的指错句是句子点名的东西确实没写进那一行，那种才是要按内容重指的；' +
      '④句子在讲历史号时（句中有"旧号／原写／改前／拆分前"这类限定词）判据无从知道，照样计入指错句或越界——那类按台账只加限定、不改写，' +
      '要辨别就看引用方那份文件在不在快照名单里、或把那句话读一遍，工具不替我拍板；' +
      '⑤非行号的冒号数字曾被第三向当成裸续号认领，实测两类，11-04 都已收掉：' +
      '期刊卷期页码（"13 卷 4 期 191 到 208 页"那种写法）已由判据处理——`)` 之后的 `:NNN` 不再认领，见上面 reTail 那几行；' +
      '端口号（README 目录树那行）由文档写法处理——已从 `:5000` 改写成"5000 端口"。' +
      '⚠️ 残余风险是新的冒号数字（时间 `12:30`、比例 `2:1` 这类）照样会被当裸续号认领，那还是虚账，别当欠账处理。',
  )
  console.log(
    '[定位符体检] 口径提醒：要动 ≠ 全是欠账。句子里写着"旧号/原写/改前/拆分前"的是故意留的历史号，' +
      '按台账规矩只加限定、不改写；带日期的记录（快照）同判留，11-04 起名单已并成 SNAPSHOT 那条正则：' +
      'docs/复盘/、docs/进展报告/、docs/依据/（台账只往末尾追加）、docs/superpowers/plans/（一次性实施计划）、' +
      'docs/形象设计模型-现状与路线.md，加上任何文件名以 8 位日期结尾的 md——所以"要动"旁边多给了一行' +
      '"按引用方拆：快照判留／待办"，**只有待办那一栏是要干活的量**，趋势对比要看待办、不要看要动。' +
      '只有把某号当**现状**讲的句子（"现量""现号""代码在""落点"）才要按内容重指——' +
      '而且只能逐条按内容重指，不许整批加位移（实测有些号在插行之前就已经指错句子）。',
  )
}

main()
