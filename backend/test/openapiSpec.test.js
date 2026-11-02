/**
 * OpenAPI 说明书的结构门（11-02 规范整改轮新增）
 * =================================================
 * 背景：接口清单以前只有两处人写的东西——前端 `app/src/api.ts` 和后台「接口路由」页。
 * 现在多了第三处 `docs/api/openapi.json`（机器可读，Swagger/Postman/Apifox 都能直接导入）。
 * 多一份清单就多一种腐烂方式，所以这个文件存在的唯一理由是：**它不信任生成器**。
 *
 * 与 `scripts/gen-openapi.js` 的关系是刻意对立的：
 *   - 生成器从 `app._router.stack` 抽清单（内部事实）；
 *   - 本文件用**自己写的一趟遍历**（不调用生成器的函数）重算同一张表，再和说明书比。
 * 两边算法独立，对上了才叫证据；共用一个函数就只是"自己等于自己"。
 *
 * 钉住的五件事：
 *   1) 说明书里的路径与方法 **不多不少** 等于服务真实注册的路由（防漂移，也是 --check 的语义级补充）；
 *   2) 每个 `{param}` 都有对应的 path 参数声明（工具生成客户端代码时靠这个，缺了就报错）；
 *   3) 每个操作都有 summary、至少一个 2xx、至少一个错误响应（空壳说明书最容易被将错就错）；
 *   4) 用到的 securityScheme / $ref 都在 components 里真的存在（悬空引用是 OpenAPI 最常见的红）；
 *   5) 生成是**确定性**的：`--check` 子进程回 rc=0，意味着同一条命令二次生成的字节与仓库里那份相同
 *      （输出里不含时间戳，排序全固定，这条才可能成立）。
 *
 * 运行: node --test test/openapiSpec.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// 生成器在 require 时就完成"起实例＋抽栈＋拼 spec"，并被刻意改成**不写盘、不退出**
// （见 gen-openapi.js 末尾的 require.main 分支），所以这里可以放心 require。
const { spec, text, outFile } = require('../scripts/gen-openapi')
const app = require('../server') // 与生成器同一份 require 缓存，拿到的就是它已经关掉的实例

const JSON_PATH_PARAMS = /\{([^}]+)\}/g

/** 本文件自己的一趟栈遍历：只认 Express 的 route.path / route.methods，不复用生成器的代码 */
function liveRoutes() {
  const out = new Set()
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]
        for (const m of Object.keys(layer.route.methods)) {
          if (m === '_all') continue
          for (const p of paths) out.add(`${m.toUpperCase()} ${norm(prefix + p)}`)
        }
        continue
      }
      if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        // 把 Express 编出来的正则还原成挂载串：`^\/api\/auth\/?(?=\/|$)` → `/api/auth`
        const src = layer.regexp && layer.regexp.source
        let mount = ''
        if (src) {
          const un = src.slice(1).replace(/\\(.)/g, '$1')
          const cut = un.indexOf('/?')
          if (cut >= 0) mount = un.slice(0, cut)
        }
        walk(layer.handle.stack, prefix + (mount === '/' ? '' : mount))
      }
    }
  }
  walk(app._router.stack, '')
  return out
}

/** 说明书里的每一个操作展开成 `METHOD 原始路径` 便于与 liveRoutes() 对齐（这里做同样的归一化） */
function specOps() {
  const out = new Set()
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const m of Object.keys(ops)) {
      out.add(`${m.toUpperCase()} ${norm(p.replace(/\{([^}]+)\}/g, ':$1'))}`)
    }
  }
  return out
}

// 生成器出表前会把 `router` 挂在 `/admin` 而 path 为 `/` 时产生的尾斜杠去掉
// （`/admin/` → `/admin`），比对两边必须用同一条归一化，否则每条挂载根都假报"漂移"。
const norm = (s) => (s.length > 1 ? s.replace(/\/+$/, '') : s)

test('说明书能解析，且是 OpenAPI 3.0.x', () => {
  const parsed = JSON.parse(text)
  assert.deepStrictEqual(parsed.openapi, spec.openapi)
  assert.match(spec.openapi, /^3\.0\.\d+$/, '3.1 的工具生态还没铺满，本仓按 3.0.3 出')
  assert.ok(spec.info && spec.info.title, 'info.title 是给对接方看的项目名，不能空')
  assert.strictEqual(
    spec.info.version,
    require(path.join(__dirname, '..', 'package.json')).version,
    '说明书版本要跟 backend/package.json 版本同源，别手写第二个版本号',
  )
  assert.ok(Object.keys(spec.paths).length > 100, '路径数掉下 100 说明生成器抽栈抽漏了')
})

test('路径与方法不多不少＝服务真实注册的路由（排除 SPA 兜底通配）', () => {
  // `app.get('*')` 这类通配兜底是前端 history 回退，不是接口，生成器刻意不收（见最后一条用例）
  const live = new Set([...liveRoutes()].filter((s) => !s.includes('*')))
  const doc = specOps()
  const onlyLive = [...live].filter((s) => !doc.has(s)).sort()
  const onlyDoc = [...doc].filter((s) => !live.has(s)).sort()
  assert.deepStrictEqual(onlyLive, [], '代码里有、说明书里没有：' + onlyLive.join(' | '))
  assert.deepStrictEqual(onlyDoc, [], '说明书里有、代码里没有：' + onlyDoc.join(' | '))
  assert.ok(doc.size >= 140, `操作数 ${doc.size} 比预期少，遍历可能塌了一层`)
})

