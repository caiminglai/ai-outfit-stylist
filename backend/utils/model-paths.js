const path = require('path')

const DEFAULT_MODEL_DIR = path.join(__dirname, '..', '..', 'models')

/** 模型静态下载与后台扫描共用的唯一根目录；测试在加载服务前注入系统临时目录。 */
function getModelDir() {
  return path.resolve(process.env.STYLEAI_MODEL_DIR || DEFAULT_MODEL_DIR)
}

module.exports = { getModelDir }
