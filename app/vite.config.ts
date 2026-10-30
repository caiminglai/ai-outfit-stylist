import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 为什么 manualChunks 用函数形式而不是包名数组：
// React 19 的 react/react-dom 入口是 CJS（node_modules/react/index.js 里是 module.exports = require('./cjs/…')），
// 构建时被 commonjs 插件改写成 ?commonjs-proxy / ?commonjs-exports 的虚拟 id，
// 对象形式按裸包名匹配不到 ⇒ React 整片落进入口块（改前实测入口 223.10 kB，react-vendor 0.00 kB 空块）。
// 函数形式拿到的是解析后的真实 id，按路径里的包名分块，代理 id 同样含 node_modules/<pkg>/，匹配得到。
function pkgOf(id: string): string | null {
  const clean = id.replace(/\\/g, '/').split('?')[0].replace(/^\0/, '')
  const mark = '/node_modules/'
  const i = clean.lastIndexOf(mark)
  if (i < 0) return null
  const parts = clean.slice(i + mark.length).split('/')
  if (parts[0].startsWith('@') && parts.length > 2) return parts[0] + '/' + parts[1]
  return parts[0] || null
}

// 只有确实进图的包才列在这里；未列出的依赖由 Rollup 默认放置。
const VENDOR_CHUNKS: Record<string, string> = {
  react: 'react-vendor',
  'react-dom': 'react-vendor',
  scheduler: 'react-vendor',
  'react-router': 'router',
  'react-router-dom': 'router',
  '@remix-run/router': 'router',
  sonner: 'ui-vendor',
}

function manualChunks(id: string): string | undefined {
  const pkg = pkgOf(id)
  return pkg ? VENDOR_CHUNKS[pkg] : undefined
}

export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    hmr: {
      timeout: 120000,
      overlay: false,
    },
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5000', changeOrigin: true },
      '/gallery': { target: 'http://localhost:5000', changeOrigin: true },
      '/admin': { target: 'http://localhost:5000', changeOrigin: true },
      '/models': { target: 'http://localhost:5000', changeOrigin: true },
      '/static': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
  build: {
    cssCodeSplit: true,
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks,
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
  },
})
