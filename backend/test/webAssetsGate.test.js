/**
 * 第六道门自身的守卫测试（11-03 建档）
 * ============================================================
 * `scripts/check-web-assets.js` 查的是 static/templates/public 这三处**不在任何门禁里**的
 * 第一方资产（`.prettierignore:7-8` 排除了 static/ 与 templates/，eslint 的 backend ignores
 * 也一样，app 侧 `globalIgnores(['dist','public'])`）。新门自己也得有正负两向证据：
 *   ① 真仓库现在这份必须 PASS（否则这道门一挂上 CI 就红）；
 *   ② 造一份坏 fixture 必须 FAIL —— 只会亮绿的门等于没有门。
 * fixture 建在系统临时目录里，不往仓库与 `E:/website/files` 落任何东西。
 *
 * 运行: node --test test/webAssetsGate.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const BACKEND = path.join(__dirname, '..')
const CHECKER = path.join(BACKEND, 'scripts', 'check-web-assets.js')

/** 在临时目录里搭一棵最小仓库树：app/public + backend/{static,templates,scripts,routes} + docs/api */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's3-assets-'))
  const mkdir = (p) => fs.mkdirSync(path.join(root, p), { recursive: true })
  mkdir('app/public')
  mkdir('backend/static/admin')
  mkdir('backend/templates')
  mkdir('backend/scripts')
  mkdir('backend/routes')
  mkdir('docs/api')
  fs.copyFileSync(CHECKER, path.join(root, 'backend', 'scripts', 'check-web-assets.js'))
  fs.writeFileSync(
    path.join(root, 'backend', 'server.js'),
    "const express=require('express')\nconst app=express()\napp.get('/gallery', (q,r)=>r.send('ok'))\n",
  )
  fs.writeFileSync(
    path.join(root, 'docs', 'api', 'openapi.json'),
    JSON.stringify({ paths: { '/api/health': {} } }),
  )
  return root
}

function runChecker(root) {
  const r = cp.spawnSync(
    process.execPath,
    [path.join(root, 'backend', 'scripts', 'check-web-assets.js')],
    {
      encoding: 'utf8',
    },
  )
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

test('真仓库过第六道门：check-web-assets 退出码必须是 0', () => {
  const r = cp.spawnSync(process.execPath, [CHECKER], { encoding: 'utf8', cwd: BACKEND })
  assert.strictEqual(r.status, 0, '体检输出：\n' + (r.stdout || '') + (r.stderr || ''))
  assert.match(r.stdout, /ASSETS OK/)
})

test('fixture 坏样子必须 FAIL：缺 doctype/lang/charset/title、引用悬空、后台 JS 语法坏', () => {
  const root = makeFixture()
  try {
    fs.writeFileSync(
      path.join(root, 'app', 'public', 'broken.html'),
      '<html><body><script src="/no-such-file.js"></script><a href="/static/admin/gone.js">x</a></body></html>',
    )
    fs.writeFileSync(path.join(root, 'backend', 'static', 'admin', 'broken.js'), 'function {(;')
    const { rc, out } = runChecker(root)
    assert.strictEqual(rc, 1, '坏 fixture 必须挡住，输出：\n' + out)
    assert.match(out, /缺 <!DOCTYPE html>/)
    assert.match(out, /没有 lang/)
    assert.match(out, /缺 <meta charset>/)
    assert.match(out, /<title> 空或缺/)
    assert.match(out, /\/no-such-file\.js/)
    assert.match(out, /JS 语法不过/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('fixture 好样子必须 PASS：引用能落到文件、后端路由与 openapi 路径上', () => {
  const root = makeFixture()
  try {
    fs.writeFileSync(
      path.join(root, 'app', 'public', 'good.html'),
      '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>好页</title>' +
        '<link rel="stylesheet" href="/static/admin/admin.css"></head>' +
        '<body><a href="/gallery">展厅</a><a href="/api/health">探针</a><a href="#top">锚点</a>' +
        '<a href="https://example.com/x">外链</a><script src="/static/admin/ok.js"></script></body></html>\n',
    )
    fs.writeFileSync(path.join(root, 'backend', 'static', 'admin', 'admin.css'), 'body{margin:0}')
    fs.writeFileSync(
      path.join(root, 'backend', 'static', 'admin', 'ok.js'),
      'var a = 1\nconsole.log(a)\n',
    )
    fs.writeFileSync(
      path.join(root, 'app', 'public', 'robots.txt'),
      'User-agent: *\nDisallow: /admin\n',
    )
    fs.writeFileSync(
      path.join(root, 'app', 'public', 'sitemap.xml'),
      '<urlset><url><loc>https://x.com/gallery</loc></url></urlset>',
    )
    const { rc, out } = runChecker(root)
    assert.strictEqual(rc, 0, '好 fixture 不该误报，输出：\n' + out)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('robots 与 sitemap 打架必须响：sitemap 收了被 Disallow 的页', () => {
  const root = makeFixture()
  try {
    fs.writeFileSync(
      path.join(root, 'app', 'public', 'ok.html'),
      '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>页</title></head><body></body></html>\n',
    )
    fs.writeFileSync(
      path.join(root, 'app', 'public', 'robots.txt'),
      'User-agent: *\nDisallow: /gallery\n',
    )
    fs.writeFileSync(
      path.join(root, 'app', 'public', 'sitemap.xml'),
      '<urlset><url><loc>https://x.com/gallery</loc></url></urlset>',
    )
    const { rc, out } = runChecker(root)
    assert.strictEqual(rc, 1, '收录口径自相矛盾必须挡住，输出：\n' + out)
    assert.match(out, /Disallow 吞掉|自相矛盾/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
