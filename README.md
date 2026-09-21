# 私人形象定制 AI 网站

门店级 **3D 形象展厅 + 规则引擎形象定制** 一体化应用.后端基于 Node.js 本地规则引擎,无外部 AI 服务依赖(仅阿里云 DashScope 作可选增强,缺 Key 时自动降级为模拟数据;星座文案走本地模板).

---

## 技术栈

| 层级 | 选型 | 备注 |
|------|------|------|
| 前端 | React 19 + TypeScript + Tailwind 3 + shadcn/ui (Radix) | 单页应用,响应式分屏 |
| 3D 渲染 | Three.js + MMDLoader(PMX/MMD) | 卡渲材质、自动旋转、模型轮播 |
| 前端构建 | Vite(容器内生产 + 开发 HMR)、esbuild(本机中文路径备选) | 本机路径含中文时 Vite 在 TRAE VFS 下会崩,故留 `build-esbuild.cjs` 作本机备选;容器内路径为 ASCII,Dockerfile 用 `npx vite build`;`app/dist` 不进 Git,每次构建镜像时在容器内重新生成 |
| 后端 | Node.js ≥18 + Express 4 + better-sqlite3 | 同步 API,单服务提供 API + 静态文件 |
| 数据库 | SQLite(WAL 模式,21 张表) | 零配置,首次启动自动建表 + 导入种子数据 |
| 规则引擎 | 三表结构(规则组/条件/动作) | 预筛 4 字段(性别/场景/模式/类别)+ 25 类条件表达式 |
| 外部服务 | 阿里云 DashScope(面容分析/试穿) | 可选,未配置 Key 时降级返回模拟数据;星座文案为本地模板 |
| 部署 | Docker Compose + Caddy | 本机与服务器共用一份 `docker-compose.yml`(服务名 `style-ai`);服务器 Debian 12 + Docker 已于 2026-09-20 上线,Caddy 自动申请/续期 Let's Encrypt 证书;旧栈 Nginx + PM2 已作废.三站共用的服务器口径见仓库上一级的 `SERVER-OPS.md` |

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
│   │   │   ├── CrossCabinetMatch.tsx   # 场合统一推荐
│   │   │   ├── CrossCabinetSeasonal.tsx# 季节提醒
│   │   │   ├── CrossCabinetBrand.tsx   # 品牌偏好分析
│   │   │   ├── CrossCabinetHealth.tsx  # 三柜健康检查
│   │   │   ├── CustomerForm.tsx      # 门店模式顾客表单(8 字段)
│   │   │   ├── PersonalProfileForm.tsx# 个人模式深度档案(50+ 字段)
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
├── backend-node/                     # 后端
│   ├── routes/                       # 路由(18 个模块)
│   │   ├── auth.js / admin.js        # 认证 + 管理后台
│   │   ├── customer.js               # 顾客临时会话(隐私优先)
│   │   ├── recommend.js / rules.js   # 规则引擎推荐 + 规则 CRUD
│   │   ├── inventory.js              # 库存管理
│   │   ├── wardrobe.js / cosmetic.js / accessory.js  # 个人三柜
│   │   ├── crossCabinet.js           # 跨柜联动(场合/季节/品牌/健康)
│   │   ├── models.js                 # 3D 模型列表/文件服务(读 model_configs 表;后台「扫描模型」才入库)
│   │   ├── photos.js / analysis.js / tryon.js        # 上传/面容/试穿
│   │   ├── clothing.js / weather.js / horoscope.js   # 服装识别/天气/星座
│   │   └── history.js
│   ├── services/                     # 服务层
│   │   ├── recommendEngine.js        # 推荐引擎(规则匹配 + 旧版兼容)
│   │   ├── profileEnricher.js        # 档案增强(BMI/体型/腰臀比算法)
│   │   ├── dashscopeService.js       # 阿里云 DashScope(面容/试穿,无 Key 降级)
│   │   ├── horoscopeService.js       # 星座运势(本地模板文案,LLM 链路未实现)
│   │   └── weatherService.js         # 天气查询
│   ├── middleware/                   # 中间件
│   │   ├── auth.js / logger.js / upload.js
│   │   ├── rateLimit.js              # 未被引用(限流实际用 npm 包 express-rate-limit,见 server.js)
│   ├── db/
│   │   ├── styleai.db                # SQLite 库文件(整目录挂载,勿单文件挂载)
│   │   ├── init.js                   # 自动建表 + 种子数据 + 管理员 + 清理过期会话
│   │   ├── schema.sql                # 表结构(21 张表)
│   │   ├── seed.js                   # 种子数据导入(读 seed/ 下两份 JSON)
│   │   ├── seed/rules.json           # 规则组/条件/动作数据源
│   │   ├── seed/inventory.json       # 库存分类/商品数据源
│   │   ├── add-rules.js              # 历史规则批量导入脚本(现以 seed/rules.json 为准)
│   │   └── migrate_cn_category.js    # 中文分类迁移脚本
│   ├── utils/                        # common.js / model-utils.js / response.js
│   ├── templates/                    # 管理后台 HTML(admin.html / admin-login.html)
│   ├── static/                       # 管理后台 CSS/JS
│   ├── uploads/                      # 用户上传(gitignore)
│   ├── scripts/                      # 一次性维护脚本(非运行时必需)
│   │   ├── flatten-textures.js       # 纹理文件扁平化
│   │   ├── rebuild-db.js             # 重建数据库 + 更新模型字段
│   │   ├── restructure-models.js     # 模型目录结构重组 + 命名统一
│   │   └── scan-models.js            # 扫描乱码文件名 + 纹理缺失
│   ├── .prettierrc.json              # Prettier 配置(与前端统一:无分号/单引号/2 空格)
│   ├── .prettierignore               # Prettier 忽略(node_modules/db/上传等)
│   ├── server.js                     # 后端入口
│   ├── .env / .env.example           # 环境变量(.env 已 gitignore)
│   └── package.json                  # 含 npm run format 一键格式化
├── models/                           # 3D 角色模型库(38 个顶层文件夹 / 44 个 .pmx;model_configs 启用 42 个 = 展厅实际数量)
│   └── 角色名+IP来源/                # 命名规则:`优菈+原神`、`雷电将军+原神`
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
cd ../backend-node && npm install --registry=https://registry.npmmirror.com
```

### 2. 配置环境变量
复制 `backend-node/.env.example` 为 `backend-node/.env`,按需填写:

| 变量 | 必填 | 说明 |
|------|------|------|
| `ADMIN_PASSWORD` | 是 | 管理后台首次启动创建 admin 账号的密码 |
| `SECRET_KEY` | 是 | Token 签名密钥(≥16 字符) |
| `PORT` | 否 | 默认 5000 |
| `HOST` | 否 | 默认 127.0.0.1;**容器内必须设 `0.0.0.0`**,否则端口映射与反代都连不上(Dockerfile 已设) |
| `CORS_ORIGINS` | 否 | 生产环境必填,逗号分隔 |
| `DASHSCOPE_API_KEY` | 否 | 阿里云通义面容分析/试穿,留空则降级返回模拟数据 |
| `CUSTOMER_DATA_TTL` | 否 | 顾客临时会话过期秒数,默认 7200(2 小时) |

> 试穿/面容分析只有 DashScope 一条链路,不存在独立的第三方试穿服务变量;星座文案是本地模板,代码未接 LLM(`package.json` 里的 `openai` 依赖无人引用)。

### 3. 启动

**生产模式(推荐,Docker Compose)**:编排文件在仓库上一级 `E:\website\docker-compose.yml`(服务名 `style-ai`),在本机走:

```bash
cd /e/website                       # 服务器上是 compose 仓库所在目录
docker compose up -d --build style-ai
```

**改完代码必须带 `--build`**:Dockerfile 把 `backend-node/` 和 `app/` 的**源码** COPY 进镜像,在容器内自己装依赖并构建前端(宿主机 `node_modules`、`dist` 都被 `.dockerignore` 排除),`docker compose restart` 只会重启旧镜像里的旧代码,等于没改.

**访问地址**:本机 `http://127.0.0.1:5000`(compose 只把端口绑在回环上,公网不直连). 服务器已由 Caddy 反代 `https://style.sparklove.cn`,证书自动申请与续期;在服务器上自查只能 `curl 127.0.0.1:5000`,公网访问一律走域名.

