// 解析 PMX 文件,检查是否包含多个独立角色 mesh
// PMX 文件格式:头部(32字节) + 全局参数 + 各数据段(顶点/三角/骨骼/材质/Mesh)
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', '..', 'models');

// 读取 Gratia 模型(用户截图中出现的角色)
const pmxPath = path.join(MODELS_DIR, 'Gratia+其他', 'Gratia.pmx');

console.log(`=== 分析 ${path.basename(pmxPath)} ===\n`);

const buf = fs.readFileSync(pmxPath);

// PMX Header: 32 字节
const magic = buf.toString('ascii', 0, 4);
const version = buf.readFloatLE(4);
const encoding = buf.readUInt8(8);  // 0=UTF-16, 1=UTF-8
const additionalUV = buf.readUInt8(9);
const appendSystemBytes = buf.readUInt8(10);
console.log(`Magic: ${magic}, Version: ${version}, 编码: ${encoding === 1 ? 'UTF-8' : 'UTF-16'}`);

// 跳过头部,读取全局数据
// 全局参数: 24 字节 (1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+4)
// 简化:直接按 PMX 规范解析

// 跳过全局参数 (24 字节)
let offset = 32 + 24;

// 读取各数据段大小
function readSizedChunk() {
  const size = buf.readInt32LE(offset);
  offset += 4;
  const data = buf.slice(offset, offset + Math.abs(size));
  offset += Math.abs(size);
  return { size, data, type: size < 0 ? 'signed(负=索引格式变化)' : 'normal' };
}

console.log('\n=== 数据段分析 ===');

// 1. 顶点数据
const vertices = readSizedChunk();
const vertCount = vertices.size / (encoding === 1 ? 38 : 38); // 简化估算
console.log(`顶点段: ${vertices.size} 字节 (约 ${Math.abs(vertices.size) / 38 | 0} 个顶点)`);

// 2. 三角面数据
const triangles = readSizedChunk();
const triCount = Math.abs(triangles.size) / (encoding === 1 ? 3 : 3);
console.log(`三角面段: ${triangles.size} 字节 (约 ${Math.abs(triangles.size) / 3 | 0} 个三角面)`);

// 3. 纹理索引
const textures = readSizedChunk();
console.log(`纹理索引段: ${textures.size} 字节`);

// 4. 材质列表
const materials = readSizedChunk();
if (encoding === 1) {
  const matCount = Math.abs(materials.size) / (49 + 1 + 1 + 1 + 2 + 2 + 1);
  console.log(`材质段: ${materials.size} 字节 (约 ${Math.round(matCount)} 个材质)`);
}

// 5. 骨骼列表
const bones = readSizedChunk();
const boneCount = Math.abs(bones.size) / (encoding === 1 ? 15 : 24);
console.log(`骨骼段: ${bones.size} 字节 (约 ${Math.round(boneCount)} 根骨骼)`);

// 6. IK 列表
const iks = readSizedChunk();
console.log(`IK 段: ${iks.size} 字节`);

// 7. 表情列表
const expressions = readSizedChunk();
console.log(`表情段: ${expressions.size} 字节`);

// 8. 混合变形
const morphs = readSizedChunk();
console.log(`混合变形段: ${morphs.size} 字节`);

// 9. 显示/排序
const display = readSizedChunk();
console.log(`显示/排序段: ${display.size} 字节`);

// 10. 显示状态
const displayState = readSizedChunk();
console.log(`显示状态段: ${displayState.size} 字节`);

// 11. 文件名列表
const files = readSizedChunk();
// 文件名列表格式: 先是一个 int (数量),然后是数量个字符串
// 每个字符串: 4字节长度 + UTF-8 数据
if (files.size > 4) {
  const fileCount = files.data.readInt32LE(0);
  console.log(`\n文件名列表: ${fileCount} 个文件`);
  let fOffset = 4;
  const fileList = [];
  for (let i = 0; i < fileCount && fOffset < files.data.length; i++) {
    if (fOffset + 4 > files.data.length) break;
    const strLen = files.data.readInt32LE(fOffset);
    fOffset += 4;
    if (strLen > 0 && fOffset + strLen <= files.data.length) {
      const name = files.data.toString('utf-8', fOffset, fOffset + strLen);
      fileList.push(name);
      fOffset += strLen;
    } else {
      break;
    }
  }
  console.log(fileList.slice(0, 20).map((n, i) => `  [${i}] ${n}`).join('\n'));
  if (fileList.length > 20) console.log(`  ... 还有 ${fileList.length - 20} 个文件`);
}

// 12. 纹理引用
const textureRefs = readSizedChunk();
console.log(`\n纹理引用段: ${textureRefs.size} 字节`);
if (textureRefs.size > 0) {
  const texCount = Math.abs(textureRefs.size) / (encoding === 1 ? 8 : 8);
  console.log(`  约 ${Math.round(texCount)} 个纹理引用`);
}

// 检查是否到达文件末尾
console.log(`\n解析到偏移: ${offset}, 文件总大小: ${buf.length}`);

// === 关键检查:读取网格(Mesh)子网格信息 ===
// PMX 的显示/排序段包含了网格分组信息
// 在显示/排序段中,包含了每个显示组的名称和关联的材质/骨骼

// 简化:直接搜索 PMX 数据中的字符串标记
console.log('\n=== PMX 内部字符串搜索 ===');
const strBuf = buf.toString('utf-8');

// 搜索 "MESH" 或 "mesh" 标记
const meshMatches = [];
let idx = 0;
while ((idx = strBuf.indexOf('MESH', idx)) !== -1 && meshMatches.length < 5) {
  const context = strBuf.substring(Math.max(0, idx - 10), Math.min(strBuf.length, idx + 30));
  meshMatches.push({ position: idx, context });
  idx += 1;
}

// 搜索 "Toon" 或 "toon" 标记(Toon 贴图/材质)
const toonMatches = [];
idx = 0;
while ((idx = strBuf.indexOf('Toon', idx)) !== -1 && toonMatches.length < 5) {
  toonMatches.push({ position: idx });
  idx += 1;
}

// 搜索 "Texture" 或 "texture" 标记
const texMatches = [];
idx = 0;
while ((idx = strBuf.indexOf('Texture', idx)) !== -1 && texMatches.length < 10) {
  const context = strBuf.substring(Math.max(0, idx - 5), Math.min(strBuf.length, idx + 40));
  texMatches.push({ position: idx, context });
  idx += 1;
}

console.log(`'MESH' 标记: ${meshMatches.length} 处`);
console.log(`'Toon' 标记: ${toonMatches.length} 处`);
console.log(`'Texture' 标记: ${texMatches.length} 处`);

// 检查文件是否包含多个独立角色(通常不同角色用不同的 "root" 或 "center" 骨骼)
// 搜索骨骼名称中的角色标记
const boneNames = ['root', 'Root', 'center', 'Center', 'bust', 'Bust', 'arm', 'Arm', 'leg', 'Leg', 'head', 'Head'];
console.log('\n=== 骨骼关键字搜索 ===');
for (const bn of boneNames) {
  let count = 0;
  let pos = 0;
  while ((pos = strBuf.indexOf(bn, pos)) !== -1 && count < 5) {
    count++;
    pos += 1;
  }
  if (count > 0) {
    console.log(`  "${bn}": ${count}+ 处匹配`);
  }
}
