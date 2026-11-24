/**
 * 对外四页＋首页壳的结构闸（2026-10-22 第五十九轮·第十四阶段第一步·组5）
 * ======================================================================
 * **为什么不是 prettier**：我上一轮提的"把 4 份 public html 也纳入格式闸"当场验过不成立
 *   （`prettier --check` 对这 4 份全 warn、`--write` 会把 1,623 行的展厅整页重排 ⇒ 39 个行号定位符全漂）。
 *   所以这一组换成**只做结构、不动一个字节**的轻量闸：它能挡住真实出过事的那几类——
 *   ① 中文写坏成 U+FFFD（本仓 api.ts 提交进 HEAD 的 2 个就是这类）；
 *   ② 标签不成对／少 `</script>` 让整页白屏（这几页全是内联脚本＋样式，没有构建期帮忙兜错）；
 *   ③ 引用到的本地文件改名后静默 404（展厅的 `/three/**` 靠 importmap 里的字符串，写错就是模块链断）；
 *   ④ 组3 新加的可发现性元信息被后来人删掉（canonical／description／noindex 一删就无声）。
 * ⛔ 本文件不启动服务、不碰数据库、不改任何页面字节——它是纯静态读盘，CI 里没 build 也能跑。
 *
 * 运行: node --test test/publicHtmlGate.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const APP = path.join(__dirname, '..', '..', 'app')
const PUB = path.join(APP, 'public')

// 对外域名：只从这两份文件里出现，⛔ 本机 127.0.0.1 不许写进 canonical（爬虫会把它当站名）
const ORIGIN = 'https://style.sparklove.cn'

/** [相对 app 的路径, 面向搜索引擎吗（true＝要 canonical＋description，false＝要 noindex）] */
const PAGES = [
  ['index.html', true],
  ['public/pay.html', false],
  ['public/creator.html', false],
  ['public/model-gallery.html', true],
  ['public/how-it-works.html', true],
]

/** 后端自己发、盘上没有对应文件的合法路径（server.js:250 的 /gallery 就是 sendFile 而非静态） */
const KNOWN_ROUTES = new Set(['/', '/gallery'])

const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf-8')

/** 成对标签各数一次：只数出现次数，不做语法解析——够用，因为这几页没有注释里写标签的写法 */
function countTag(src, tag) {
  const open = (src.match(new RegExp('<' + tag + '(\\s[^>]*)?>', 'gi')) || []).length
  const close = (src.match(new RegExp('</' + tag + '>', 'gi')) || []).length
  return { open, close }
}

test('五页都还是完整 HTML：doctype、标签成对、无 U+FFFD', () => {
  for (const [rel] of PAGES) {
    const src = read(rel)
    assert.ok(/^<!doctype html>/i.test(src.trimStart()), `${rel} 第一行不是 doctype`)
    assert.strictEqual(src.split('\uFFFD').length - 1, 0, `${rel} 里有 U+FFFD：中文被写坏了`)
    for (const tag of ['html', 'head', 'body', 'script', 'style']) {
      const { open, close } = countTag(src, tag)
      assert.strictEqual(close, open, `${rel} 的 <${tag}>/${tag}> 不成对（开 ${open} 闭 ${close}）`)
    }
    const title = src.match(/<title>([^<]*)<\/title>/i)
    assert.ok(title && title[1].trim().length > 4, `${rel} 的 <title> 是空的`)
  }
})

test('五页都有 charset＋viewport；可收录页有 description＋canonical，工作台页标 noindex', () => {
  for (const [rel, indexable] of PAGES) {
    const src = read(rel)
    assert.ok(/<meta\s+charset=/i.test(src), `${rel} 缺 charset`)
    assert.ok(/name="viewport"/i.test(src), `${rel} 缺 viewport`)
    if (indexable) {
      assert.ok(
        /name="description"\s+content="[^"]{20,}"/i.test(src),
        `${rel} 缺一句像样的 description`,
      )
      assert.ok(
        new RegExp(`<link rel="canonical" href="${ORIGIN.replace('.', '\\.')}[^"]*"`).test(src),
        `${rel} 缺指向对外域名的 canonical`,
      )
      assert.ok(/property="og:title"/.test(src), `${rel} 缺 og:title（分享到社交面板会空）`)
    } else {
      assert.ok(
        /name="robots" content="noindex/.test(src),
        `${rel} 是工作台／付款页，必须 noindex——被搜到等于把内部入口公开`,
      )
    }
  }
})

