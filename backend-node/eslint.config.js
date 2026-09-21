// 后端 ESLint flat config(CommonJS 版,与前端风格统一)
// 用法: npx eslint .  或  npm run lint
const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/', 'static/', 'templates/', 'uploads/', 'scripts/scan-report.json'],
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
      // 允许 console(后端日志必需)
      'no-console': 'off',
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
];
