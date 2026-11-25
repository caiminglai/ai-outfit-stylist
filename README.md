# Style AI · 私人形象定制工作台

一个可本地复现的穿搭建议与 3D 形象展示项目。核心推荐由**数据驱动规则引擎**完成，
不是自研大模型；推荐文案当前是确定性本地模板，天气、同步照片试穿是在接入后才启用的可选外部能力。

## 现在能做什么

- 游客建档、手机号注册/登录、长期档案与表单草稿；游客数据可在注册/登录时原子过户。
- 门店/个人双模式推荐：规则组匹配、衣橱候选注入、天气可选输入、依据分档、反馈与历史记录。
- 个人衣橱、化妆品柜、配饰柜、搭配日记、心愿单与跨柜联动。
- Three.js + MMDLoader 的 PMX 展厅；配置人物模型后可点击进入服务页，未配置时显示明确空状态。
- 照片上传与虚拟试穿：配置外部服务时调用，失败或未配置时明确降级，不伪造成功。
- 创作者作品提交、后台审核、广场与分享；支付回调、人工凭证审核和付费报告权限已有代码与离线测试。
- 管理后台可维护规则、库存、模型、用户业务数据与审核状态；敏感列在输出前脱敏。

## 明确边界

- **规则引擎不是 LLM**。`/api/recommend/enhance` 当前只生成本地规则版结构化文案；`LLM_API_*` 是预留变量，运行时未使用。
- **公开仓库不包含支付凭据**。支付回调、查单和权限逻辑有离线测试；作者运营的线上站点另外配置了支付宝，其他 fork 不会自动开通。是否启用以 `GET /api/payment/qrcodes` 的开关为准，代码存在不等于真实结算已验收。
- **自动面容识别未开放**。`POST /api/analysis/face` 返回 501，当前改用手动肤色/脸型档案。
- **异步试穿未开放**。可用的是同步 `/api/tryon/direct`；仅部署配置外部服务后，才会把完成试穿所需的人物与服装图片提供给外部服务。未配置时不会发起真实调用，返回人物原图并标记 `degraded`。
- 仓库和 Docker 镜像不分发人物模型；本机第三方 PMX 不进入 Git 或镜像，需由部署环境单独挂载并确认授权。

## 架构

```text
浏览器
  ├─ React SPA（app/src，构建到 app/dist）
  └─ /gallery（app/public/model-gallery.html + Three.js/MMDLoader）
        │
        ▼
Express（backend/server.js）
  ├─ routes/   业务 API 与统一 { success, data?, error? } 信封
  ├─ services/ 规则匹配、档案、上传、支付校验、推荐报告
  └─ middleware/ 会话、限流、签名上传访问、脱敏
        │
        ▼
SQLite（backend/db/schema.sql + backend/db/seed/*.json，WAL）
```

生产构建由 Express 直接提供 `app/dist`、`/gallery`、`/three` 与模型文件；Vite 只用于源码开发。
运行数据库、上传文件和本机第三方模型都不应提交。仓库内 `backend/db/styleai.db` 是从 schema 与种子生成的脱敏演示快照；实际开发、测试和部署通过 `STYLEAI_DB_PATH` 使用独立运行库。Compose 使用命名卷保存数据库、上传和模型。

## 公开演示数据库

`backend/db/styleai.db` 可供检查、复现和二次开发，但不是运行库。它只包含规则和库存分类，不登记人物模型；管理员、用户、会话、支付、上传及业务表均为空。当前快照为 378 个规则组、929 个条件、1879 个动作、6 个库存分类和 0 个模型配置。

```bash
# 校验仓库内的公开快照
node backend/scripts/generate-demo-db.js --check

# 修改 schema 或种子后，刷新已存在的脱敏快照并再次校验
node backend/scripts/generate-demo-db.js --replace
node backend/scripts/generate-demo-db.js --check
```

生成器默认拒绝覆盖已有文件；`--replace` 也只接受已经通过隐私与完整性校验的演示库，不会覆盖真实运行库。本地原生开发请继续使用 `.tmp/dev/styleai.db`，Compose 使用 `/data/db/styleai.db` 命名卷。

## 快速开始：Docker Compose

需要 Node.js 24（宿主运行校验用）与 Docker Compose **2.24.0 或更高版本**（`env_file.required` 需要该版本）。

```bash
cp .env.example .env
# 编辑 .env，替换 SECRET_KEY 和 ADMIN_PASSWORD；不要提交该文件
docker compose config
docker compose up -d --build
curl http://127.0.0.1:5000/health
```

