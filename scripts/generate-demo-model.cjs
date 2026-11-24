#!/usr/bin/env node
'use strict'

// PortfolioBot is original project geometry assembled only from the primitives
// below. No existing PMX, texture, bone, or metadata is read by this generator.
const fs = require('node:fs')
const path = require('node:path')

const OUTPUT_PATH = path.join(__dirname, '..', 'models', 'demo', 'PortfolioBot.pmx')

const MATERIALS = [
  {
    name: 'Teal armor',
    englishName: 'Teal armor',
    diffuse: [0.12, 0.58, 0.62, 1],
    specular: [0.28, 0.55, 0.58],
    shininess: 42,
    ambient: [0.1, 0.24, 0.26],
  },
  {
    name: 'Ivory shell',
    englishName: 'Ivory shell',
    diffuse: [0.86, 0.9, 0.84, 1],
    specular: [0.32, 0.36, 0.34],
    shininess: 36,
    ambient: [0.28, 0.3, 0.28],
  },
  {
    name: 'Graphite joints',
    englishName: 'Graphite joints',
    diffuse: [0.1, 0.13, 0.16, 1],
    specular: [0.18, 0.22, 0.26],
    shininess: 24,
    ambient: [0.05, 0.06, 0.08],
  },
  {
    name: 'Amber lights',
    englishName: 'Amber lights',
    diffuse: [1, 0.58, 0.12, 1],
    specular: [0.5, 0.3, 0.08],
    shininess: 64,
    ambient: [0.65, 0.28, 0.04],
  },
]

const BOX_FACES = [
  { normal: [0, 0, 1], corners: [4, 5, 6, 7] },
  { normal: [0, 0, -1], corners: [1, 0, 3, 2] },
  { normal: [1, 0, 0], corners: [5, 1, 2, 6] },
  { normal: [-1, 0, 0], corners: [0, 4, 7, 3] },
  { normal: [0, 1, 0], corners: [7, 6, 2, 3] },
  { normal: [0, -1, 0], corners: [0, 1, 5, 4] },
]
const FACE_UVS = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

function buildRobot() {
  const vertices = []
  const facesByMaterial = MATERIALS.map(() => [])

  function addBox(center, size, materialIndex) {
    const half = size.map((value) => value / 2)
    const corners = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ].map(([x, y, z]) => [
      center[0] + x * half[0],
      center[1] + y * half[1],
      center[2] + z * half[2],
    ])

    for (const face of BOX_FACES) {
      const base = vertices.length
      for (let i = 0; i < 4; i++) {
        vertices.push({
          position: corners[face.corners[i]],
          normal: face.normal,
          uv: FACE_UVS[i],
        })
      }
      facesByMaterial[materialIndex].push([base, base + 1, base + 2], [base, base + 2, base + 3])
    }
  }

  // Torso, pelvis, head, and backpack.
  addBox([0, 6.25, 0], [2.2, 2.8, 1.1], 0)
  addBox([0, 6.55, 0.61], [1.45, 1.35, 0.18], 1)
  addBox([0, 4.45, 0], [1.65, 0.8, 0.95], 2)
  addBox([0, 8.8, 0], [1.8, 1.5, 1.4], 1)
  addBox([0, 8.95, 0.73], [1.35, 0.55, 0.12], 2)
  addBox([-0.36, 8.98, 0.81], [0.22, 0.16, 0.08], 3)
  addBox([0.36, 8.98, 0.81], [0.22, 0.16, 0.08], 3)
  addBox([0, 9.82, 0], [0.12, 0.45, 0.12], 2)
  addBox([0, 10.12, 0], [0.28, 0.28, 0.28], 3)
  addBox([0, 6.25, -0.76], [1.4, 1.8, 0.42], 2)

  // Arms and hands.
  for (const side of [-1, 1]) {
    addBox([side * 1.42, 6.85, 0], [0.72, 0.72, 0.9], 0)
    addBox([side * 1.45, 5.85, 0], [0.58, 1.3, 0.62], 1)
    addBox([side * 1.45, 4.95, 0], [0.66, 0.58, 0.68], 2)
    addBox([side * 1.45, 4.2, 0], [0.72, 1.1, 0.76], 0)
    addBox([side * 1.45, 3.42, 0], [0.66, 0.58, 0.72], 2)
  }

  // Legs and feet.
  for (const side of [-1, 1]) {
    addBox([side * 0.55, 3.32, 0], [0.76, 1.45, 0.84], 1)
    addBox([side * 0.55, 2.32, 0], [0.8, 0.58, 0.88], 2)
    addBox([side * 0.55, 1.35, 0], [0.82, 1.45, 0.9], 0)
    addBox([side * 0.55, 0.35, 0.18], [0.92, 0.6, 1.42], 2)
  }

  return { vertices, facesByMaterial }
}

