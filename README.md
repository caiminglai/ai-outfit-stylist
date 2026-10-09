# 私人形象定制 AI 网站

门店级 **3D 形象展厅 + 规则引擎形象定制** 一体化应用.后端基于 Node.js 本地规则引擎,无外部 AI 服务依赖(仅虚拟试穿接了阿里云 DashScope,缺 Key 时降级返回你上传的原图并在页面上说明;面容分析接口当前返回 501,不调外部服务;星座文案走本地模板).

---

## 技术栈

| 层级 | 选型 | 备注 |
|------|------|------|
| 前端 | React 19 + TypeScript + Tailwind 3 + shadcn/ui (Radix) | 单页应用,响应式分屏 |
| 3D 渲染 | Three.js + MMDLoader(PMX/MMD) | 卡渲材质、自动旋转、模型轮播 |
| 前端构建 | Vite(容器内生产 + 开发 HMR)、esbuild(本机中文路径备选) | 本机路径含中文时 Vite 在 TRAE VFS 下会崩,故留 `build-esbuild.cjs` 作本机备选;容器内路径为 ASCII,Dockerfile 用 `npx vite build`;`app/dist` 不进 Git,每次构建镜像时在容器内重新生成 |
| 后端 | Node.js ≥18 + Express 4 + better-sqlite3 | 同步 API,单服务提供 API + 静态文件 |
| 数据库 | SQLite(WAL 模式,28 张表) | 零配置,首次启动自动建表 + 导入种子数据 |
| 规则引擎 | 三表结构(规则组/条件/动作) | 预筛 4 字段(性别/场景/模式/类别)+ 31 类条件字段(本机 `DISTINCT field` 实测) |
| 外部服务 | 阿里云 DashScope(仅虚拟试穿调用) | 可选,缺 Key 时原样返回人物图并标记为降级;面容分析不调外部服务,直接返回 501 让顾客在表单里选;星座文案为本地模板 |
| 部署 | Docker Compose + Caddy | 本机与服务器共用一份 `docker-compose.yml`(服务名 `style-ai`);服务器 Debian 12 + Docker 已于 2026-09-20 上线,Caddy 自动申请/续期 Let's Encrypt 证书;旧栈 Nginx + PM2 已作废.三站共用的服务器口径见编排仓库的 `SERVER-OPS.md`（站外，本机 `E:\website\compose\SERVER-OPS.md`） |

---

## 目录结构