test('页面里写死的绝对路径引用，盘上必须真有（或在后端已知路由里）', () => {
  for (const [rel] of PAGES) {
    const src = read(rel)
    const refs = [...src.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)].map((m) => m[1])
    for (const u of [...new Set(refs)]) {
      if (KNOWN_ROUTES.has(u)) continue
      const cut = u.replace(/^\//, '')
      // /src/** 是 vite 开发入口（index.html 引 main.tsx，构建后换成 /assets/**）；
      // 其余绝对路径要么落在 app/（源码根）要么落在 app/public/（vite 原样拷进 dist 的那批）。
      const onDisk = fs.existsSync(path.join(APP, cut)) || fs.existsSync(path.join(PUB, cut))
      assert.ok(onDisk, `${rel} 引用了 ${u}，但 app 与 app/public 下都没有这个文件`)
    }
  }
})

test('展厅 importmap 能解析，且它指向的 /three/** 文件都在场', () => {
  const src = read('public/model-gallery.html')
  const block = src.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/i)
  assert.ok(block, 'importmap 块不见了：展厅的 three 模块链会整条断掉')
  const map = JSON.parse(block[1])
  assert.ok(map.imports && map.imports.three, 'importmap 里没有 three 入口')
  for (const v of Object.values(map.imports)) {
    if (!v.startsWith('/')) continue
    assert.ok(
      fs.existsSync(path.join(PUB, v.replace(/^\//, ''))),
      `importmap 指向 ${v}，但 app/public 下没有这份文件`,
    )
  }
})

test('robots.txt 与 sitemap.xml 口径一致，且只放三页', () => {
  const robots = read('public/robots.txt')
  const sitemap = read('public/sitemap.xml')
  assert.ok(/User-agent: \*/.test(robots), 'robots.txt 缺 User-agent: * 段')
  assert.ok(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), 'robots.txt 没把 sitemap 报出去')
  for (const p of [
    '/admin',
    '/api/',
    '/models/',
    '/uploads/',
    '/static/',
    '/pay.html',
    '/creator.html',
  ]) {
    assert.ok(robots.includes('Disallow: ' + p), `robots.txt 忘了挡 ${p}`)
  }
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  assert.strictEqual(locs.length, 3, `sitemap 应当只收录 3 页，现量 ${locs.length}`)
  // 只查 <loc>：文件顶部那段注释里就写着"⛔ 不放 /uploads"，按整串搜会把自己写的禁令当成违规
  assert.ok(
    !locs.some((l) => /\/(uploads|models|admin|api)\//.test(l)),
    `sitemap 里出现了不该收录的路径：${locs.filter((l) => /\/(uploads|models|admin|api)\//.test(l)).join(' ')}`,
  )
  for (const loc of locs) {
    assert.ok(loc.startsWith(ORIGIN + '/'), `sitemap 里有非对外域名的 URL：${loc}`)
    const p = loc.slice(ORIGIN.length) || '/'
    assert.ok(
      KNOWN_ROUTES.has(p) || fs.existsSync(path.join(PUB, p.replace(/^\//, ''))),
      `sitemap 指向 ${loc}，但这个路径既不是已知路由也没有对应文件`,
    )
  }
})

test('对外域名只有这一个写法：全仓 ⛔ 不许把 127.0.0.1 写进 canonical／sitemap', () => {
  for (const [rel] of PAGES) {
    const src = read(rel)
    const canonicals = [...src.matchAll(/rel="canonical" href="([^"]+)"/g)].map((m) => m[1])
    for (const c of canonicals) {
      assert.ok(c.startsWith(ORIGIN + '/'), `${rel} 的 canonical 写成了 ${c}`)
    }
    assert.ok(!/canonical[^>]*127\.0\.0\.1/.test(src), `${rel} 把本机地址写进了 canonical`)
  }
})
