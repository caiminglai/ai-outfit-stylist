/**
 * 测试侧的「按 method+path 找路由」唯一一处实现（11-03 拆分轮）。
 *
 * 为什么要有这个文件：`routes/wardrobe.js` 的「二、搭配组合管理」拆成
 * `routes/wardrobeOutfit.js`、由主文件**不带路径**地 `router.use(outfitRoutes)` 挂回原位置之后，
 * `/outfits` 这几条注册语句不在主 router 的第一层 stack 里了。原来两份测试各自抄了一遍
 * 平铺版 `findRoute`（`test/auditFixes20261012.test.js`、`test/routeLimiterCoverage.test.js`），
 * 于是"POST /outfits 必须存在"读成"不存在"⇒ 假红。⛔ 修法不是把断言放宽，
 * 是让它真的走到底：认子 router、认挂载前缀，找到的还是**同一个 Route 对象**，
 * 于是"闸挂没挂、是不是同一个实例"这类判据强度一点没降。
 *
 * 只判结构、不跑请求；端到端另有人做（`test/wardrobeDiaryRoutes.test.js` 那批是真发请求的，
 * 拆分那一轮它们 0 改动 0 失败——那才是"行为没变"的主证据）。
 */

/**
 * 把 Express 给中间件层编的正则还原成挂载路径：
 * `app.use('/api/auth', r)` 的 `layer.regexp.source` 是 `^\/api\/auth\/?(?=\/|$)`，
 * 去转义后从第一个 `/?` 截断即得 `/api/auth`；裸 `use(r)` 得到 `/`（＝前缀不变）。
 * 口径与 `scripts/gen-openapi.js` 的 `mountOf` 一致（那份是说明书侧的真相源，这里不引它：
 * 脚本会把整个 `server.js` 起起来，测试不该背这个代价）。
 */
function mountOf(layer) {
  const src = layer.regexp && layer.regexp.source
  if (!src) return null
  const unescaped = src.slice(1).replace(/\\(.)/g, '$1')
  const cut = unescaped.indexOf('/?')
  if (cut < 0) return null
  return unescaped.slice(0, cut) || '/'
}

/**
 * 深度优先找一条 Route（支持任意层子 router 与数组路径）。
 * 命中判据：完整路径（挂载前缀＋route.path）逐字等于传入的 routePath。
 */
function findRoute(router, method, routePath, prefix = '') {
  for (const layer of (router && router.stack) || []) {
    const r = layer.route
    if (r) {
      if (!r.methods[String(method).toLowerCase()]) continue
      const p = r.path
      const hit = Array.isArray(p)
        ? p.some((one) => prefix + one === routePath)
        : prefix + p === routePath
      if (hit) return r
      continue
    }
    if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      const mount = mountOf(layer)
      const next = mount && mount !== '/' ? prefix + mount : prefix
      const found = findRoute(layer.handle, method, routePath, next)
      if (found) return found
    }
  }
  return null
}

module.exports = { findRoute, mountOf }