```
3.personal-image-ai/
├── app/                              # 前端
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                   # shadcn/ui 基础组件(button/card/dialog/input 等)
│   │   │   ├── recommend/            # 推荐结果卡片(RecommendTab/AlgorithmAnalysis/WeatherCard/HoroscopeCard/TryonCard/EnhancedTextCard)
│   │   │   ├── CabinetManager.tsx    # 三柜调度器(Tab 按需加载)
│   │   │   ├── CabinetConstants.ts   # 三柜常量
│   │   │   ├── WardrobeTab.tsx       # 衣橱(CRUD/缺口分析/购物评估)
│   │   │   ├── CosmeticTab.tsx       # 化妆品柜(CRUD/保质期/缺口分析)
│   │   │   ├── AccessoryTab.tsx      # 配饰柜(CRUD/缺口分析)
│   │   │   ├── CrossCabinetReport.tsx  # 跨柜联动总入口
│   │   │   ├── CrossCabinetMatch.tsx   # 场合统一推荐(含「今天这身」完整搭配)
│   │   │   ├── CrossCabinetSeasonal.tsx# 季节提醒
│   │   │   ├── CrossCabinetBrand.tsx   # 品牌偏好分析
│   │   │   ├── CrossCabinetHealth.tsx  # 三柜健康检查
│   │   │   ├── CustomerForm.tsx      # 门店模式顾客表单(快速采集)
│   │   │   ├── PersonalProfileForm.tsx# 个人模式深度档案(全量采集)
│   │   │   ├── RecommendationReport.tsx # 推荐结果展示
│   │   │   ├── InventoryCard.tsx     # 库存商品卡片
│   │   │   └── ErrorBoundary.tsx     # 全局错误边界
│   │   ├── pages/ExhibitionHall.tsx  # 主页(单页双模式入口)
│   │   ├── hooks/useResponsive.ts    # 响应式布局(桌面分屏/手机竖横屏)
│   │   ├── lib/utils.ts              # 通用工具(cn 类名合并等)
│   │   ├── types/index.ts            # 全局 TypeScript 类型
│   │   ├── api.ts                    # 后端 API 封装(含 X-Session-Id)
│   │   ├── App.tsx / main.tsx        # 入口
│   ├── public/model-gallery.html     # 3D 展厅独立页(PMX 渲染,后端直供)
│   ├── build-esbuild.cjs             # 生产构建脚本(esbuild)
│   ├── vite.config.ts                # 开发配置(HMR + API 代理到 :5000)
│   └── package.json
├── backend/                     # 后端
│   ├── routes/                       # 路由(20 个模块)
│   │   ├── auth.js / admin.js        # 认证 + 管理后台
│   │   ├── customer.js               # 顾客临时会话(隐私优先)
│   │   ├── recommend.js / rules.js   # 规则引擎推荐 + 规则 CRUD
│   │   ├── inventory.js              # 库存管理
│   │   ├── wardrobe.js / cosmetic.js / accessory.js  # 个人三柜
│   │   ├── crossCabinet.js           # 跨柜联动(场合/季节/品牌/健康)
│   │   ├── creator.js                # 创作者投稿(搭配/化妆/规则三类,表 creator_works)
│   │   ├── payment.js                # 收款码展示 + 付款凭证上传 + 管理员审核 + 商户号在线收款(微信 Native / 支付宝电脑网站)
│   │   ├── models.js                 # 3D 模型列表/文件服务(读 model_configs 表;后台「扫描模型」才入库)
│   │   ├── photos.js / analysis.js / tryon.js        # 上传/面容/试穿
│   │   ├── clothing.js / weather.js / horoscope.js   # 服装识别/天气/星座
│   │   └── history.js
│   ├── services/                     # 服务层(14 个)
│   ├── services/                     # 服务层(14 个)
│   │   ├── recommendEngine.js        # 推荐引擎(规则匹配 + 旧版兼容)
│   │   ├── ruleExplainer.js          # 把规则条件翻成中文(可解释性)
│   │   ├── ruleFeedback.js           # 用户对规则的评好/差评计数
│   │   ├── evidenceLevels.js         # 规则依据分档 A国标/B实证/C体系/D命理(判档唯一实现处)
│   │   ├── colorMetrics.js           # 色度学(sRGB→Lab、CIEDE2000、色相角差、ITA°、上衣贴合分)
│   │   ├── profileEnricher.js        # 档案增强(BMI/体型/腰臀比/腿身比/肩宽比;腰臀比分性别、腿身比按髋骨到脚跟 0.52/0.56 分档)
│   │   ├── profileArchive.js         # 长期档案读写(身体/面容入库、算出的结论标签、计算前合并)
│   │   ├── fullLookAdvisor.js        # 「今天这身」(三柜候选拼一套 + 冷暖皮定金属色)
│   │   ├── baziWuxing.js             # 八字五行喜用神(命理口径,与 A/B 档分开表述)
│   │   ├── dashscopeService.js       # 阿里云 DashScope(面容/试穿,无 Key 降级)
│   │   ├── horoscopeService.js       # 星座运势(本地模板文案,LLM 链路未实现)
│   │   ├── weatherService.js         # 天气查询
│   │   └── alipay.js / wechatPay.js  # 支付渠道SDK封装
│   ├── middleware/                   # 中间件
│   │   ├── auth.js / logger.js / upload.js
│   │   ├── rateLimit.js              # 未被引用(限流实际用 npm 包 express-rate-limit,见 server.js)
│   ├── db/
│   │   ├── styleai.db                # SQLite 库文件(容器运行期会写它 ⇒ 已移出 Git 跟踪、*.db 已 gitignore;整目录挂载,勿单文件挂载)
│   │   ├── init.js                   # 自动建表 + 种子数据 + 管理员 + 清理过期会话
│   │   ├── schema.sql                # 表结构(28 个 CREATE TABLE)⚠️不等于线上表结构:库是增量演进的,新列别写这里
│   │   ├── seed.js                   # 种子数据导入(读 seed/ 下两份 JSON)
│   │   ├── seed/rules.json           # 规则组/条件/动作数据源
│   │   ├── seed/inventory.json       # 库存分类/商品数据源
│   │   ├── add-rules.js              # 历史规则批量导入脚本(现以 seed/rules.json 为准)
│   │   └── migrate_cn_category.js    # 中文分类迁移脚本
│   ├── utils/                        # common.js / logger.js / model-utils.js / response.js
│   ├── templates/                    # 管理后台 HTML(admin.html / admin-login.html)
│   ├── static/                       # 管理后台 CSS/JS
│   ├── uploads/                      # 用户上传(gitignore)
│   ├── test/                         # 单元测试 5 个文件(node --test,非 vitest):推荐引擎/审美规则/今天这身/档案增强
│   ├── scripts/                      # 一次性维护脚本(非运行时必需)
│   │   ├── flatten-textures.js       # 纹理文件扁平化
│   │   ├── rebuild-db.js             # 重建数据库 + 更新模型字段
│   │   ├── restructure-models.js     # 模型目录结构重组 + 命名统一
│   │   └── scan-models.js            # 扫描乱码文件名 + 纹理缺失
│   ├── eslint.config.js              # ESLint 扁平配置(与 prettier 通过 eslint-config-prettier 共存)
│   ├── .prettierrc.json              # Prettier 配置(与前端统一:无分号/单引号/2 空格)
│   ├── .prettierignore               # Prettier 忽略(node_modules/db/上传等)
│   ├── server.js                     # 后端入口
│   ├── .env / .env.example           # 环境变量(.env 已 gitignore)
│   └── package.json                  # 脚本:start / dev / seed / format(:check) / lint(:fix) / test
├── docs/                             # 设计与路线文档
│   └── 形象设计模型-现状与路线.md      # 数字形象目标 / 实测缺口 / 7 步实施路线(活文档)
├── models/                           # 3D 角色模型库(实测:顶层 30 个角色目录 / 含子目录共 72 个 / 416 个文件 / 32 个 .pmx)
│   │                                 # ⚠️三个数字别混:磁盘 30 个目录 ≠ model_configs 登记 32 行 ≠ 展厅 28 张卡片(enabled=1)
│   └── 角色名+IP来源/                # 命名规则:`优菈+原神`、`雷电将军+原神`;folder 是可嵌套相对路径,比对先按 split('/')[0]
├── Dockerfile                        # 生产镜像(前端 npx vite build + 后端代码 COPY 进镜像)
├── .dockerignore                     # 排除 node_modules/models/uploads/dev.bat/*.md 等
├── dev.bat                           # 本机开发(前端 Vite HMR :5173 + 后端 :5000)
├── npm-patch.js                      # 中文路径 realpath 兼容补丁
├── .gitignore
└── README.md
```

