/**
 * .gz 预压缩优化脚本
 *
 * 功能:
 * 1. 为缺少 .pmx.gz 的启用模型生成压缩文件(level 9 最大压缩)
 * 2. 统计 .png.gz 文件占用的磁盘空间(供清理决策)
 *
 * 用法: node scripts/optimize-gz.js
 */
const db = require('../db/init');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MODELS_DIR = path.join(__dirname, '..', '..', 'models');

// ============================================================
// 第一步:为缺少 .pmx.gz 的启用模型生成压缩文件
// ============================================================
function generateMissingPmxBz() {
  const enabled = db
    .prepare('SELECT id, name, folder, file FROM model_configs WHERE enabled = 1 ORDER BY id')
    .all();

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const m of enabled) {
    const pmxPath = path.join(MODELS_DIR, m.folder, m.file);
    const gzPath = pmxPath + '.gz';

    if (!fs.existsSync(pmxPath)) {
      console.log(`  ⚠ #${m.id} ${m.name} — .pmx 文件不存在,跳过`);
      failed++;
      continue;
    }

    if (fs.existsSync(gzPath)) {
      skipped++;
      continue;
    }

    // 生成 .pmx.gz (level 9 最大压缩)
    try {
      const pmxBuffer = fs.readFileSync(pmxPath);
      const gzBuffer = zlib.gzipSync(pmxBuffer, { level: 9 });
      fs.writeFileSync(gzPath, gzBuffer);

      const origKB = (pmxBuffer.length / 1024).toFixed(1);
      const gzKB = (gzBuffer.length / 1024).toFixed(1);
      const ratio = ((1 - gzBuffer.length / pmxBuffer.length) * 100).toFixed(1);
      console.log(`  ✓ #${m.id} ${m.name} — ${origKB}KB → ${gzKB}KB (节省 ${ratio}%)`);
      generated++;
    } catch (err) {
      console.log(`  ✗ #${m.id} ${m.name} — 压缩失败: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n  汇总: 新生成 ${generated} | 已存在 ${skipped} | 失败 ${failed}`);
  return generated;
}

// ============================================================
// 第二步:统计 .png.gz 文件(PNG 已压缩,.gz 几乎无收益)
// ============================================================
function statPngGz() {
  console.log('\n=== .png.gz 文件统计 ===');
  console.log('(PNG 本身已压缩,.gz 仅节省 0~0.1%,可安全删除释放磁盘)\n');

  function walk(dir) {
    const results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walk(fullPath));
      } else if (entry.name.endsWith('.png.gz')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  if (!fs.existsSync(MODELS_DIR)) return;

  const pngGzFiles = walk(MODELS_DIR);
  const totalSize = pngGzFiles.reduce((sum, f) => sum + fs.statSync(f).size, 0);

  console.log(`  .png.gz 文件数: ${pngGzFiles.length}`);
  console.log(`  总占用: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  建议: 删除这些文件可释放 ${(totalSize / 1024 / 1024).toFixed(1)} MB 磁盘空间`);

  return { count: pngGzFiles.length, size: totalSize, files: pngGzFiles };
}

// ============================================================
// 主流程
// ============================================================
console.log('=== 第一步:为缺少 .pmx.gz 的启用模型生成压缩文件 ===\n');
generateMissingPmxBz();

const pngGzStats = statPngGz();

// 如果传入 --clean 参数,删除 .png.gz 文件
if (process.argv.includes('--clean') && pngGzStats && pngGzStats.count > 0) {
  console.log('\n=== 清理 .png.gz 文件 ===\n');
  let deleted = 0;
  for (const f of pngGzStats.files) {
    try {
      fs.unlinkSync(f);
      deleted++;
    } catch (err) {
      console.log(`  ✗ 删除失败: ${path.basename(f)} — ${err.message}`);
    }
  }
  console.log(`  已删除 ${deleted}/${pngGzStats.count} 个 .png.gz 文件`);
  console.log(`  释放 ${(pngGzStats.size / 1024 / 1024).toFixed(1)} MB 磁盘空间`);
}
