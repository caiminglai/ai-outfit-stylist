#!/usr/bin/env node
/**
 * 站3 前端第一方资产体检（第六道门，11-03 建档）
 * ============================================================
 * 为什么需要它：`backend/static/`、`backend/templates/`、`app/public/` 这三处共 54 份文件
 * 原来不在任何一道门里——prettier 的 js 通配符被 `.prettierignore:7-8` 显式排除了
 * `static/`、`templates/`；eslint 的 backend 配置 ignores 里也有它们（`eslint.config.js:12-13`）；
 * app 侧 `globalIgnores(['dist','public'])`。于是后台页面与四个公开 html 改坏了、链接指向一个
 * 已经不存在的路径，五道门全绿也不会响。更麻烦的是 `app.get('*')` 那条 SPA 兜底：
 * 一个写错的 `/xxx` 链接不返 404，而是返回整份 index.html ⇒ 人看到的是"页面在，内容不对"。
 *
 * 检查五件事（只读，不改任何文件）：
 *   1. HTML 基本盘：doctype / `<html lang>` / `<meta charset>` / 非空 `<title>`
 *   2. 本地引用可解析：`src`/`href` 里以 `/` 开头或相对的路径，必须能在
 *      app/public 的文件、backend/static 的文件、后端路由表（server.js + openapi.json）里找到落点
 *   3. robots.txt 与 sitemap.xml 口径一致：sitemap 里的 URL 不得被 robots 的 Disallow 吞掉
 *   4. 后台 JS 语法：`node --check` 级别的解析（vm.Script），浏览器直发的经典脚本不经打包
 *   5. 覆盖面自证：本文件扫到的第一方清单打出来，新增 html/js 自动进检查，不需要维护名单
 *
 * 用法：cd backend && npm run assets:check
 * 退出码：0=PASS 1=FAIL（有硬伤就挡住 CI）
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const BACKEND = path.join(__dirname, '..')
const ROOT = path.join(BACKEND, '..')

/** 第三方原样件：three.js 构建产物与打包器（与 eslint/prettier 的忽略口径一致，别去格式化上游） */
const VENDOR_PREFIXES = ['app/public/three/', 'app/public/qrcode.js']