---

## 快速开始

### 环境要求
- **Docker 方式**:只需 Docker + Compose,镜像基于 `node:24-slim`(见 `Dockerfile`),本机不用装 Node
- **本机裸跑**:Node.js ≥18(推荐 v20/v24,匹配 better-sqlite3 预编译二进制);Windows / macOS / Linux 均可(启动脚本 `.bat` 仅 Windows)

### 1. 安装依赖

> 只有「本机裸跑」或 `dev.bat` 开发模式才需要这一步。走 Docker Compose 时依赖在镜像内自己安装(见 `Dockerfile`),本机这份 `node_modules` 用不到,删了也不影响建镜像。

```bash
cd app && npm install --registry=https://registry.npmmirror.com
cd ../backend && npm install --registry=https://registry.npmmirror.com
```

### 2. 配置环境变量
复制 `backend/.env.example` 为 `backend/.env`,按需填写:

| 变量 | 必填 | 说明 |
|------|------|------|
| `ADMIN_PASSWORD` | 是 | 管理后台首次启动创建 admin 账号的密码 |
| `SECRET_KEY` | 是 | Token 签名密钥(≥16 字符) |
| `PORT` | 否 | 默认 5000 |
| `HOST` | 否 | 默认 127.0.0.1;**容器内必须设 `0.0.0.0`**,否则端口映射与反代都连不上(Dockerfile 已设) |
| `CORS_ORIGINS` | 否 | 生产环境必填,逗号分隔 |
| `DASHSCOPE_API_KEY` | 否 | 只影响虚拟试穿:留空时原样返回你上传的人物图并标记 `degraded`;面容分析不读它(接口直接返回 501) |
| `CUSTOMER_DATA_TTL` | 否 | 顾客临时会话过期秒数,默认 7200(2 小时) |

