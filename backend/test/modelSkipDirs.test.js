/**
 * 模型目录跳过判据测试（utils/model-utils.js 的 shouldSkipDir / isSkippedPath）
 *
 * 这条判据同时被两侧用：`/admin/scan` 决定哪些目录会被入库，`/api/models/file/*` 决定哪些路径拒发。
 * 修它之前判据只认 `_bak_` 前缀 + 三个写死的名字，于是 quarantine-orphans.js 造的
 * `_quarantine_隔离区` 和新加的 `_offlined_<日期>` 都不算跳过——工具注释里"以 _ 开头所以不会被扫描"
 * 那句当时是假的：下架/隔离的 .pmx 会被下一轮扫描重新插回 model_configs，展厅复活，匿名文件口照发。
 *
 * 全部是纯函数，不连数据库、不碰请求、不动盘。
 * 运行: node --test test/modelSkipDirs.test.js
 */
const test = require('node:test')
const assert = require('node:assert')

const { shouldSkipDir, isSkippedPath } = require('../utils/model-utils')

test('隔离区前缀一律跳过：_offlined_/_quarantine_/_bak_ 都在闸内', () => {
  assert.strictEqual(shouldSkipDir('_offlined_20261011'), true)
  assert.strictEqual(shouldSkipDir('_quarantine_隔离区'), true)
  assert.strictEqual(shouldSkipDir('_bak_20261001'), true)
  assert.strictEqual(shouldSkipDir('.hidden'), true)
  // 写死的三个名字照旧认
  assert.strictEqual(shouldSkipDir('zip备份'), true)
  assert.strictEqual(shouldSkipDir('残缺模型'), true)
  assert.strictEqual(shouldSkipDir('_bak_'), true)
})

test('真模型目录不被误伤：名字里含下划线或点都不算隔离区', () => {
  // 盘上现量 28 个顶层目录没有一个以 _/. 开头，但名字里带下划线/点的必须照常入库
  assert.strictEqual(shouldSkipDir('今汐-鸣潮[作者名]'), false)
  assert.strictEqual(shouldSkipDir('神里绫华+原神[精细版]'), false)
  assert.strictEqual(shouldSkipDir('model_v2.final'), false)
  assert.strictEqual(shouldSkipDir('a_b_c'), false)
})

test('嵌套层也拦：目录内部混进隔离区时相对路径任一段命中即拒', () => {
  assert.strictEqual(isSkippedPath('今汐-鸣潮/_offlined_20261011/x.pmx'), true)
  assert.strictEqual(isSkippedPath('今汐-鸣潮/zip备份/tex.tga'), true)
  assert.strictEqual(isSkippedPath('今汐-鸣潮/tex/body.png'), false)
  // 反斜杠（Windows 相对路径）同样切段
  assert.strictEqual(isSkippedPath('今汐-鸣潮\\_quarantine_隔离区\\x.pmx'), true)
})
