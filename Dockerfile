# 阶段1：构建前端
# dist 不进 Git（.gitignore 排除），必须在镜像内构建，否则服务器全新 clone 后没有前端。
FROM node:24-slim AS frontend-builder

WORKDIR /app-frontend
COPY app/package*.json ./
# 不能用 npm ci：lockfile 在 Windows 上生成，只记了 win32-x64 的 esbuild/rollup 可选包，
# Linux 下会因缺 @esbuild/linux-x64 报 EUSAGE。npm install 仍按 lockfile 锁版本，只补缺失平台包。
RUN npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
COPY app/ ./
# 用 npx vite build 而非 npm run build：后者带 tsc -b，类型错误会卡住部署（与站1 一致）
RUN npx vite build

# 阶段2：运行镜像
# 不需要编译工具链：better-sqlite3 13.x 把 8 个平台的预编译二进制直接打进 npm 包
# （prebuilds/linux-x64.node），require 时按平台挑选，不联网、不编译。
# 9.6.0 做不到这点，且它的 binding.gyp 缺 -std=c++20，在 Node 24 下必然编译失败。
FROM node:24-slim

WORKDIR /app
COPY backend-node/package*.json ./
# --ignore-scripts 必需：npm 见到包里有 binding.gyp 就无条件补跑 node-gyp rebuild，
# 即使 package.json 写了 gypfile:false、lockfile 也没有 hasInstallScript，slim 镜像里没 python 就炸。
# 而 13.0.3 运行时直接从包内 prebuilds/linux-x64.node 加载，编译产物根本用不上。
# 其余后端依赖全是纯 JS，node-addon-api 只有头文件，跳过脚本无副作用。
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com \
    && npm cache clean --force
# .dockerignore 已排除宿主机 node_modules，下面这步不会把 Windows 版依赖盖进来
COPY backend-node/ ./

COPY --from=frontend-builder /app-frontend/dist ./dist
# server.js 的 /gallery 路由读的是 /app/public/model-gallery.html，不在 dist 里
COPY --from=frontend-builder /app-frontend/public/model-gallery.html ./public/model-gallery.html

ENV NODE_ENV=production
ENV PORT=5000
ENV HOST=0.0.0.0

EXPOSE 5000
CMD ["node", "server.js"]