> 只有虚拟试穿会调 DashScope,不存在独立的第三方试穿服务变量;面容分析接口不碰它,固定返回 501;星座文案是本地模板,代码未接 LLM(`package.json` 里的 `openai` 依赖 `backend/**/*.js` 零引用,实测结论)。
> `openai` 这条依赖**没顺手删**:后端镜像用 `npm ci --omit=dev`,只改 `package.json` 而不同步 `package-lock.json` 会让构建当场失败;本机 `node_modules` 已按决定删掉不重装,锁文件只能单独重解,故列为待办而不是随手改一行。

### 3. 启动

**生产模式(推荐,Docker Compose)**:编排文件在仓库上一级 `E:\website\docker-compose.yml`(服务名 `style-ai`),在本机走:

```bash
cd /e/website                       # 服务器上是 compose 仓库所在目录
docker compose up -d --build style-ai
```

**改完代码必须带 `--build`**:Dockerfile 把 `backend/` 和 `app/` 的**源码** COPY 进镜像,在容器内自己装依赖并构建前端(宿主机 `node_modules`、`dist` 都被 `.dockerignore` 排除),`docker compose restart` 只会重启旧镜像里的旧代码,等于没改.

**访问地址**:本机 `http://127.0.0.1:5000`(compose 只把端口绑在回环上,公网不直连). 服务器已由 Caddy 反代 `https://style.sparklove.cn`,证书自动申请与续期;在服务器上自查只能 `curl 127.0.0.1:5000`,公网访问一律走域名.

**本机裸跑备选**(只在没有 Docker 时用):

```bash
# 手动启动(PowerShell)
cd app; node --require ../npm-patch.js build-esbuild.cjs
cd ../backend; node --require ../npm-patch.js server.js
```

**开发模式(前端 HMR 热更新,不构建 dist)**:双击 `dev.bat`,前端 `:5173`(Vite)+ 后端 `:5000` 双进程,前端 API 请求代理到后端.

⚠️ 用之前先 `docker compose stop style-ai`:`dev.bat` 启动前会强杀占用 `:5000` 的进程,而容器在跑时 `:5000` 归 `com.docker.backend`(Docker Desktop 后台进程),会被一起杀掉。

---

## 访问地址

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端主页 | http://127.0.0.1:5000 | 形象数据中心(双模式入口) |
| 3D 展厅 | http://127.0.0.1:5000/gallery | 独立 3D 展厅(展示模式,无 UI) |
| 管理后台 | http://127.0.0.1:5000/admin/login | 规则编辑/库存/数据浏览 |
| 健康检查 | http://127.0.0.1:5000/api/health | 服务状态 |

