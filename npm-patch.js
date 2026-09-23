/**
 * fs 路径修复补丁
 * 绕过 TRAE 环境中 reparse point 路径解析失败的问题
 * 用法: node --require e:\website\3.私人形象定制AI网站\npm-patch.js script.js
 *
 * 核心问题：fs.realpathSync 对 TRAE SOLO CN 路径抛出 ENOENT
 * 修复方案：realpathSync 失败时直接返回原始路径（不抛错）
 * 其他 fs 函数（existsSync/statSync/readFileSync 等）在原始路径上工作正常，不需要修改
 */
const fs = require('fs')

// 保存原始 realpathSync
const origRealpathSync = fs.realpathSync
const origRealpathSyncNative = fs.realpathSync.native

/**
 * realpathSync 包装：失败时返回原始路径
 * 这对于 reparse point/junction 路径是安全的，
 * 因为 Node.js 内部只是用 realpath 来做缓存和去重
 */
fs.realpathSync = function (p, options) {
  try {
    return origRealpathSync.call(fs, p, options)
  } catch (e) {
    // realpath 失败，返回原始路径
    // 对于 TRAE VFS 中的 reparse point，这是安全的降级策略
    return typeof p === 'string' ? p : (p && p.toString ? p.toString() : p)
  }
}

// 同样 patch native 版本
if (origRealpathSyncNative) {
  fs.realpathSync.native = function (p, options) {
    try {
      return origRealpathSyncNative.call(fs, p, options)
    } catch (e) {
      return typeof p === 'string' ? p : (p && p.toString ? p.toString() : p)
    }
  }
}
