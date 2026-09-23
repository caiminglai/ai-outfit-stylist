/**
 * 前端构建脚本 - 使用 esbuild 直接构建
 * 绕过 Vite 在 TRAE VFS 环境中的崩溃问题
 *
 * 构建流程:
 * 1. esbuild 打包 TSX -> JS
 * 2. 处理 CSS
 * 3. 生成 index.html
 * 4. 复制静态资源
 */
process.on('uncaughtException', (e) => {
  console.error('[未捕获异常]', e);
  process.exit(1);
});

const path = require('path');
const fs = require('fs');

// 设置 esbuild 二进制路径
const esbuildExe = path.join(__dirname, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
if (fs.existsSync(esbuildExe)) {
  process.env.ESBUILD_BINARY_PATH = esbuildExe;
}

const esbuild = require('esbuild');
const basedir = __dirname;

console.log('=== 前端构建 (esbuild) ===');
console.log('esbuild 版本:', esbuild.version);

// 清理 dist 目录
const distDir = path.join(basedir, 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });

async function build() {
  const isProduction = process.env.NODE_ENV === 'production'
  // 1. 打包 JS/TSX
  console.log('\n[1/4] 打包 TypeScript/TSX...');
  const result = await esbuild.build({
    entryPoints: [path.join(basedir, 'src', 'main.tsx')],
    bundle: true,
    outfile: path.join(distDir, 'assets', 'index.js'),
    minify: isProduction,
    sourcemap: !isProduction,
    target: ['es2022'],
    loader: {
      '.tsx': 'tsx',
      '.ts': 'ts',
      '.css': 'css',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.gif': 'dataurl',
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
    alias: {
      '@': path.join(basedir, 'src'),
    },
    jsx: 'automatic',
    logLevel: 'info',
  });

  console.log('  打包完成');

  // 2. 处理 CSS（Tailwind + PostCSS）
  console.log('\n[2/4] 处理 CSS (Tailwind + PostCSS)...');
  const indexCssPath = path.join(basedir, 'src', 'index.css');
  const cssOutput = path.join(distDir, 'assets', 'index.css');
  if (fs.existsSync(indexCssPath)) {
    try {
      const postcss = require('postcss');
      const tailwindcss = require('tailwindcss');
      const autoprefixer = require('autoprefixer');

      // 加载 tailwind.config.js（ESM -> CJS 临时文件）
      const configContent = fs.readFileSync(path.join(basedir, 'tailwind.config.js'), 'utf-8');
      const tempConfigPath = path.join(basedir, 'tailwind.config.tmp.cjs');
      fs.writeFileSync(tempConfigPath, configContent.replace('export default', 'module.exports ='), 'utf-8');
      const tailwindConfig = require(tempConfigPath);
      fs.unlinkSync(tempConfigPath);

      const css = fs.readFileSync(indexCssPath, 'utf-8');
      const result = await postcss([
        tailwindcss(tailwindConfig),
        autoprefixer,
      ]).process(css, { from: indexCssPath, to: cssOutput });

      fs.writeFileSync(cssOutput, result.css, 'utf-8');
      console.log('  Tailwind CSS 处理完成 (' + (result.css.length / 1024).toFixed(1) + ' KB)');
    } catch (e) {
      console.log('  Tailwind 处理失败，回退到 esbuild:', e.message);
      await esbuild.build({
        entryPoints: [indexCssPath],
        outfile: cssOutput,
        loader: { '.css': 'css' },
        minify: false,
      });
      console.log('  CSS 处理完成（无 Tailwind）');
    }
  }

  // 3. 生成 index.html
  console.log('\n[3/4] 生成 index.html...');
  const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✨</text></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#FF6B9D" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <title>AI形象顾问 — 你的私人穿搭助手</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet" />
    <script type="importmap">
    {
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/",
        "@pixiv/three-vrm": "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3/lib/three-vrm.module.min.js"
      }
    }
    </script>
    <link rel="stylesheet" href="/assets/index.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>`;
  fs.writeFileSync(path.join(distDir, 'index.html'), htmlContent, 'utf-8');
  console.log('  index.html 生成完成');

  // 4. 复制 public 目录
  console.log('\n[4/4] 复制静态资源...');
  const publicDir = path.join(basedir, 'public');
  if (fs.existsSync(publicDir)) {
    const copyDir = (src, dest) => {
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          copyDir(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };
    copyDir(publicDir, distDir);
    console.log('  静态资源复制完成');
  } else {
    console.log('  无 public 目录，跳过');
  }

  console.log('\n=== 构建完成 ===');
  console.log('输出目录:', distDir);
  const files = [];
  const listFiles = (dir, prefix = '') => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix + entry.name;
      if (entry.isDirectory()) {
        listFiles(path.join(dir, entry.name), relPath + '/');
      } else {
        const size = fs.statSync(path.join(dir, entry.name)).size;
        files.push(`  ${relPath} (${(size / 1024).toFixed(1)} KB)`);
      }
    }
  };
  listFiles(distDir);
  console.log('文件列表:');
  files.forEach(f => console.log(f));
}

build().catch((e) => {
  console.error('构建失败:', e);
  process.exit(1);
});
