import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanGraph } from '../lib/lib/scan.js'
import { listTemplates } from '../lib/lib/templates.js'

const miniPath = 'D:\\download\\59-MiniMax-H3 文生视频 工作流-带加速 (1).json'
const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')

const fixture = {
  187: {
    class_type: 'PrimitiveStringMultiline',
    inputs: { value: '0 to 5 seconds: a woman walks, camera pulls back.' },
    _meta: { title: '字符串（多行）' },
  },
  185: {
    class_type: 'XB_HailuoH3VideoParams',
    inputs: { duration: 5, fps: 24, aspect_ratio: '9:16 (Portrait Widescreen)', megapixels: 0.22 },
  },
  173: { class_type: 'RandomNoise', inputs: { noise_seed: 1 } },
  176: { class_type: 'BasicScheduler', inputs: { steps: 20, denoise: 1, scheduler: 'simple', model: ['199', 0] } },
  177: { class_type: 'UNETLoader', inputs: { unet_name: 'MiniMax_H3.safetensors' } },
  178: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl.safetensors', type: 'minimax' } },
  179: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae.safetensors' } },
  184: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_audio_vae.safetensors' } },
  190: { class_type: 'XB_VAEDecode', inputs: { samples: ['189', 0], vae: ['179', 0] } },
  191: { class_type: 'VAEDecodeAudio', inputs: { samples: ['189', 0], vae: ['184', 0] } },
  193: {
    class_type: 'VHS_VideoCombine',
    inputs: { frame_rate: 24, format: 'video/h264-mp4', save_output: true, images: ['190', 0], audio: ['191', 0] },
  },
  194: {
    class_type: 'MiniMaxH3ImageToVideo',
    inputs: { prompt: ['187', 0], width: ['185', 0], height: ['185', 1], length: ['185', 2], clip: ['178', 0], vae: ['179', 0] },
    _meta: { title: 'MiniMax H3 Image to Video' },
  },
  196: { class_type: 'XB_CanvasLabel', inputs: {}, _meta: { title: 'MiniMax-H3 文生视频 工作流' } },
}

describe('scan', () => {
  it('rejects UI format', () => {
    assert.throws(() => scanGraph({ last_node_id: 1, nodes: [], links: [] }), /API/)
  })

  it('reads a MiniMax-like graph as t2v with no image slot', () => {
    const r = scanGraph(fixture)
    assert.ok(r.contract.capabilities.mode.includes('t2v'))
    assert.ok(!r.contract.capabilities.mode.includes('i2v'))
    assert.ok(!r.contract.slots.image)
    assert.equal(r.contract.slots.prompt.node, '187')
    assert.equal(r.contract.slots.prompt.field, 'value')
    assert.equal(r.contract.slots.duration.node, '185')
    assert.ok(r.contract.media.out.includes('video'))
    assert.ok(r.contract.media.out.includes('audio'))
    assert.ok(r.contract.capabilities.cannot.includes('t2i'))
    assert.ok(r.contract.capabilities.cannot.includes('lora_switch'))
    assert.equal(r.contract.models.clip_type.field, 'type')
    assert.ok(r.contract.models.vae_audio)
    assert.equal(r.contract.title, 'MiniMax-H3 文生视频 工作流')
  })

  it('scans the real MiniMax JSON if present (no execute)', () => {
    if (!fs.existsSync(miniPath)) {
      return
    }
    const raw = JSON.parse(fs.readFileSync(miniPath, 'utf8'))
    const r = scanGraph(raw, { fileBase: path.basename(miniPath) })
    assert.ok(r.contract.capabilities.mode.includes('t2v'), JSON.stringify(r.summary))
    assert.equal(r.contract.slots.prompt.node, '187')
    assert.ok(r.contract.media.out.includes('video'))
    assert.ok(r.contract.capabilities.cannot.includes('i2i'))
    assert.equal((r.contract.loras || []).length, 0)
  })

  it('still lists the three hand-written anima templates', () => {
    const list = listTemplates(templatesDir)
    assert.deepEqual(list.map((t) => t.id).sort(), ['anima-i2i', 'anima-i2i-multi-out', 'anima-txt2img'])
  })
})

describe('official-node classification', () => {
  const coreGraph = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd15.safetensors' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['6', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
    '10': { class_type: 'LoadImage', inputs: { image: 'x.png' } },
  }

  const customWarning = (r) => r.contract.warnings.find((w) => w.startsWith('Custom nodes required'))

  it('does not flag official core nodes as custom (offline set)', () => {
    const r = scanGraph(coreGraph)
    assert.equal(customWarning(r), undefined, JSON.stringify(r.contract.warnings))
  })

  it('flags genuinely custom nodes only, with offline annotation', () => {
    const g = {
      '2': { class_type: 'VHS_VideoCombine', inputs: { frame_rate: 24, images: ['3', 0] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['0', 0], vae: ['0', 1] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } },
    }
    const w = customWarning(scanGraph(g))
    assert.ok(w.includes('VHS_VideoCombine'), w)
    assert.ok(!w.includes('SaveImage'), w)
    assert.ok(!w.includes('VAEDecode'), w)
    assert.ok(w.includes('offline'), w)
  })

  it('classifies Simple String as custom (cg-use-everywhere), not core', () => {
    const g = { '1': { class_type: 'Simple String', inputs: { string: 'hi' }, _meta: { title: 'msg' } } }
    const w = customWarning(scanGraph(g))
    assert.ok(w && w.includes('Simple String'), JSON.stringify(w))
  })

  it('respects a live officialClasses override and marks it verified', () => {
    const g = {
      '2': { class_type: 'VHS_VideoCombine', inputs: { frame_rate: 24, images: ['3', 0] } },
      '3': { class_type: 'MysteryFutureNode', inputs: { value: 1 } },
    }
    const live = new Set(['VHS_VideoCombine', 'MysteryFutureNode'])
    const r = scanGraph(g, { officialClasses: live })
    assert.equal(customWarning(r), undefined, JSON.stringify(r.contract.warnings))

    const partial = scanGraph(g, { officialClasses: new Set(['VHS_VideoCombine']) })
    const w = customWarning(partial)
    assert.ok(w.includes('MysteryFutureNode') && !w.includes('VHS_VideoCombine'), w)
    assert.ok(w.includes('verified'), w)
  })
})