const fail = []
const info = []

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}
/** 递归列出目录里的文件，返回仓库根相对路径（posix 分隔） */
function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name
    if (e.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const allFiles = []
for (const d of ['app/public', 'backend/static', 'backend/templates']) {
  if (fs.existsSync(path.join(ROOT, d))) walk(d, allFiles)
}
const isVendor = (f) => VENDOR_PREFIXES.some((v) => f === v || f.startsWith(v))
const firstParty = allFiles.filter(
  (f) => !isVendor(f) && !/\.(webp|png|jpg|ico|gif|woff2?)$/i.test(f),
)

// ---------- 后端路由表：server.js 的字面路径 + openapi.json 的 paths ----------
function routeTable() {
  const set = new Set()
  const specPath = path.join(ROOT, 'docs', 'api', 'openapi.json')
  if (fs.existsSync(specPath)) {
    try {
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
      for (const p of Object.keys(spec.paths || {})) set.add(p)
    } catch (e) {
      fail.push('openapi.json 解析失败：' + e.message)
    }
  }
  const sources = []
  if (fs.existsSync(path.join(BACKEND, 'server.js'))) sources.push(read('backend/server.js'))
  const rd = path.join(BACKEND, 'routes')
  if (fs.existsSync(rd)) {
    for (const f of fs.readdirSync(rd).filter((x) => x.endsWith('.js'))) {
      sources.push(fs.readFileSync(path.join(rd, f), 'utf8'))
    }
  }
  for (const src of sources) {
    const re = /\b(?:app|router)\.(get|post|put|delete|patch|use|all)\(\s*(['"`])(\/[^'"`\s]*)\2/g
    let m
    while ((m = re.exec(src))) set.add(m[3])
  }
  return set
}
const ROUTES = routeTable()
const routePrefixes = [...ROUTES].map((p) => p.replace(/\/:[^/]*$/, '').replace(/\*$/, ''))

/** 一条站内引用能不能落地：文件在盘上，或能在路由表里找到（含挂在子树下的写法） */
function resolveLocal(ref, fromRel) {
  const clean = ref.split('#')[0].split('?')[0]
  if (clean === '') return { ok: true, why: '锚点/查询' }
  if (/^(https?:|data:|mailto:|tel:|javascript:)/i.test(clean)) return { ok: true, why: '外部' }
  if (!clean.startsWith('/')) {
    // 相对写法：从当前文件所在目录找
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), clean))
    if (fs.existsSync(path.join(ROOT, rel))) return { ok: true, why: '相对文件 ' + rel }
    return { ok: false, why: '相对文件不存在 ' + rel }
  }
  const inPublic = 'app/public' + clean
  if (exists(inPublic)) return { ok: true, why: 'app/public 文件' }
  const inStatic = 'backend/static' + clean
  if (exists(inStatic)) return { ok: true, why: 'backend/static 文件' }
  if (exists('backend' + clean)) return { ok: true, why: 'backend 文件' }
  if (
    ROUTES.has(clean) ||
    routePrefixes.some((p) => p && (clean === p || clean.startsWith(p + '/')))
  ) {
    return { ok: true, why: '后端路由' }
  }
  return { ok: false, why: '既不是盘上的文件，也不在后端路由表里' }
}

// ---------- 1、2) HTML 体检 ----------
const htmls = firstParty.filter((f) => f.endsWith('.html'))
for (const rel of htmls) {
  const src = read(rel)
  if (!/^\s*<!doctype html>/i.test(src)) fail.push(rel + '：缺 <!DOCTYPE html>')
  const htmlTag = src.match(/<html\b[^>]*>/i)
  if (!htmlTag || !/\blang=/.test(htmlTag[0]))
    fail.push(rel + '：<html> 上没有 lang（屏幕阅读器与翻译按它判语言）')
  if (!/<meta\b[^>]*charset/i.test(src))
    fail.push(rel + '：缺 <meta charset>（中文页没它会被按 GBK 读成乱码）')
  const t = src.match(/<title>([\s\S]*?)<\/title>/i)
  if (!t || !t[1].trim()) fail.push(rel + '：<title> 空或缺（搜索引擎与收藏列表都读它）')

  // 本地引用；模板字符串拼出来的 src（"' + esc(o.url) + '"）不是静态路径，跳过
  const refs = [...src.matchAll(/\b(?:src|href|action)=(["'])([^"']+)\1/g)].map((m) => m[2])
  for (const ref of refs) {
    if (/[{}<>]|\+\s|\.\.\.|\/\*/.test(ref)) continue // JS 拼的
    const r = resolveLocal(ref, rel)
    if (!r.ok) fail.push(rel + '：引用 ' + ref + ' —— ' + r.why)
  }
}

// ---------- 3) robots.txt 与 sitemap.xml 口径 ----------
{
  const robotsRel = 'app/public/robots.txt'
  const sitemapRel = 'app/public/sitemap.xml'
  if (exists(robotsRel) && exists(sitemapRel)) {
    const robots = read(robotsRel)
    const disallows = [...robots.matchAll(/^Disallow:\s*(\/\S*)/gim)]
      .map((m) => m[1])
      .filter((p) => p !== '')
    const locs = [...read(sitemapRel).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    for (const l of locs) {
      const p = '/' + l.replace(/^https?:\/\/[^/]+\/?/, '')
      for (const d of disallows) {
        if (p === d || p.startsWith(d)) {
          fail.push('sitemap 收了 ' + p + ' 但 robots.txt Disallow ' + d + ' ⇒ 收录口径自相矛盾')
        }
      }
      const r = resolveLocal(p, sitemapRel)
      if (!r.ok) fail.push('sitemap 里的 ' + p + ' —— ' + r.why)
    }
    info.push(
      'robots.txt 的 Disallow 共 ' +
        disallows.length +
        ' 条／sitemap.xml 的 URL 共 ' +
        locs.length +
        ' 条',
    )
  } else {
    info.push('robots.txt 或 sitemap.xml 不在场，跳过口径比对')
  }
}

// ---------- 4) 第一方 JS 语法（后台那几份浏览器直发脚本） ----------
const jss = firstParty.filter((f) => f.endsWith('.js'))
for (const rel of jss) {
  const src = read(rel)
  try {
    new vm.Script(src, { filename: rel })
  } catch (e) {
    // 只报语法错误（ESM 的 import/export 在 vm.Script 里必然报错，这类单独记一笔不算硬伤）
    if (
      /import |export /.test(src.slice(0, 4000)) &&
      /Cannot use import statement|Unexpected token 'export'|Unexpected token 'import'/.test(
        e.message,
      )
    ) {
      info.push(rel + '：ESM 写法，vm.Script 判不了语法（跳过）')
      continue
    }
    fail.push(rel + '：JS 语法不过 —— ' + e.message)
  }
}

// ---------- 输出 ----------
console.log('[资产体检] 第一方清单（自动扫，不维护名单）：' + firstParty.length + ' 份')
console.log(
  '  ' +
    firstParty
      .map((f) => f.replace(/^(app\/public|backend\/static|backend\/templates)\//, ''))
      .sort()
      .join('　'),
)
console.log(
  '  路由表：' + ROUTES.size + ' 条（openapi.json paths + server.js/routes 里的字面路径）',
)
for (const l of info) console.log('  注：' + l)
if (fail.length) {
  console.log('ASSETS FAIL ' + fail.length + ' 条：')
  for (const f of fail) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log(
  'ASSETS OK  ' +
    firstParty.length +
    ' 份第一方资产全部过检（html 基本盘／本地引用可解析／robots 与 sitemap 口径／后台 JS 语法）',
)
process.exit(0)
