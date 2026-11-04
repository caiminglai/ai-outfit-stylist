/**
 * 后台公共脚本 admin-utils.js 的标签表与 API 前缀常量守卫（2026-11-04 规范轮新建）。
 *
 * 为什么要钉住它：`backend/static/` 从 11-04 才进 ESLint 的扫描面，而它跑在浏览器里、
 * 不在任何一条 `fetch` 断言的射程内 ⇒ 改错这一份文件，CI 一道门都不会红，坏法是"后台某列显示原始 1／0"
 * 这种没人当场发现的软错。本轮就当场踩了一次反例，所以把它做成测试：
 *   ① 六份布尔列标签表的键**只保留字符串形态**（11-04 删掉了同时裸写的 `1:／0:` 那半，12 条 no-dupe-keys）。
 *      对象属性名最终都是字符串，`{1:'a','1':'b'}` 里两次写的是同一个键 ⇒ 删除行为不变；
 *      但这条只能靠断言证明"数字 1 与字符串 '1' 查出来是同一个标签"，不能靠读代码。
 *   ② 四个 API 前缀常量（RULES_API／INV_API／MODELS_API／CATEGORY_LABELS）必须在场、值必须还是那几个，
 *      而且在别的文件里**真有调用方**。本轮有一把用法探针把"`NAME + '/x'`"这种拼接式调用漏判成零调用，
 *      差点把在用的常量当死代码删掉（是 ESLint 的 no-undef 把它兜回来的）——这条断言就是那次事故的常驻记账。
 *   ③ ESLint 那份跨文件全局名单必须覆盖这四个名字，否则 static 面重新变瞎。
 *
 * ⛔ 这里只证"标签查得到、常量在场"，不证后台页面真渲染成什么样——真浏览器那一次另记。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const STATIC_DIR = path.join(__dirname, '..', 'static', 'admin')
const UTILS_JS = path.join(STATIC_DIR, 'admin-utils.js')

// 浏览器里这份脚本是纯顶层 var／function 声明（不碰 DOM 就能求值），所以给它一个最小 sandbox 就够。
function loadUtils() {
  const src = fs.readFileSync(UTILS_JS, 'utf-8')
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    location: { href: '/admin' },
    setTimeout: () => 0,
    clearTimeout: () => {},
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'admin-utils.js' })
  return sandbox
}

const U = loadUtils()

/** 六份"启用／禁用"类标签表：本轮删掉的就是它们后半段的数字键 */
const BOOL_TABLES = [
  'rule_groups.enabled',
  'inventory_products.enabled',
  'model_configs.enabled',
  'admin_users.is_active',
  'creator_works.featured',
  'customer_sessions.synced',
]

test('admin-utils.js 能在无 DOM 环境下求值，且六个标签表都在场', () => {
  assert.strictEqual(
    typeof U.translateValue,
    'function',
    'translateValue 没导出到全局 ⇒ 顶层结构被动过',
  )
  for (const key of BOOL_TABLES) {
    assert.ok(U.VALUE_LABELS[key], `VALUE_LABELS 里缺 ${key}`)
  }
})

test('六份布尔表的键只剩字符串那半，且数字 1／0 与字符串查的是同一个标签（删除行为不变的证据）', () => {
  for (const key of BOOL_TABLES) {
    const table = U.VALUE_LABELS[key]
    assert.deepStrictEqual(
      Object.keys(table).sort(),
      ['0', '1'],
      `${key} 的键应当恰好是 '0' 与 '1' 两个字符串（11-04 之前是四条写两遍）`,
    )
    // 数字形态照样命中：hasOwnProperty 会把 1 转成 '1'，所以库里回整数还是回字符串都翻得出来
    assert.strictEqual(table[1], table['1'], `${key} 数字 1 与字符串 '1' 查到了不同值`)
    assert.strictEqual(table[0], table['0'], `${key} 数字 0 与字符串 '0' 查到了不同值`)
    assert.ok(
      table['1'] && table['0'] && table['1'] !== table['0'],
      `${key} 两个标签不能为空或同名`,
    )
  }
})