**本机裸跑备选**(只在没有 Docker 时用):

```bash
# 手动启动(PowerShell)
cd app; node --require ../npm-patch.js build-esbuild.cjs
cd ../backend-node; node --require ../npm-patch.js server.js
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
- **匹配机制**:`rule_groups` 先用 `性别 / 适用场景 / 模式 / 类别` 四个字段做 SQL 预筛,再由 `recommendEngine.js` 逐条求值 `rule_conditions`(25 类条件表达式:肤色、脸型、年龄段、地区、身高体重、季节等),命中的组输出 `rule_actions`
- **5 类别输出**:穿搭 139 / 妆容 45 / 发型 34 / 配饰 30 / 姿势 16
- **双模式**:
  - 门店模式:8 字段快速建档,推荐关联库存商品
  - 个人模式:50+ 字段深度档案,附加 BMI/体型/腰臀比算法分析
- **规则规模**:264 条规则组 / 790 条件 / 1388 动作,男女双性别全覆盖

### 个人三柜管理
- 衣橱 / 化妆品柜(含保质期追踪)/ 配饰柜:单品 CRUD、缺口分析、购物评估
- 跨柜联动:场合统一推荐、季节提醒、品牌偏好、三柜健康检查

### 隐私保护
- 门店顾客数据:临时会话,TTL 过期自动清理(默认 2 小时)
- 上传照片存 `uploads/`(已 gitignore)
- 大字体隐私声明告知

---

## API 接口(18 个路由模块)

| 模块 | 路径前缀 | 主要能力 | 鉴权 |
|------|---------|---------|------|
| 认证 | `/api/auth` | 游客/管理员登录 | 公开 |
| 顾客会话 | `/api/customer` | 临时会话 CRUD + 隐私声明 | 公开(按 session 隔离) |
| 推荐 | `/api/recommend` | 规则引擎推荐(核心 `POST /engine`) | 公开;写历史需 `X-Session-Id` |
| 规则 | `/api/rules` | 规则组/条件/动作 CRUD | 读公开;增删改需管理员 Token |
| 库存 | `/api/inventory` | 分类 + 商品 CRUD | 读公开;增删改需管理员 Token |
| 衣橱 | `/api/wardrobe` | CRUD + 缺口分析 + 购物评估 + 智能推荐 | 需 `X-Session-Id`(挂载级) |
| 化妆品 | `/api/cosmetic` | CRUD + 保质期 + 缺口分析 | 需 `X-Session-Id`(挂载级) |
| 配饰 | `/api/accessory` | CRUD + 缺口分析 | 需 `X-Session-Id`(挂载级) |
| 跨柜 | `/api/cross-cabinet` | 场合/季节/品牌/健康 4 端点 | 需 `X-Session-Id`(挂载级) |
| 3D 模型 | `/api/models` | 列表 + 文件服务 + 管理员扫描/启停 | 列表/文件公开;扫描与启停需管理员 Token |
| 照片 | `/api/photos` | 上传 | 需 `X-Session-Id` |
| 面容分析 | `/api/analysis` | DashScope 人脸特征 | 需 `X-Session-Id` |
| 试穿 | `/api/tryon` | 虚拟试穿 | 需 `X-Session-Id` |
| 服装识别 | `/api/clothing` | 服装类型识别 | 需 `X-Session-Id`(挂载级) |
| 天气 | `/api/weather` | 天气查询 | 公开 |
| 星座 | `/api/horoscope` | 星座运势(本地模板文案) | 公开 |
| 历史 | `/api/history` | 推荐历史 | 需 `X-Session-Id` |
| 管理后台 | `/admin` | 后台页面 + 数据库浏览 | 管理员 Token |

身份有两类:游客走 `X-Session-Id` 请求头(前端 `api.ts` 自动带,门店模式下顾客建档时由 `/api/customer` 下发,TTL 到期即失效);管理员走 `Authorization: Bearer <token>`(HMAC-SHA256 签名,24 小时有效),对应中间件 `loginRequired` 与 `adminLoginRequired`,均在 `middleware/auth.js`.

响应统一格式:`{ success: boolean, data?: any, error?: { code, message } }`

---

## 数据库表(21 张)

| 表名 | 说明 |
|------|------|
| users / admin_users | 用户 / 管理员 |
| photos / face_features / body_metrics | 照片 / 人脸特征 / 体型指标 |
| recommendations / recommendation_logs | 推荐记录 / 推荐日志 |
| tryon_results | 试穿结果 |
| clothing_items | 服装识别结果 |
| rule_groups / rule_conditions / rule_actions | 规则引擎三表(264 组 / 790 条件 / 1388 动作) |
| inventory_categories / inventory_products | 库存分类 / 商品 |
| customer_sessions | 顾客临时会话(TTL 过期清理) |
| user_wardrobe / user_cosmetics / user_accessories | 个人三柜 |
| wardrobe_outfits / shopping_wishlist | 搭配组合 / 心愿单 |
| model_configs | 3D 模型启用配置 |

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
cd backend-node && npm run format

# 检查未格式化文件(CI 用)
npm run format:check
```

文件命名规范:
- 前端组件:`PascalCase.tsx`(如 `WardrobeTab.tsx`)
- 前端工具/hooks:`camelCase.ts`(如 `useResponsive.ts`)
- 后端路由/服务/中间件:`camelCase.js`(如 `crossCabinet.js`、`recommendEngine.js`)
- 一次性脚本:放 `backend-node/scripts/`,不参与运行时