const u8 = (value) => {
  const bytes = Buffer.alloc(1)
  bytes.writeUInt8(value)
  return bytes
}
const u16 = (value) => {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16LE(value)
  return bytes
}
const i16 = (value) => {
  const bytes = Buffer.alloc(2)
  bytes.writeInt16LE(value)
  return bytes
}
const u32 = (value) => {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}
const f32 = (value) => {
  const bytes = Buffer.alloc(4)
  bytes.writeFloatLE(value)
  return bytes
}
const f32Array = (values) => Buffer.concat(values.map(f32))
const text = (value) => {
  const bytes = Buffer.from(value, 'utf16le')
  return Buffer.concat([u32(bytes.length), bytes])
}

function buildPmx() {
  const { vertices, facesByMaterial } = buildRobot()
  const faces = facesByMaterial.flat()
  if (vertices.length > 65536)
    throw new Error('PortfolioBot exceeds the two-byte vertex index limit')

  const chunks = []
  const push = (...values) => chunks.push(...values)

  // PMX 2.0 header: UTF-16LE, no extra UVs, two-byte unsigned face indices,
  // and two-byte signed indices for textures/materials/bones/morphs/rigid bodies.
  push(
    Buffer.from('PMX ', 'ascii'),
    f32(2),
    u8(8),
    u8(0),
    u8(0),
    u8(2),
    u8(2),
    u8(2),
    u8(2),
    u8(2),
    u8(2),
  )
  push(
    text('PortfolioBot'),
    text('PortfolioBot'),
    text(
      'Original low-poly portfolio robot. CC0 1.0 Universal. No third-party model or texture data.',
    ),
    text(
      'Original low-poly portfolio robot. CC0 1.0 Universal. No third-party model or texture data.',
    ),
  )

  push(u32(vertices.length))
  for (const vertex of vertices) {
    push(
      f32Array(vertex.position),
      f32Array(vertex.normal),
      f32Array(vertex.uv),
      u8(0), // BDEF1: rigidly weighted to the single root bone.
      i16(0),
      f32(1),
    )
  }

  push(u32(faces.length * 3))
  for (const face of faces) {
    for (const index of face) push(u16(index))
  }

  push(u32(0)) // Texture table: all materials use procedural color and built-in toon shading.

  push(u32(MATERIALS.length))
  for (let i = 0; i < MATERIALS.length; i++) {
    const material = MATERIALS[i]
    const faceCount = facesByMaterial[i].length * 3
    if (faceCount === 0) throw new Error(`Material ${material.name} has no faces`)
    push(
      text(material.name),
      text(material.englishName),
      f32Array(material.diffuse),
      f32Array(material.specular),
      f32(material.shininess),
      f32Array(material.ambient),
      u8(0x11), // Double-sided plus visible outline, robust for a tiny demo mesh.
      f32Array([0.04, 0.06, 0.07, 1]),
      f32(0.8),
      i16(-1), // No base texture.
      i16(-1), // No environment texture.
      u8(0),
      u8(1), // Built-in toon ramp.
      i8(-1),
      text('Original PortfolioBot material'),
      u32(faceCount),
    )
  }

  push(u32(1)) // One root bone is enough for MMDLoader's SkinnedMesh contract.
  push(
    text('Root'),
    text('Root'),
    f32Array([0, 5, 0]),
    i16(-1),
    u32(0),
    u16(0),
    f32Array([0, 0, 0]),
  )

  push(u32(0)) // Morphs.
  push(u32(0)) // Display frames.
  push(u32(0)) // Rigid bodies.
  push(u32(0)) // Constraints.

  return Buffer.concat(chunks)
}

const i8 = (value) => {
  const bytes = Buffer.alloc(1)
  bytes.writeInt8(value)
  return bytes
}

function main() {
  const bytes = buildPmx()
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUTPUT_PATH) || !fs.readFileSync(OUTPUT_PATH).equals(bytes)) {
      console.error(`[演示模型] 提交文件与确定性生成结果不一致：${OUTPUT_PATH}`)
      process.exitCode = 1
      return
    }
    console.log(`[演示模型] 校验通过：${OUTPUT_PATH}（${bytes.length} bytes）`)
    return
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, bytes)
  console.log(`[演示模型] 已生成：${OUTPUT_PATH}（${bytes.length} bytes）`)
}

if (require.main === module) main()

module.exports = { buildPmx, OUTPUT_PATH }
