const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const MODEL_PATH = path.join(ROOT, 'models', 'demo', 'PortfolioBot.pmx')
const LICENSE_PATH = path.join(ROOT, 'models', 'demo', 'LICENSE.md')
const GENERATOR_PATH = path.join(ROOT, 'scripts', 'generate-demo-model.cjs')

test('the committed demo asset exists and declares PMX 2.0', () => {
  const bytes = fs.readFileSync(MODEL_PATH)
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'PMX ')
  assert.equal(bytes.readFloatLE(4), 2)
})

test('the demo asset carries the CC0 1.0 Universal declaration and official URL', () => {
  const license = fs.readFileSync(LICENSE_PATH, 'utf8')
  assert.match(license, /CC0 1\.0 Universal/)
  assert.ok(license.includes('https://creativecommons.org/publicdomain/zero/1.0/'))
})

test('the deterministic generator reproduces the committed PMX byte-for-byte', () => {
  const result = spawnSync(process.execPath, [GENERATOR_PATH, '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`)
})

test('real MMDLoader parses the demo PMX into geometry and material', async (t) => {
  // Three r160's fetch FileLoader emits browser ProgressEvent objects. Node has
  // Event/fetch but not ProgressEvent, so provide only that event data carrier;
  // HTTP loading, PMX parsing, geometry, and material construction stay real.
  const previousProgressEvent = globalThis.ProgressEvent
  if (!previousProgressEvent) {
    globalThis.ProgressEvent = class ProgressEvent extends Event {
      constructor(type, init = {}) {
        super(type)
        this.lengthComputable = Boolean(init.lengthComputable)
        this.loaded = Number(init.loaded || 0)
        this.total = Number(init.total || 0)
      }
    }
    t.after(() => {
      delete globalThis.ProgressEvent
    })
  }

  // Three r160 also decodes its embedded toon BMP through browser Image/canvas
  // APIs. These tiny stand-ins expose only the DOM surface ImageLoader and the
  // toon rotation use; the PMX parser, geometry builder, and material builder
  // remain the real upstream implementations.
  const previousDocument = globalThis.document
  if (!previousDocument) {
    class TestImage extends EventTarget {
      constructor() {
        super()
        this.width = 32
        this.height = 32
      }

      set src(_value) {
        queueMicrotask(() => this.dispatchEvent(new Event('load')))
      }
    }
    globalThis.document = {
      createElementNS(_namespace, tagName) {
        if (tagName === 'img') return new TestImage()
        throw new Error(`Unsupported test element: ${tagName}`)
      },
      createElement(tagName) {
        if (tagName !== 'canvas') throw new Error(`Unsupported test element: ${tagName}`)
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              clearRect() {},
              translate() {},
              rotate() {},
              drawImage() {},
              getImageData(_x, _y, width, height) {
                return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) }
              },
            }
          },
        }
      },
    }
    t.after(() => {
      delete globalThis.document
    })
  }

  // Use the same loader revision as app/public/three (r160), but resolve it as a
  // normal locked dependency so Node can load its real ESM export without a
  // browser, an import-map shim, or a parser double.
  const { MMDLoader } = await import('three/examples/jsm/loaders/MMDLoader.js')
  const bytes = fs.readFileSync(MODEL_PATH)

  const server = http.createServer((req, res) => {
    if (req.url !== '/PortfolioBot.pmx') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': bytes.length,
    })
    res.end(bytes)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(
    () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  )

  const address = server.address()
  const mesh = await new Promise((resolve, reject) => {
    new MMDLoader().load(
      `http://127.0.0.1:${address.port}/PortfolioBot.pmx`,
      resolve,
      undefined,
      reject,
    )
  })

  assert.equal(mesh.isSkinnedMesh, true)
  assert.ok(mesh.geometry.getAttribute('position').count > 0)
  assert.ok(mesh.geometry.getAttribute('normal').count > 0)
  assert.ok(mesh.geometry.index.count > 0)
  assert.ok(Array.isArray(mesh.material))
  assert.ok(mesh.material.length >= 3)
  assert.ok(mesh.material.every((material) => material.name.length > 0))
  assert.ok(mesh.geometry.groups.length === mesh.material.length)
})