打开 `http://127.0.0.1:5000`。首次启动从 schema 和种子建库；镜像不自带人物模型，展厅会显示空状态，信息填写与搭配报告不受影响。
数据保存在 `db_data`、`upload_data`、`model_data` 命名卷中；不会挂载宿主运行库或第三方模型目录。需要 3D 人物时，在 `model_data` 卷中放入已获授权的 PMX 与纹理，并重启服务扫描登记。

## 快速开始：Node.js 24 原生运行

先执行 `node -v`，确认主版本不低于 24。以下命令显式使用 `development` 和项目内临时数据库，不读取本机运行库；固定口令仅限本机开发，生产部署必须替换为独立随机值。

```bash
npm ci --prefix app
npm ci --prefix backend --ignore-scripts
npm run build --prefix app
mkdir -p .tmp/dev/uploads
STYLEAI_DB_PATH="$PWD/.tmp/dev/styleai.db" \
STYLEAI_UPLOAD_DIR="$PWD/.tmp/dev/uploads" \
STYLEAI_LOG_DIR="$PWD/.tmp/dev/logs" \
DOTENV_CONFIG_PATH="$PWD/.tmp/dev/disabled.env" \
NODE_ENV=development \
SECRET_KEY="local-dev-only-secret-change-me-32-chars" \
ADMIN_PASSWORD="local-dev-only-admin-password" \
npm start --prefix backend
```

PowerShell 在仓库根目录可整段执行（使用项目内临时数据库）：

```powershell
npm ci --prefix app
npm ci --prefix backend --ignore-scripts
npm run build --prefix app
New-Item -ItemType Directory -Force .tmp/dev/uploads | Out-Null
$env:STYLEAI_DB_PATH = Join-Path $PWD '.tmp/dev/styleai.db'
$env:STYLEAI_UPLOAD_DIR = Join-Path $PWD '.tmp/dev/uploads'
$env:STYLEAI_LOG_DIR = Join-Path $PWD '.tmp/dev/logs'
$env:DOTENV_CONFIG_PATH = Join-Path $PWD '.tmp/dev/disabled.env'
$env:NODE_ENV = 'development'
$env:SECRET_KEY = 'local-dev-only-secret-change-me-32-chars'
$env:ADMIN_PASSWORD = 'local-dev-only-admin-password'
npm start --prefix backend
```

访问 `http://127.0.0.1:5000`。源码开发可另开终端运行 `npm run dev --prefix app`，访问 `http://127.0.0.1:5173`；Vite 代理到 5000。Windows 也可双击 `dev.bat`：它注入同一套 `.tmp/dev` 隔离环境和仅开发用凭据，不读取本机 `.env`；发现 5000 或 5173 被占用时只报错退出，不会终止现有进程。后端安装必须保留 `--ignore-scripts`：npm 会因 `binding.gyp` 自动尝试源码编译，而项目使用包内预编译绑定，不需要 Python 或 node-gyp。
可选天气、同步试穿与支付变量见 `.env.example`；`LLM_API_*` 当前仅为预留，不影响也不会增强文案。启用同步试穿时，`PUBLIC_BASE_URL` 必须填外部服务可访问的本站点 origin（生产用 HTTPS，不含路径、凭据、查询串或片段）；留空或非法会返回 503，不外发图片、不落盘，也不用请求 Host 拼地址。Windows 使用 Node.js 24 官方安装包即可，`better-sqlite3` 使用包内 Windows 预编译绑定；CI 会在 Windows 上重新安装并验证。

## 测试与检查

```bash
# 前端
npm run format:check --prefix app
npm run typecheck --prefix app
npm run lint --prefix app
npm test --prefix app
npm run build --prefix app

# 后端：测试使用系统临时目录中的独立 SQLite 库，结束后删除
npm run format:check --prefix backend
npm run lint --prefix backend
npm test --prefix backend
npm run openapi:check --prefix backend
npm run assets:check --prefix backend

# 真实 Chromium：先构建 app/dist，再安装后端依赖
PLAYWRIGHT_BROWSERS_PATH="$PWD/app/.tmp/playwright-browsers" \
  npm --prefix app exec playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/app/.tmp/playwright-browsers" \
  npm run test:e2e --prefix app
```

Playwright 根配置位于 `playwright.config.ts`，默认使用 5189 端口，临时库不登记人物模型，并验证无模型时的空状态与服务入口。
浏览器、报告和输出都放在项目 `.tmp/` 下；测试库、上传与日志放在系统临时目录，正常退出时清理。强制终止、SIGKILL 或宿主崩溃可能留下临时目录，确认属于本次测试后再删除。测试不会读取 `.env`，也不会调用真实支付或 AI。
CI 另含 Docker 构建、Compose 配置校验、`/health` 启动冒烟、格式/类型/lint/单测/构建/OpenAPI/资产门禁。

## 当前数字口径（2026-11-25 复算）