---

## 核心功能

### 3D 模型展厅
- 38 个角色文件夹(命名 `角色+IP`,如 `优菈+原神`),内含 44 个 `.pmx`;`model_configs` 表启用 42 个,即展厅实际轮播数量
- 自动旋转、拖拽交互、模型轮播、窗口自适应
- 双模式:展示模式(纯模型无 UI)/ 服务模式(含控制按钮)
- 模型文件支持 `.gz` 预压缩传输
- 展厅的 three.js 由 importmap 从 `/three/**` 取(vite 把 `app/public/three` 拷进 `dist/three`),因此 `server.js` 必须显式 `app.use('/three', express.static(...))`,并把 `/three/` 加进 SPA 兜底的排除名单
- 漏挂载时 `/three/**` 会落到 SPA 兜底,被当成 `index.html` 以 200 + `text/html` 返回,浏览器静默拒绝执行整条模块链:表现是展厅白屏、连 `/api/models/list` 都不发。判据看 Content-Type 和"该发却没发的请求",不要看状态码(2026-09-21 生产实测,修于 `cc63213`)
- 生产服务器目前只有 4 个角色文件夹、库里 `enabled` 也是 4 条(本机 42);`/api/models/list` 不校验文件是否存在,所以补模型时**文件目录与库记录必须同时到位**,否则展厅 404
- 展厅取模型走 `/api/models/file/*`(一个角色 = `.pmx` + 多张贴图),该前缀已在限流中豁免;不豁免的话浏览几个模型就吃掉 100 次/15 分钟额度,前端表现为"无法加载人物模型"白屏

### 规则引擎推荐
- **匹配机制**:`rule_groups` 先用 `性别 / 适用场景 / 模式 / 类别` 四个字段做 SQL 预筛,再由 `recommendEngine.js` 逐条求值 `rule_conditions`(31 类条件字段:肤色、脸型、年龄段、地区、身高体重、季节、色彩四季型/十二型、风格型等),命中的组输出 `rule_actions`
- **5 类别输出**:穿搭 179 / 妆容 61 / 配饰 42 / 发型 38 / 姿势 16
- **双模式**:
  - 门店模式:少数字段快速建档,推荐关联库存商品;每家店用带 `?store=店名` 的链接进入,样本按店分开
  - 个人模式:完整深度档案,附加 BMI/体型/腰臀比/色彩十二型/风格型算法分析
- **规则规模**:336 条规则组 / 862 条件 / 1696 动作,男女双性别全覆盖

### 个人三柜管理
- 衣橱 / 化妆品柜(含保质期追踪)/ 配饰柜:单品 CRUD(三柜都有「修改」入口,复用新增表单)、缺口分析、购物评估
- 跨柜联动:场合统一推荐、季节提醒、品牌偏好、三柜健康检查;场合统一推荐会把三柜与长期档案接进同一套评分,拼出「今天这身」(衣服 + 妆容 + 配饰,每件带入选理由)

### 隐私保护
- 门店顾客数据:画像存服务端临时会话,TTL 过期自动清理(默认 2 小时)
- 推荐日志(含输入快照,不含昵称)留存供门店复盘与画像累积;顾客删除会话时连带删除其日志
- 上传照片存 `uploads/`(已 gitignore)
- 大字体隐私声明告知

---

## API 接口(20 个路由模块:19 个 `/api` + 管理后台)

