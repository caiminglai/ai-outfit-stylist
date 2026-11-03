import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// 前端测试通道（11-03 第二块大项开的第一条）。
//
// 为什么今天才开：此前前端只有 `tsc -b`＋`eslint src`＋`vite build` 三道"能编译"的门，
// 一条行为断言都没有（`find app/src -name '*.test.*' -o -name '*.spec.*'` 现量 0 份），
// 所以拆 `ExhibitionHall.tsx`（1421 行）这类千行文件时没有任何回归防线。
//
// 为什么不复用 vite.config.ts：那份的 `build.rollupOptions.manualChunks` 是给产物分块的，
// 测试用不上；把 test 段塞进去还得让 vite.config.ts 从 'vitest/config' 引 defineConfig，
// 构建与测试耦在一份文件里更难读。这里只留测试要的两样：react 插件＋@ 别名＋jsdom 环境。
//
// environment=jsdom 的理由：这条通道既要测纯函数（`lib/skinSample.ts` 的取色数学），
// 也要能真渲染组件（`EvidenceTag` 那种依据档位标签）——后者要 DOM。纯函数在 jsdom 下跑
// 不比 node 慢到值得为它开两个 project。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    // 不依赖全局 expect／it：测试文件自己 `import { describe, it, expect } from 'vitest'`，
    // 这样 `tsc -b` 不需要往 tsconfig.app.json 里加 "types": ["vitest/globals"]，
    // 前端那套类型口径（strict）一行都不用为测试让步。
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
