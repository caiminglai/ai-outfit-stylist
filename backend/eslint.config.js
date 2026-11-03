// 后端 ESLint flat config(CommonJS 版,与前端风格统一)
// 用法: npx eslint .  或  npm run lint
const js = require('@eslint/js')
const globals = require('globals')
const prettierConfig = require('eslint-config-prettier')

module.exports = [
  {
    // vendor/ 是原样拷进来的第三方源码(实测 912 条 no-var 之类全是上游 ES5 写法),与 .prettierignore 同口径
    ignores: [
      'node_modules/',
      'static/',
      'templates/',
      'uploads/',
      'scripts/scan-report.json',
      'vendor/',
    ],
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
]
