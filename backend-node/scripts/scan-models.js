/**
 * 扫描模型目录,找出乱码文件名和路径不匹配问题
 */
const fs = require('fs')
const path = require('path')

const MODELS_DIR = path.join(__dirname, '..', '..', 'models')

// 乱码判断: 文件名含 U+FFFD(替换字符)或私用区字符(U+E000-U+F8FF)即为乱码
// 这两种字符是解码失败/编码错误的典型特征,正常文件名不会包含
function isMojibake(str) {
  for (const ch of str) {
    const code = ch.codePointAt(0)
    // U+FFFD 替换字符(UTF-8 解码失败的标志)
    if (code === 0xfffd) return true
    // U+E000 ~ U+F8FF 私用区字符(解压残留的特殊符号)
    if (code >= 0xe000 && code <= 0xf8ff) return true
  }
  return false
}

// 递归扫描目录
function scanDirectory(dirPath, relativePath = '') {
  const results = {
    mojibakeFiles: [],
    mojibakeDirs: [],
    pmxFiles: [],
    structureIssues: [],
  }

  try {
    const entries = fs.readdirSync(dirPath)

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry)
      const relPath = relativePath ? path.join(relativePath, entry) : entry

      if (isMojibake(entry)) {
        if (fs.statSync(fullPath).isDirectory()) {
          results.mojibakeDirs.push(relPath)
        } else {
          results.mojibakeFiles.push(relPath)
        }
      }

      if (fs.statSync(fullPath).isDirectory()) {
        const subResults = scanDirectory(fullPath, relPath)
        results.mojibakeFiles.push(...subResults.mojibakeFiles)
        results.mojibakeDirs.push(...subResults.mojibakeDirs)
        results.pmxFiles.push(...subResults.pmxFiles)
        results.structureIssues.push(...subResults.structureIssues)
      } else if (entry.toLowerCase().endsWith('.pmx')) {
        results.pmxFiles.push(fullPath)
      }
    }
  } catch (err) {
    results.structureIssues.push(`${dirPath}: ${err.message}`)
  }

  return results
}

// 解析PMX文件中的纹理引用
function analyzePmxTextures(pmxPath) {
  const issues = []
  try {
    const buffer = fs.readFileSync(pmxPath)

    // PMX格式: 二进制, 需要解析
    // 简化版: 查找文件名引用
    const content = buffer.toString('binary')

    // 尝试UTF-8解码查找
    const utf8Content = buffer.toString('utf8')
    const modelDir = path.dirname(pmxPath)

    // 查找常见的纹理引用模式
    const textureRefs = []

    // 查找 .png, .jpg, .bmp, .tga 等引用
    const extPattern = /\.(png|jpg|jpeg|bmp|tga|dds|tga)/gi
    let match
    while ((match = extPattern.exec(utf8Content)) !== null) {
      // 向前找文件名
      const start = Math.max(0, match.index - 50)
      const namePart = utf8Content.substring(start, match.index + match[0].length)
      // 清理乱码
      const cleanName = namePart.replace(/[^\x20-\x7E\u4e00-\u9fff\u3040-\u30FF]/g, '')
      if (cleanName.length > 4 && cleanName.length < 60) {
        textureRefs.push(cleanName.trim())
      }
    }

    // 检查引用的文件是否存在
    const existingFiles = new Set()
    function collectFiles(dir) {
      try {
        const files = fs.readdirSync(dir)
        files.forEach((f) => {
          existingFiles.add(f.toLowerCase())
          // 递归子目录
          const fullPath = path.join(dir, f)
          try {
            if (fs.statSync(fullPath).isDirectory()) {
              collectFiles(fullPath)
              existingFiles.add(`${f}/${f}`.toLowerCase())
            }
          } catch (e) {}
        })
      } catch (e) {}
    }
    collectFiles(modelDir)

    // 检查纹理引用是否存在
    const missingTextures = []
    for (const ref of textureRefs) {
      const refName = ref.split(/[/\\]/).pop()?.toLowerCase() || ref.toLowerCase()
      let found = false
      for (const existing of existingFiles) {
        if (existing.endsWith(refName)) {
          found = true
          break
        }
      }
      if (!found && refName.match(/\.(png|jpg|bmp|tga)$/i)) {
        missingTextures.push(refName)
      }
    }

    if (missingTextures.length > 0) {
      issues.push({
        pmx: path.relative(MODELS_DIR, pmxPath),
        missingTextures: [...new Set(missingTextures)].slice(0, 10),
      })
    }
  } catch (err) {
    issues.push({
      pmx: path.relative(MODELS_DIR, pmxPath),
      error: err.message,
    })
  }

  return issues
}

// 主程序
console.log('=== 模型目录扫描工具 ===\n')

console.log('扫描目录结构...')
const scanResult = scanDirectory(MODELS_DIR)

console.log(`\n发现 ${scanResult.mojibakeFiles.length} 个乱码文件:`)
scanResult.mojibakeFiles.forEach((f) => console.log(`  ${f}`))

console.log(`\n发现 ${scanResult.mojibakeDirs.length} 个乱码目录:`)
scanResult.mojibakeDirs.forEach((d) => console.log(`  ${d}`))

console.log(`\n发现 ${scanResult.pmxFiles.length} 个PMX文件`)
console.log('\n分析纹理引用...')

const allTextureIssues = []
for (const pmx of scanResult.pmxFiles) {
  const issues = analyzePmxTextures(pmx)
  allTextureIssues.push(...issues)
}

console.log(`\n发现 ${allTextureIssues.length} 个模型有纹理缺失问题:`)
for (const issue of allTextureIssues) {
  console.log(`\n  模型: ${issue.pmx}`)
  if (issue.missingTextures) {
    console.log(`  缺失纹理: ${issue.missingTextures.join(', ')}`)
  }
  if (issue.error) {
    console.log(`  错误: ${issue.error}`)
  }
}

// 汇总
console.log('\n=== 汇总 ===')
console.log(`乱码文件: ${scanResult.mojibakeFiles.length}`)
console.log(`乱码目录: ${scanResult.mojibakeDirs.length}`)
console.log(`纹理缺失模型: ${allTextureIssues.filter((i) => i.missingTextures).length}`)
console.log(`结构问题: ${scanResult.structureIssues.length}`)

// 导出详细结果
const reportPath = path.join(__dirname, 'scan-report.json')
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      mojibakeFiles: scanResult.mojibakeFiles,
      mojibakeDirs: scanResult.mojibakeDirs,
      textureIssues: allTextureIssues,
      structureIssues: scanResult.structureIssues,
    },
    null,
    2,
  ),
)

console.log(`\n详细报告已保存: ${reportPath}`)
