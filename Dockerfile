# 阶段1：构建前端
# dist 不进 Git（.gitignore 排除），必须在镜像内构建，否则服务器全新 clone 后没有前端。
FROM node:24-slim AS frontend-builder

WORKDIR /app-frontend
COPY app/package*.json ./
# 这里从 npm install 换回 npm ci 是 09-26 那笔锁修复（站3 `8559b4b`）的收尾：
# 锁以前只在 Windows 上生成过，@esbuild/* 与 @rollup/* 各 26 个平台变体只记了 win32-x64 那一个，
# Linux 下 npm ci 必报 EUSAGE，所以构建只能退到 npm install。现在锁里 53 条平台条目齐了，
# npm ci 装出来的树与 CI 量的是同一棵，版本一个都不许漂。
RUN npm ci --no-audit --no-fund
COPY app/ ./
# 门禁走 npm run build（= tsc -b && vite build）：类型错误当场卡住构建。
# 09-25 打开前先在本阶段实测 `npx tsc -b` = 0 错，不是拿部署换门禁。
RUN npm run build

# 阶段2：运行镜像
# 不需要编译工具链：better-sqlite3 13.x 把 8 个平台的预编译二进制直接打进 npm 包
# （prebuilds/linux-x64.node），require 时按平台挑选，不联网、不编译。
# 9.6.0 做不到这点，且它的 binding.gyp 缺 -std=c++20，在 Node 24 下必然编译失败。
FROM node:24-slim

WORKDIR /app
COPY LICENSE NOTICE.md ./
COPY backend/package*.json ./
# --ignore-scripts 必需：npm 见到包里有 binding.gyp 就无条件补跑 node-gyp rebuild，
# 即使 package.json 写了 gypfile:false、lockfile 也没有 hasInstallScript，slim 镜像里没 python 就炸。
# 而 13.0.3 运行时直接从包内 prebuilds/linux-x64.node 加载，编译产物根本用不上。
# 其余后端依赖全是纯 JS，node-addon-api 只有头文件，跳过脚本无副作用。
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
# .dockerignore 已排除宿主机 node_modules，下面这步不会把 Windows 版依赖盖进来
COPY backend/ ./

COPY --from=frontend-builder /app-frontend/dist ./dist
# server.js 的 /gallery 路由读的是 /app/public/model-gallery.html，不在 dist 里
COPY --from=frontend-builder /app-frontend/public/model-gallery.html ./public/model-gallery.html

# 只复制项目自产的 CC0 演示模型；第三方本机模型由 .dockerignore 排除。
COPY models/demo/ /models/demo/
COPY scripts/generate-demo-model.cjs ./scripts/generate-demo-model.cjs

ENV NODE_ENV=production
ENV PORT=5000
ENV HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

EXPOSE 5000
CMD ["node", "server.js"]