| 模块 | 路径前缀 | 主要能力 | 鉴权 |
|------|---------|---------|------|
| 认证 | `/api/auth` | 游客身份 + 手机号注册/登录 + 管理员登录 + 后台代重置密码(`GET /admin/accounts` 会员列表 / `POST /admin/reset-password`) | 注册登录公开;两个 admin 端点需管理员 Token |
| 顾客会话 | `/api/customer` | 临时会话 CRUD + 隐私声明 + 门店归属(建档时带 `store` 店名,当场自动登记,店与店的数据分开) | 公开(按 session 隔离) |
| 推荐 | `/api/recommend` | 规则引擎推荐(核心 `POST /engine`);原先无人调用的 `GET /` 空端点已删,现回真 404 | 公开;写历史需 `X-Session-Id` |
| 规则 | `/api/rules` | 规则组/条件/动作 CRUD | 读公开;增删改需管理员 Token |
| 库存 | `/api/inventory` | 分类 + 商品 CRUD | 读公开;增删改需管理员 Token |
| 衣橱 | `/api/wardrobe` | CRUD + 缺口分析 + 购物评估 + 智能推荐 | 需 `X-Session-Id`(挂载级) |
| 化妆品 | `/api/cosmetic` | CRUD + 保质期 + 缺口分析 | 需 `X-Session-Id`(挂载级) |
| 配饰 | `/api/accessory` | CRUD + 缺口分析 | 需 `X-Session-Id`(挂载级) |
| 跨柜 | `/api/cross-cabinet` | 场合/季节/品牌/健康 4 端点 | 需 `X-Session-Id`(挂载级) |
| 3D 模型 | `/api/models` | 列表 + 文件服务 + 管理员扫描/启停 | 列表/文件公开;扫描与启停需管理员 Token |
| 照片 | `/api/photos` | 上传 / 列表 / 删除(删记录连带删掉 `uploads/` 里的文件) | 需 `X-Session-Id` |
| 面容分析 | `/api/analysis` | `POST /face` 返回 501(照片识别未开放);`GET /body` `GET /archive` 读长期档案;`DELETE /archive` 删本人全部数据(档案 + 标签 + 反馈 + 样本 + 搭配记录 + 照片 + 试穿结果 + 上传文件) | 需 `X-Session-Id`(游客 id 即可,首次访问自动补一条) |
| 试穿 | `/api/tryon` | `POST /direct` 可用:接 DashScope,缺 Key 时返回原图并带 `degraded:true`;带 `X-Session-Id` 时把两张上传图与结果落库,不带身份只返回图、不落库;`POST /`(异步任务)返回 501 | 需 `X-Session-Id` |
| 服装识别 | `/api/clothing` | 服装类型识别 | 需 `X-Session-Id`(挂载级) |
| 天气 | `/api/weather` | 天气查询 | 公开 |
| 星座 | `/api/horoscope` | 星座运势(本地模板文案) | 公开 |
| 历史 | `/api/history` | 推荐历史 | 需 `X-Session-Id` |
| 支付 | `/api/payment` | 收款码列表 + 付款凭证上传 + 我的记录 + 管理员审核;在线收款:`POST /order`(微信 Native 出码)、`POST /alipay/order`(支付宝电脑网站支付,返回 pay_url)、`GET /order/:outTradeNo`(查单,按单号前缀 `S3`/`A3` 分渠道)、`POST /notify`(微信回调)、`POST /notify/alipay`(支付宝回调);收款金额:`GET /admin/price` 读、`PUT /admin/price` 改(微信与支付宝共用这一个数) | 码表公开;下单与查单需 `X-Session-Id`;两个回调免登录但逐条验签+核对金额,只在配置齐全的商户号下通电;配置不全时下单回 503,前端自动回落到"静态码 + 上传凭证";审核与改价需管理员 Token。对外标价取自 `app_settings`,后台没改过时回落到 `routes/payment.js` 里的 `PRICE.amount`;每笔订单在下单那一刻把 `amount_fen` 写死在自己那行,改价不影响正在付的单子 |
| 创作者 | `/api/creator` | 作品列表/详情/提交 + 封面上传 + 我的作品 + 管理员审核与加精 | 读公开;提交需登录态;审核需管理员 Token |
| 管理后台 | `/admin` | 后台页面 + 数据库浏览(顾客会话/推荐日志可按门店筛,归属门店列显示店名) + 源码查看(`GET /admin/api/source/<相对路径>`,注:admin 路由整段挂在 `/admin` 下,`routes/admin.js` 里写的 `/api/source` 实际 URL 带 `/admin` 前缀)。敏感清单命中直接 403:目录 `node_modules`/`.git`/`uploads`,后缀 `.db`/`.sqlite`/`.env`/`.pem`/`.key`/`.p12`/`.pfx`(2026-10-02 补的后四个——容器里 `backendRoot=/app`,商户私钥就挂在 `/app/certs*` 之下,少一条等于后台能把签约私钥整份读走) | 管理员 Token |