| 范围 | 结果 | 来源 |
|---|---:|---|
| 数据库表 | 35 | `backend/db/schema.sql` 的 `CREATE TABLE` |
| 基础种子 | 264 组 / 790 条件 / 1388 动作 | `db/seed/rules.json` |
| 增量种子 | 114 组 / 139 条件 / 491 动作 | 6 个 `db/seed/rules-*.json` |
| 临时库合计 | 378 组 / 929 条件 / 1879 动作 | 空临时库初始化后 SQL 查询 |
| 条件字段 / 库存分类 | 36 / 6 | 种子与临时库 `DISTINCT field`、分类表 |
| 干净仓库模型 | 0 个目录 / 0 个 PMX / 0 个启用卡片 | 仓库与公开演示库均不分发人物模型 |
| 本机模型资产 | 不计入仓库指标 | 第三方文件被 `.gitignore` 排除 |

“磁盘目录/文件、数据库登记、`enabled=1` 卡片”是三种不同口径，不要合并成一个“模型数”。

## 安全说明

- 非本地环境缺少 `SECRET_KEY` 或 `ADMIN_PASSWORD`、仍使用仓库公开示例值，或长度低于 32 / 12 位时拒绝启动；开发默认值仅限 `development/test`。生产环境的基础种子导入失败，或增量种子出现 JSON 解析、规则校验、写入失败，也会立即拒绝启动，不带病继续服务。
- 推荐接口的 `profile` 最多 200 个字段、序列化后最多 64 KB；两个衣橱推荐入口的单次衣橱候选最多 200 件，超限返回 400，不调用规则引擎、不写推荐快照。
- 密码使用 bcrypt；游客与会员会话默认 30 天，登录/改密轮换会话，管理员改密作废旧 Token。
- 用户上传的图片私有保存并登记所有权，按所有权签发一小时 HMAC URL；匿名直链和可编辑 URL 不能自证归属。明确公开的素材走单独公开例外。
- 删除档案只清理服务端认证的账号身份：身体/面容档案、衣物评分、三柜、搭配、心愿单、衣物与免费推荐样本纳入同一事务；门店会话没有账号所有权绑定，不能由一个门店号码代删，需由持有者在门店报告页走 `DELETE /api/customer/session/:sessionId`。两个入口都保留本人已到账（订单 `paid` 或凭证 `approved`）的报告及复读依据，且保留的报告不会再被当作旧表单回填。随后仅物理删除无其他记录引用的本人文件；支付凭证与共享文件保留。文件或台账清理失败时返回 207，可重试 `DELETE /api/analysis/archive`，不把部分成功说成全部删除。
- 支付回调校验签名、金额、订单状态与商户身份；必需配置缺失返回 503。有效重复回调幂等确认且不重复记账，有效迟到付款可确认到账；坏签名、金额不符和错商户回调均被拒绝。
- Express 启用 Helmet、CORS 与限流；后台响应遮蔽 session、密码哈希和支付敏感原文。
- 3D 页面依赖内联脚本，直接启用严格 CSP 前需完成 nonce/hash 改造；公网部署应另配 TLS 反向代理、响应头、日志与备份。

## 已知限制

- SQLite 适合单进程/小规模部署；没有 Redis、消息队列或独立对象存储，写入并发受 SQLite 限制。
- 规则质量依赖人工维护与反馈数据，不提供模型训练或自动评测闭环。
- 自动人脸识别、异步试穿未交付为在线能力；支付代码已具备，但真实结算需由每个部署者配置并验收。
- Compose 只启动应用本身，不包含 TLS 终止、域名证书或生产监控栈。
- 展厅模型与纹理可匿名读取；上架第三方模型前必须确认授权、目录穿越与限流策略。仓库现有 28 张第三方模型预览图的再分发许可尚未核实，已单独排除在 MIT/CC0 声明之外，详见 [NOTICE](NOTICE.md)。
- 运行数据备份、迁移和删除应按部署环境单独设计；测试与 E2E 临时库不能当作生产备份。

## 参与开源

欢迎提交 Issue、Bug 复现、规则建议和 Pull Request。请先阅读 [贡献指南](CONTRIBUTING.md)，较大改动先开 Issue 讨论；提交前提供真实测试证据，不要提交真实运行库、密钥、上传内容或第三方模型。公开脱敏演示库的刷新方式见上方说明。

项目自行编写的代码采用 [MIT](LICENSE)；第三方文件与依赖保留各自许可，集中索引见 [NOTICE](NOTICE.md)。社区交流遵守 [行为准则](CODE_OF_CONDUCT.md)。发现安全漏洞请按 [安全政策](SECURITY.md) 使用 GitHub 私密报告，不要创建公开 Issue。

更多设计取舍与后续路线见 [VISION.md](VISION.md)，接口清单见 `docs/api/openapi.json`。