test('translateValue 对整数与字符串两种回值给出同一个中文标签', () => {
  const cases = [
    ['rule_groups', 'enabled'],
    ['inventory_products', 'enabled'],
    ['model_configs', 'enabled'],
    ['admin_users', 'is_active'],
    ['creator_works', 'featured'],
    ['customer_sessions', 'synced'],
  ]
  for (const [t, c] of cases) {
    const a = U.translateValue(t, c, 1)
    const b = U.translateValue(t, c, '1')
    assert.strictEqual(a, b, `${t}.${c} 的 1 与 '1' 翻译结果不同`)
    assert.notStrictEqual(a, 1, `${t}.${c} 没被翻译，页面会显示原始 1`)
    assert.strictEqual(U.translateValue(t, c, 0), U.translateValue(t, c, '0'))
  }
  // 列值恰好是 constructor／toString 这类原型属性名时不许顺着原型链拿函数（ownLabel 那段注释的现证）
  assert.strictEqual(U.translateValue('rule_groups', 'enabled', 'constructor'), 'constructor')
})

test('四个 API 前缀常量在场、值没漂移（11-04 差点被误判成死代码删掉的那四个）', () => {
  assert.strictEqual(U.API_BASE, '/admin/api')
  assert.strictEqual(U.RULES_API, '/api/rules')
  assert.strictEqual(U.INV_API, '/api/inventory')
  assert.strictEqual(U.MODELS_API, '/api/models')
  assert.deepStrictEqual(
    Object.keys(U.CATEGORY_LABELS).sort(),
    ['穿搭', '妆容', '发型', '配饰', '姿势'].sort(),
  )
})

test('这四个常量在每个使用它的兄弟脚本里都真有调用点（词边界判据，不是"后面紧跟括号"那种窄尺）', () => {
  const users = {
    RULES_API: 'admin-rules.js',
    INV_API: 'admin-inventory.js',
    MODELS_API: 'admin-models.js',
    CATEGORY_LABELS: 'admin-rules.js',
  }
  // 调用形状：三个前缀是「常量 + 路径段」的拼接式，CATEGORY_LABELS 是当函数实参递出去的
  // （`ownLabel(CATEGORY_LABELS, v)`）。11-04 那把误判的尺子只认后面紧跟 ( = . 的写法，
  // 拼接式一条都不算命中 ⇒ 四种形状里至少两种要在断言里点名，不然换个写法就又瞎了。
  const shape = (name) =>
    name === 'CATEGORY_LABELS' ? new RegExp(name + '\\s*,') : new RegExp(name + '\\s*\\+')
  for (const [name, file] of Object.entries(users)) {
    const src = fs.readFileSync(path.join(STATIC_DIR, file), 'utf-8')
    const hits = src.split('\n').filter((l) => new RegExp('\\b' + name + '\\b').test(l))
    // 至少 2 行：一行是文件头的「依赖:」注释，其余是真调用点
    assert.ok(
      hits.length >= 2,
      `${name} 在 ${file} 里只剩 ${hits.length} 行 ⇒ 它不再是"在用常量"，要删就整个删干净`,
    )
    assert.ok(
      hits.some((l) => shape(name).test(l)),
      `${name} 在 ${file} 里没有预期的调用形状那行了——用法变了，这把判据要跟着改`,
    )
  }
})

test('ESLint 那份跨文件全局名单覆盖这四个名字与两个翻译函数（否则 static 面等于没入门禁）', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'eslint.config.js'), 'utf-8')
  assert.ok(
    /static\/\*\*\/\*\.js/.test(cfg),
    'eslint.config.js 里没有 static 那一档 ⇒ static/ 又回到门禁之外',
  )
  assert.ok(
    /pageGlobals/.test(cfg),
    'pageGlobals 那段现扫名单没了 ⇒ 跨文件引用会重新打成一片 no-undef',
  )
  // 名单是运行时从各文件顶层扫出来的，这里验"扫得出"这件事本身：四个名字都得是某个文件的顶层声明
  const topLevel = new Set()
  for (const f of fs.readdirSync(STATIC_DIR)) {
    if (!f.endsWith('.js')) continue
    const src = fs.readFileSync(path.join(STATIC_DIR, f), 'utf-8')
    for (const m of src.matchAll(/^var\s+([A-Za-z_$][\w$]*)/gm)) topLevel.add(m[1])
    for (const m of src.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) topLevel.add(m[1])
  }
  for (const n of [
    'RULES_API',
    'INV_API',
    'MODELS_API',
    'CATEGORY_LABELS',
    'translateValue',
    'ownLabel',
  ]) {
    assert.ok(
      topLevel.has(n),
      `${n} 不再是任何文件的顶层声明 ⇒ pageGlobals 扫不到它，引用它的文件会 no-undef`,
    )
  }
})
