/**
 * 乱码纹理文件修复工具
 *
 * 问题:解压 zip 时编码错误,导致文件系统里的中文文件名变成乱码,
 *       但 PMX 文件里存的纹理名是正确的 UTF-16LE 中文,渲染时找不到纹理.
 *
 * 修复策略:
 * 1. 解析每个 PMX,提取纹理引用(正确名)
 * 2. 找出"PMX 引用但文件系统缺失"的纹理
 * 3. 第一轮:按 ASCII 前缀匹配(如 "starby1010浣.png" ↔ "starby1010�.png")
 * 4. 第二轮:剩余按目录 1:1 配对(缺失数 == 乱码数)
 * 5. 统计未被任何 PMX 引用的孤儿乱码文件(建议人工确认后删除)
 *
 * 用法:
 *   node fix-mojibake.js --dry-run    # 预览,不实际改名
 *   node fix-mojibake.js --apply       # 实际执行改名
 *   node fix-mojibake.js --apply --delete-orphans  # 同时删除孤儿乱码
 */
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.resolve(__dirname, '..', '..', 'models');
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run') || !args.has('--apply');
const DELETE_ORPHANS = args.has('--delete-orphans');

/**
 * 读取 PMX 文件的纹理引用列表
 * 参考: https://gist.github.com/felixjones/f8a06bd6809f57cd04c9
 */
function readPmxTextures(pmxPath) {
  const buf = fs.readFileSync(pmxPath);
  if (buf.toString('ascii', 0, 4) !== 'PMX ') {
    throw new Error('不是 PMX 文件: ' + pmxPath);
  }
  let offset = 8;
  const globalsCount = buf.readUInt8(offset);
  offset += 1;
  const textEncoding = buf.readUInt8(offset);
  offset += 1;
  const additionalUvCount = buf.readUInt8(offset);
  offset += 1;
  const vertexIdxSize = buf.readUInt8(offset);
  offset += 1;
  offset += 1; // textureIdxSize
  offset += 1; // materialIdxSize
  const boneIdxSize = buf.readUInt8(offset);
  offset += 1;
  offset += 1; // morphIdxSize
  offset += 1; // rigidbodyIdxSize
  offset += Math.max(0, globalsCount - 8);

  function readString() {
    const len = buf.readInt32LE(offset);
    offset += 4;
    const content = buf.slice(offset, offset + len);
    offset += len;
    return textEncoding === 0 ? content.toString('utf16le') : content.toString('utf8');
  }

  readString(); // model name
  readString(); // english model name
  readString(); // comment
  readString(); // english comment

  const vertexCount = buf.readUInt32LE(offset);
  offset += 4;
  for (let i = 0; i < vertexCount; i++) {
    offset += 12 + 12 + 8 + additionalUvCount * 16;
    const weightType = buf.readUInt8(offset);
    offset += 1;
    if (weightType === 0) offset += boneIdxSize;
    else if (weightType === 1) offset += boneIdxSize * 2 + 4;
    else if (weightType === 2) offset += boneIdxSize * 4 + 16;
    else if (weightType === 3) offset += boneIdxSize * 2 + 40;
    else if (weightType === 4) offset += boneIdxSize * 4 + 16;
    else throw new Error(`未知权重类型 ${weightType}`);
    offset += 4;
  }

  const faceCount = buf.readUInt32LE(offset);
  offset += 4;
  offset += faceCount * vertexIdxSize;

  const textureCount = buf.readUInt32LE(offset);
  offset += 4;
  const textures = [];
  for (let i = 0; i < textureCount; i++) {
    textures.push(readString());
  }
  return textures;
}

/**
 * 判断文件名是否为乱码
 * 检测:U+FFFD(替换字符)+ 私用区字符(U+E000-U+F8FF)
 */
function isMojibake(name) {
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (code === 0xfffd) return true;
    if (code >= 0xe000 && code <= 0xf8ff) return true;
  }
  return false;
}

// === 主流程 ===
console.log(`模式: ${DRY_RUN ? 'DRY-RUN(预览)' : 'APPLY(实际执行)'}`);
console.log(`删除孤儿: ${DELETE_ORPHANS ? '是' : '否'}`);
console.log('');

// 1. 收集所有 PMX 文件
const pmxFiles = [];
function scanPmx(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 跳过 zip 备份、隔离区(以 _ 开头的内部目录)、隐藏目录
    if (entry.name === 'zip备份' || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanPmx(full);
    } else if (entry.name.toLowerCase().endsWith('.pmx')) {
      pmxFiles.push(full);
    }
  }
}
scanPmx(MODELS_DIR);
console.log(`扫描到 ${pmxFiles.length} 个 PMX 文件`);

// 2. 对每个 PMX,找出缺失纹理 + 同目录候选乱码文件
const renamePlan = [];
const allReferencedTextures = new Set();
const dirPending = new Map(); // texDir -> { missing: [{texPath, tex, pmx}...] }

