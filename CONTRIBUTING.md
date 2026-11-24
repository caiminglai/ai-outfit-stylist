# 参与贡献

感谢参与 Style AI。提交 Issue 或 PR 前，请阅读本文件、[行为准则](CODE_OF_CONDUCT.md)和[安全政策](SECURITY.md)。

## 贡献流程

1. 较大改动先开 Issue，说明问题、方案与影响范围；小修复可直接提交 PR。
2. Fork 仓库，从 `main` 新建分支；一个 PR 只解决一个主题。
3. 修改代码时补充或调整测试，并同步受影响的文档。
4. 按下方清单自检，使用 PR 模板说明变更原因、测试证据及安全/数据/文档影响。
5. 维护者审查通过后合并；请及时回应审查意见，勿强制推送覆盖他人工作。

## 本地环境

- 使用 **Node.js 24**，先运行 `node -v` 确认主版本为 24。
- 所有命令均在仓库根目录执行：

```bash
node -v
npm ci --prefix app
npm ci --prefix backend --ignore-scripts
```

依赖以锁文件为准，不要用 `npm install` 代替 `npm ci`，不要提交 `node_modules`。后端必须保留 `--ignore-scripts`，以使用包内 SQLite 预编译绑定，避免 npm 自动调用 Python/node-gyp 编译。

## 临时数据库与开发启动

本地开发和测试不得使用运行库、部署卷或真实业务数据。仓库跟踪的 `backend/db/styleai.db` 是公开脱敏演示快照，只含规则、库存分类和 `PortfolioBot` 登记，不是可写运行库。后端单测及 Playwright 会自动在系统临时目录重建 SQLite 库，并在正常退出时清理；异常终止后的残留目录须确认属于本次测试后再删除。

修改 schema 或种子后，按需刷新公开快照；生成器只允许替换已经通过校验的演示库：

```bash
node backend/scripts/generate-demo-db.js --replace
node backend/scripts/generate-demo-db.js --check
```

手动启动后端时显式指定临时路径，且不得读取或提交 `.env`：

```bash
mkdir -p .tmp/dev/uploads
STYLEAI_DB_PATH="$PWD/.tmp/dev/styleai.db" \
STYLEAI_UPLOAD_DIR="$PWD/.tmp/dev/uploads" \
NODE_ENV=development \
SECRET_KEY="local-dev-only-secret-change-me-32-chars" \
ADMIN_PASSWORD="local-dev-only-admin-password" \
npm start --prefix backend
```

上面的固定口令只用于显式 `NODE_ENV=development` 的本机临时库；生产、预发和任何对外部署必须生成独立随机值，公开示例值会被启动门禁拒绝。

PowerShell 的完整可复制命令见 [README 的 PowerShell 启动章节](README.md#快速开始nodejs-24-原生运行)。前端另开终端运行 `npm run dev --prefix app`。不要对运行库执行 `npm run seed --prefix backend`。

## 测试与检查

```bash
# 前端：typecheck 实际执行 tsc -b --force
npm run format:check --prefix app
npm run typecheck --prefix app
npm run lint --prefix app
npm test --prefix app
npm run build --prefix app

# 后端
npm run format:check --prefix backend
npm run lint --prefix backend
npm test --prefix backend
npm run openapi:check --prefix backend
npm run assets:check --prefix backend
```

涉及页面流程时，先构建前端并安装项目内 Chromium，再运行 E2E：

```bash
npm run build --prefix app
PLAYWRIGHT_BROWSERS_PATH="$PWD/app/.tmp/playwright-browsers" \
  npm --prefix app exec playwright install chromium
npm run test:e2e --prefix app
```

## 规则、预览与模型边界

- **规则修改必须同步种子和测试**：同一 PR 更新对应的 `backend/db/seed/rules*.json` 与 `backend/test/` 回归用例；涉及基础快照时保持 `rules.json` 与增量种子一致。新增规则使用唯一的 `source_key`，从空临时库验证匹配、开关、依据分档和反馈计数，不得只改运行库。
- **28 个预览与模型不动**：`app/public/model-previews/` 下 28 个预览图及本机 `models/` 下 28 个模型目录保持原样，不删除、改名、覆盖、重新生成或提交。模型功能 PR 不得夹带这些资产变更；确需调整须先开 Issue 单独讨论。
- 第三方 PMX、纹理及模型目录仅留本机；仓库只允许分发项目自有且授权清晰的演示模型。

## 禁止提交的内容

- 真实运行数据库及伴生/备份文件，例如通过 `STYLEAI_DB_PATH` 创建的 `*.db`、`*.db-wal`、`*.db-shm`、`*.bak`。唯一例外是仓库内由生成器维护的脱敏演示快照 `backend/db/styleai.db`。
- `.env`、`.env.local`、密钥、证书、Token 和真实凭据；只参考 `.env.example`。
- 用户上传与运行产物，例如 `backend/uploads/`、`upload_data/`、日志和临时数据库。
- 任何第三方 PMX 模型；演示模型也必须具备明确授权与来源说明。
- 论文、国标、出版物扫描件等原文，包括 `docs/依据/papers/`；仅提交可公开的引用、摘要或自有说明。
- 构建产物、浏览器缓存、测试报告及依赖目录。

## 提交 PR 前

- [ ] 已运行受影响范围的格式、类型、lint、单测与构建检查；E2E 按需运行。
- [ ] 测试只使用临时数据库，未接触 `.env`、运行库、上传目录或真实用户数据。
- [ ] 规则改动已同步种子和回归测试；28 个预览与模型未变。
- [ ] 已执行 `git diff --check` 和 `git status --short`，确认仅包含本 PR 文件，无禁止内容和意外密钥。
- [ ] PR 写明测试命令及结果；未运行的项目明确标注原因，不把未执行写成通过。