test('每个 {param} 都声明为 path 参数且 required', () => {
  const bad = []
  for (const [p, ops] of Object.entries(spec.paths)) {
    const names = [...p.matchAll(JSON_PATH_PARAMS)].map((m) => m[1])
    if (!names.length) continue
    for (const [m, o] of Object.entries(ops)) {
      const declared = (o.parameters || []).filter((q) => q.in === 'path')
      for (const n of names) {
        const d = declared.find((q) => q.name === n)
        if (!d || d.required !== true) bad.push(`${m.toUpperCase()} ${p} 的 {${n}}`)
      }
    }
  }
  assert.deepStrictEqual(bad, [], '悬空路径参数（客户端生成器会直接报错）：' + bad.join(' | '))
})

test('每个操作都有 summary、至少一个 2xx、至少一个错误响应', () => {
  const bad = []
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [m, o] of Object.entries(ops)) {
      const codes = Object.keys(o.responses || {})
      const ok = codes.filter((c) => /^2\d\d$/.test(c))
      const err = codes.filter((c) => /^[45]\d\d$/.test(c))
      if (!o.summary || !o.summary.trim()) bad.push(`${m} ${p} 缺 summary`)
      if (!ok.length) bad.push(`${m} ${p} 没有 2xx`)
      if (!err.length) bad.push(`${m} ${p} 没有任何错误码`)
    }
  }
  assert.deepStrictEqual(bad, [], bad.join(' | '))
})

test('引用的 securityScheme 与 $ref 都在 components 里存在', () => {
  const schemes = new Set(Object.keys(spec.components.securitySchemes))
  const schemas = new Set(Object.keys(spec.components.schemas))
  const missing = []
  const refs = []
  JSON.stringify(spec, (k, v) => {
    if (k === '$ref' && typeof v === 'string') refs.push(v)
    return v
  })
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [m, o] of Object.entries(ops)) {
      for (const sec of o.security || []) {
        for (const name of Object.keys(sec)) {
          if (!schemes.has(name)) missing.push(`${m.toUpperCase()} ${p} → ${name}`)
        }
      }
    }
  }
  for (const r of refs) {
    const hit = /^#\/components\/schemas\/(\w+)$/.exec(r)
    if (!hit || !schemas.has(hit[1])) missing.push(`$ref ${r}`)
  }
  assert.deepStrictEqual(missing, [], '悬空引用：' + missing.join(' | '))
  assert.ok(schemes.has('SessionHeader') && schemes.has('AdminBearer'), '两种鉴权都得在表里')
})

test('限流闸写进了说明书，且与 routes/admin.js 自述的口径一致', () => {
  const gated = []
  const free = []
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [m, o] of Object.entries(ops)) {
      const r = o['x-rate-limit']
      if (r) gated.push({ p, m, ...r })
      else free.push(`${m.toUpperCase()} ${p}`)
    }
  }
  // 148 条操作里 143 条带闸：总闸 100 次/15 分（scope=global）、后台 API 自己的
  // 600 次/60 秒（scope=prefix，routes/admin.js:31 只挂 `/api` 子树）、各路由自带的更紧一道。
  assert.ok(gated.length >= 140, `标了限流的操作只有 ${gated.length} 条，闸大概率没被认出来`)
  assert.ok(
    gated.some((g) => g.max === 100 && g.window_ms === 900000 && g.scope === 'global'),
    'server.js 的 /api 总闸（100 次 / 15 分钟）必须在场，否则它的挂载方式变了而生成器没跟上',
  )
  assert.ok(
    gated.some((g) => g.max === 600 && g.window_ms === 60000 && g.scope === 'prefix'),
    '后台 API 那道 600 次/60 秒的前缀级闸要在场（router.use("/api", adminApiLimiter)）',
  )
  // routes/admin.js 开头注释白纸黑字写着"三个后台页面不吃这道闸"，说明书必须与它一致；
  // 反过来若哪天有人给页面也挂上闸，这条会红，逼着两边一起改口径。
  const adminPages = ['GET /admin', 'GET /admin/login', 'GET /admin/learn']
  for (const p of adminPages) {
    assert.ok(free.includes(p), `${p} 按 routes/admin.js 的注释不该被限流，说明书里却有闸`)
  }
  assert.ok(
    gated.filter((g) => g.p.startsWith('/admin/api/')).length >= 5,
    '/admin/api/* 应当全部带上那道 600 次/60 秒的闸',
  )
})

test('生成是确定性的：--check 子进程与仓库里那份逐字节相同', () => {
  const backend = path.join(__dirname, '..')
  assert.ok(fs.existsSync(outFile), `${outFile} 不在盘上，CI 第一步就会因缺文件而红`)
  const r = spawnSync(
    process.execPath,
    [path.join(backend, 'scripts', 'gen-openapi.js'), '--check'],
    {
      cwd: backend,
      encoding: 'utf-8',
      timeout: 120000,
    },
  )
  assert.strictEqual(
    r.status,
    0,
    `--check 回 ${r.status}：代码与 docs/api/openapi.json 漂移了，或生成器本身报错。\n` +
      `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
  )
  // 子进程重跑一遍再与盘上文件比：证明"没有把运行时刻印进输出"
  const onDisk = fs.readFileSync(outFile, 'utf-8')
  assert.strictEqual(JSON.parse(onDisk).info.title, spec.info.title)
})

test('SPA 兜底通配没被当成接口写进说明书', () => {
  const wild = Object.keys(spec.paths).filter((p) => p.includes('*'))
  assert.deepStrictEqual(
    wild,
    [],
    '`app.get("*")` 不是数据接口，写进去会让工具误认一个名为 * 的参数',
  )
})