for (const pmx of pmxFiles) {
  let textures;
  try {
    textures = readPmxTextures(pmx);
  } catch (e) {
    console.warn(`[跳过] 解析失败: ${pmx} - ${e.message}`);
    continue;
  }
  const pmxDir = path.dirname(pmx);
  for (const tex of textures) {
    allReferencedTextures.add(path.basename(tex));
    const texPath = path.isAbsolute(tex) ? tex : path.join(pmxDir, tex);
    if (fs.existsSync(texPath)) continue;

    const texDir = path.dirname(texPath);
    const texBasename = path.basename(tex);
    if (!fs.existsSync(texDir)) continue;

    // 第一轮:ASCII 前缀匹配
    const asciiPrefixMatch = texBasename.match(/^([a-zA-Z0-9_-]{4,})/);
    const asciiPrefix = asciiPrefixMatch ? asciiPrefixMatch[1] : null;

    let matched = false;
    if (asciiPrefix) {
      for (const file of fs.readdirSync(texDir)) {
        if (file === texBasename || !isMojibake(file)) continue;
        if (file.startsWith(asciiPrefix)) {
          renamePlan.push({
            from: path.join(texDir, file),
            to: texPath,
            pmx: path.relative(MODELS_DIR, pmx),
            texture: tex,
            reason: `前缀匹配 "${asciiPrefix}"`,
          });
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      if (!dirPending.has(texDir)) dirPending.set(texDir, { missing: [] });
      dirPending.get(texDir).missing.push({ texPath, tex, pmx });
    }
  }
}

// 第二轮:剩余按目录 1:1 配对
for (const [texDir, dp] of dirPending) {
  if (dp.missing.length === 0) continue;
  const matchedFromSet = new Set(renamePlan.map((r) => path.resolve(r.from)));
  const mojibakeFiles = fs
    .readdirSync(texDir)
    .filter((f) => isMojibake(f))
    .map((f) => path.join(texDir, f))
    .filter((f) => !matchedFromSet.has(path.resolve(f)));

  if (mojibakeFiles.length === dp.missing.length) {
    for (let i = 0; i < dp.missing.length; i++) {
      renamePlan.push({
        from: mojibakeFiles[i],
        to: dp.missing[i].texPath,
        pmx: path.relative(MODELS_DIR, dp.missing[i].pmx),
        texture: dp.missing[i].tex,
        reason: '同目录 1:1 配对',
      });
    }
  } else if (mojibakeFiles.length > 0) {
    console.warn(
      `[警告] 目录 ${texDir} 缺失 ${dp.missing.length} 个但乱码 ${mojibakeFiles.length} 个,需人工处理`,
    );
  }
}

// 3. 输出改名计划
console.log('');
console.log('=== 改名计划(乱码 → PMX 正确名)===');
if (renamePlan.length === 0) {
  console.log('(无)');
}
for (const r of renamePlan) {
  console.log(`PMX: ${r.pmx}`);
  console.log(`  缺失纹理: ${r.texture}`);
  console.log(`  候选乱码: ${path.basename(r.from)} (${r.reason})`);
  console.log(`  → 改名为: ${path.basename(r.to)}`);
  if (!DRY_RUN) {
    try {
      fs.renameSync(r.from, r.to);
      console.log('  [OK] 已改名');
    } catch (e) {
      console.log('  [FAIL] ' + e.message);
    }
  }
}

// 4. 统计孤儿乱码文件(没被任何 PMX 引用 + 不在改名计划中的乱码文件)
console.log('');
console.log('=== 孤儿乱码文件(未被任何 PMX 引用,建议人工确认后删除)===');
const renameFromSet = new Set(renamePlan.map((r) => path.resolve(r.from)));
const orphans = [];
function scanOrphans(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 跳过 zip 备份、隔离区(以 _ 开头的内部目录)、隐藏目录
    if (entry.name === 'zip备份' || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanOrphans(full);
    } else if (
      isMojibake(entry.name) &&
      !allReferencedTextures.has(entry.name) &&
      !renameFromSet.has(path.resolve(full))
    ) {
      orphans.push(full);
    }
  }
}
scanOrphans(MODELS_DIR);

if (orphans.length === 0) {
  console.log('(无)');
}
for (const o of orphans) {
  const rel = path.relative(MODELS_DIR, o);
  const size = fs.statSync(o).size;
  console.log(`  ${rel} (${size} bytes)`);
  if (!DRY_RUN && DELETE_ORPHANS) {
    try {
      fs.unlinkSync(o);
      console.log('    [OK] 已删除');
    } catch (e) {
      console.log('    [FAIL] ' + e.message);
    }
  }
}

console.log('');
console.log('=== 汇总 ===');
console.log(`改名计划: ${renamePlan.length} 个`);
console.log(`孤儿乱码: ${orphans.length} 个`);
if (DRY_RUN) {
  console.log(
    '(DRY-RUN 模式,未实际执行.加 --apply 执行改名,加 --apply --delete-orphans 同时删孤儿)',
  );
}
