// 后端 ESLint flat config(CommonJS 版,与前端风格统一)
// 用法: npx eslint .  或  npm run lint
const fs = require('fs')
const path = require('path')
const js = require('@eslint/js')
const globals = require('globals')
const prettierConfig = require('eslint-config-prettier')

// 后台那 7 份页面脚本（static/admin/*.js）靠 window 全局互相引用：admin-data.js 调 admin-utils.js 的
// escapeHtml／apiCall／State，templates/admin.html 里另有 7 处 onclick 直接点函数名。ESLint 按文件建
// 作用域，看不见别的文件里的顶层声明 ⇒  naive 地 lint 会打出 631 条 no-undef，绝大多数是这种跨文件引用。
// 这份名单不手写，从各文件顶层的 `var X`／`function X(` 现扫（尺子＝下面那段循环）：新增一个跨文件用的
// 全局不必回头改配置，而打错的变量名照样被 no-undef 抓到——它不会出现在任何文件的顶层声明里。
const pageGlobals = {}
for (const f of fs.readdirSync(path.join(__dirname, 'static', 'admin'))) {
  if (!f.endsWith('.js')) continue
  const txt = fs.readFileSync(path.join(__dirname, 'static', 'admin', f), 'utf8')
  for (const m of txt.matchAll(/^var\s+([A-Za-z_$][\w$]*)/gm)) pageGlobals[m[1]] = 'writable'
  for (const m of txt.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) pageGlobals[m[1]] = 'writable'
}

module.exports = [
  {
    // vendor/ 是原样拷进来的第三方源码(实测 912 条 no-var 之类全是上游 ES5 写法),与 .prettierignore 同口径
    // static/ 从 11-04 起不再排除：它是后台页的真实运行代码，下面有专门一档规则集管着（templates/ 里没有 js，维持排除）
    ignores: ['node_modules/', 'templates/', 'uploads/', 'scripts/scan-report.json', 'vendor/'],
  },
  // 预定义推荐规则集
  js.configs.recommended,
  // 关闭与 Prettier 冲突的格式规则
  prettierConfig,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // 未使用变量:警告(_ 开头的参数/变量忽略)
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 调试日志要能被 lint 发现：**应用代码里一条 console.* 都不许留**（11-03 收口）。
      // 原来这条是 `['warn', { allow: ['warn', 'error'] }]`——把 warn/error 放行等于给
      // "报错只落 stdout、不进 logs/server-*.log"开了正门，routes 里 160 处、services 里
      // 10 处、middleware 1 处就是这么攒起来的，而且 warn 是绿色告警没人当错误查。
      // 现在提到 error 并由 CI 兜住：落盘只有 utils/logger 一个出口，写日志的人不用先猜
      // 这一条到底有没有留档。命令行工具（scripts/、db/ 的一次性建库与迁移脚本）与
      // logger 本体在下面各自的 override 里放行——它们的 stdout 就是交付物。
      'no-console': 'error',
      // 强制 const 优先
      'prefer-const': 'warn',
      // 禁止 var
      'no-var': 'error',
      // 禁止空函数体(catch 块除外)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 循环引用安全
      'no-self-assign': 'error',
    },
  },
  {
    // scripts/ 是一次性维护脚本:报告全靠 stdout 打印,关掉该规则
    // 297 处 console.log 里 245 处集中在这里,不区分会把真正的告警彻底淹掉
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // 与 scripts/ 同一个理由：db/ 下的建库与迁移脚本（init.js 20 条、两份 migrate 各 20 条、
    // add-rules/export-rules/seed 共 79 条）是人在终端里手工跑的命令行工具，stdout 就是它们的
    // 交付物；它们不在请求路径上，落不落 logs/server-*.log 与排障无关。
    // utils/logger.js 是唯一被允许直接碰 console 的文件——它就是那个把 console 的内容同时
    // 写进文件的那一层，关掉它这条规则就成了自指。
    // test/ 关它有两个具体原因：①`node --test` 的 stdout 就是 TAP 协议本身，②
    // `test/quietFilesFixes20261013.test.js:159-197` 要**改写 console.log/error 本身**来
    // 拦住 logger 往 stdout 打的那几行（不拦就污染 TAP 解析），那条测试不引用 logger 的别名，
    // 所以关掉这条不会给应用代码开后门。
    files: ['db/**/*.js', 'test/**/*.js', 'utils/logger.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // 后台页面脚本（static/admin/*.js，11-04 起进 lint 面）——四条规则的口径都按现量定，不是随手放宽：
    // · no-var / prefer-const 关掉：这 7 份文件通篇 ES5（`grep -c '=>' ` 与 `grep -cE '\b(const|let)\b'` 两侧都回 0），
    //   而且顶层 `var State`／`function escapeHtml` 就是在造 window 上的共享面——改成 let/const 会把它从全局对象上摘掉，
    //   另外 6 份文件与 html 里的 onclick 当场找不到名字。这不是风格问题，是行为问题，所以宁可不动。
    // · no-console 关掉：浏览器侧没有 utils/logger 那层落盘通道，console 就是后台唯一的日志出口（排障靠 F12）。
    // · no-unused-vars 收成 vars:'local' + caughtErrors:'none'：顶层声明是页面公共面（跨文件与 onclick 都在用，
    //   尺子＝backend/static＋backend/templates＋app/public 共 21 份 js/html 逐个 grep），按文件判"没用到"是假账；
    //   函数内的局部未用变量照报。caughtErrors:'none' 只对 7 条空 `catch (e)`——把它们改成 ES2019 的
    //   `catch {` 才是零告警，但那等于给一批 ES5 文件引入新语法，代价与收益不匹配。
    // · no-redeclare 关掉：上面那份 pageGlobals 把这 171 个名字声明成了全局，而它们确实就在某个文件顶层
    //   `var`／`function` 出来——这条规则在这里只会把"公共面按本页面惯例各文件都写一遍声明"报成错。
    //   ⚠️ 一次真差点出事：先头的用法探针用「名字后面紧跟 ( = . 」当命中判据，漏掉了 `RULES_API + '/schema'`
    //   这种拼接式调用，把四个仍在用的常量读成"零调用方"、差点删掉；是这条 no-undef 把它们兜回来了。
    //   结论记在这儿：判"没人用"要用词边界那条尺子，且删前必须让 lint 面跑一遍。
    // · 真账（已当场修掉，不在这里放行）：12 条 no-dupe-keys，是 `'1'` 与 `1` 在对象里同一个键、
    //   两份值抄了一遍，11-04 把冗余那半删掉（行为不变，admin-utils.js 803 行一字没挪）。
    files: ['static/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...pageGlobals,
      },
    },
    rules: {
      'no-var': 'off',
      'prefer-const': 'off',
      'no-console': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': [
        'warn',
        { vars: 'local', args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
]