身份有三类:游客走 `X-Session-Id` 请求头(前端 `api.ts` 自动带,本地生成、2 小时换一次;门店模式下顾客建档时由 `/api/customer` 下发,TTL 到期即失效);正式账号走 `POST /api/auth/register` / `POST /api/auth/login`(手机号 + bcrypt 密码),注册即分配一条固定的服务端 `session_id`,前端存进 `localStorage.style_ai_account` 并**覆盖**游客那条的 2 小时轮换,所以登录后衣橱/历史/作品都跟着手机号走,换浏览器只要重新登录就能找回;账号与身份的对应关系记在 `user_accounts` 表(不往 `users` 老表加列);管理员走 `Authorization: Bearer <token>`(HMAC-SHA256 签名,24 小时有效;2026-10-02 起签名通过后还要**回库确认账号仍在且 `is_active=1`**——签名只证明"持密钥方签过",不证明这个账号还在,删号或禁用后旧 token 当场失效,不再干等 24 小时自然过期;同日补齐另一半:`admin_users` 多一列 `password_changed_at`(epoch 秒),`initAdminUser` 发现 `ADMIN_PASSWORD` 与库里哈希不同时,同一条 UPDATE 顺手把这一列盖成当前秒数,`verifyAdminToken` 再拒掉签发时间早于这个戳的 token ⇒ 改了密码旧 token 一律作废。戳是秒粒度,**同一秒内签发的 token 逃得过这一刀**(实测 `ts=戳-1` 拒、`ts=戳` 放);老库靠 `db/init.js` 的 `MISSING_COLUMNS` 启动时自动补列,值为 NULL 表示从没改过密码,不会把已登录的后台踢下线),对应中间件 `loginRequired` 与 `adminLoginRequired`,均在 `middleware/auth.js`;`GET /api/auth/admin/verify` 走同一个函数,不会出现"页面校验过了、接口还放行"的分叉.

注册/登录那一刻,游客身份名下攒的数据会**自动过户**到账号身份(三柜与心愿单/搭配、体型与面容档案、结论标签、规则反馈、推荐样本与记录、照片、试穿结果、付款凭证、投稿作品一并跟着走;带唯一约束的表若账号那边已有同名项,以账号已有的为准并丢弃游客那条,`merged.dropped` 会回报丢了几条);**已经绑定过手机号的身份不会被并进来**,所以登录第二个账号不会把第一个账号的数据抽走。忘记密码走后台:管理员在「会员账号」一节按手机号代重置新密码,档案/衣橱/作品都不受影响(短信与邮箱自助找回未做,那需要外部通道)。门店模式靠链接上的 `?store=店名` 区分是哪家店(前端记进 `localStorage.style_ai_store`,建档时随请求带上),店名第一次出现就当场登记进 `stores` 表 ⇒ 店数不预设也不封顶,一家店一份数据。

响应统一格式:`{ success: boolean, data?: any, error?: { code, message } }`

---

## 数据库表(28 张)

| 表名 | 说明 |
|------|------|
| users / admin_users | 用户 / 管理员(`admin_users.password_changed_at` = 改密码时刻的 epoch 秒,是"改密码即吊销旧管理员 Token"的锚点,NULL 表示从没改过;老库由 `db/init.js` 的 `MISSING_COLUMNS` 启动时自动补列) |
| user_accounts | 正式账号(手机号 + bcrypt 密码)与身份的对应关系 |
| stores | 门店表(`name` UNIQUE,店名第一次出现时自动登记);`customer_sessions` 与 `recommendation_logs` 各带一个 `store_id` 指向它,同一套系统给任意多家店用时数据按店分开 |
| photos / face_features / body_metrics | 照片 / 人脸特征 / 体型指标(试穿上传的人物图与服装图也会各登记一条 `photos`,`type='tryon'`) |
| face_profiles | 面容档案长期表,列名=规则条件字段名(五官手选 + 三庭/眼距) |
| recommendations / recommendation_logs | 推荐记录 / 推荐日志(含 `input_snapshot` 与 `user_id`) |
| profile_tags | 算完落库的结论标签(BMI/体型/色系/四季型/十二型/风格型…),同一人同一项覆盖不加行 |
| feedback_events | 规则反馈「有用/不准」,同一人对同一规则只留最新一次 |
| tryon_results | 试穿结果,`status` = done / degraded(未生成、返回的是原图);线上 `user_id` 与 `photo_id` 都是 NOT NULL,所以不带 `X-Session-Id` 的请求**不落库** |
| clothing_items | 服装识别结果 |
| rule_groups / rule_conditions / rule_actions | 规则引擎三表(本机实测 336 组 / 862 条件 / 1696 动作) |
| inventory_categories / inventory_products | 库存分类 / 商品 |
| customer_sessions | 顾客临时会话(TTL 过期清理) |
| user_wardrobe / user_cosmetics / user_accessories | 个人三柜 |
| wardrobe_outfits / shopping_wishlist | 搭配组合 / 心愿单 |
| model_configs | 3D 模型启用配置 |
| creator_works | 创作者投稿(搭配/化妆/推荐规则三类,带审核与加精状态) |
| deposits | 付款凭证与审核状态（表名沿用 deposits，钱不退） |
| app_settings | 后台可改的键值设置(当前只有 `payment_amount_fen` 收款金额,单位分) |

---

## 模型管理

将 PMX 模型文件夹放入 `models/`,命名规则 `角色名+IP来源`(如 `优菈+原神`),文件夹内含 `.pmx` + 贴图.管理后台点「扫描模型」自动发现,可单独启停与配置亮度.

注意:展厅读的是 `model_configs` 表(`enabled=1` 才出现),**只放文件不扫描不会上墙**;`models/` 在容器里以只读方式挂到 `/models`,服务器上新增模型 = 先 `git pull` 拉到模型目录,再进后台点「扫描模型」写表.

---

## 开发原则

- 先完成再完美,打通全链路
- 不重复造轮子,复用现有方案
- 全中文界面,3D 模型使用官方原色
- 隐私优先,顾客数据不长期保存
- 国内环境适配:npm 镜像源、阿里云 DashScope、CDN 国内节点

## 代码风格

前后端统一 Prettier 配置(`.prettierrc.json`):无分号 / 单引号 / 2 空格 / 100 列 / 尾随逗号 / LF.

```bash
# 前端格式化
cd app && npm run format

# 后端格式化
cd backend && npm run format

# 检查未格式化文件(CI 用)
npm run format:check
```

文件命名规范:
- 前端组件:`PascalCase.tsx`(如 `WardrobeTab.tsx`)
- 前端工具/hooks:`camelCase.ts`(如 `useResponsive.ts`)
- 后端路由/服务/中间件:`camelCase.js`(如 `crossCabinet.js`、`recommendEngine.js`)
- 一次性脚本:放 `backend/scripts/`,不参与运行时
