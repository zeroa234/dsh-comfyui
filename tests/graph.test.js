import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { triggerPrefix, activeLoraNames } from '../lib/lib/store.js'
import {
  applyClassAliases,
  bypassNode,
  injectSlot,
  snapMultiple,
} from '../lib/lib/graph.js'
import { listTemplates, inspectTemplate } from '../lib/lib/templates.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates')

describe('graph', () => {
  it('snaps sizes to multiples of 8', () => {
    assert.equal(snapMultiple(1080), 1080)
    assert.equal(snapMultiple(1081), 1080)
    assert.equal(snapMultiple(512), 512)
    assert.equal(snapMultiple(7), 8)
  })

  it('injects slot values', () => {
    const g = { 24: { class_type: 'Simple String', inputs: { string: 'old' } } }
    injectSlot(g, { node: '24', field: 'string' }, 'new prompt')
    assert.equal(g[24].inputs.string, 'new prompt')
  })

  it('aliases AnimaLLLiteApply', async () => {
    const g = {
      24: { class_type: 'AnimaLLLiteApply', inputs: { lllite_name: 'x.safetensors', model: ['1', 0] } },
    }
    const applied = await applyClassAliases(g, async () => true)
    assert.equal(g[24].class_type, 'AnimaLLLiteApply_sdscripts')
    assert.equal(applied[0].from, 'AnimaLLLiteApply')
  })

  it('bypasses a LoRA node and rewires MODEL', () => {
    const g = {
      11: { class_type: 'UNETLoader', inputs: { unet_name: 'a.safetensors' } },
      26: {
        class_type: 'LoraLoader',
        inputs: { lora_name: 'q.safetensors', model: ['11', 0], clip: ['5', 0], strength_model: 1 },
      },
      10: { class_type: 'KSampler', inputs: { model: ['26', 0] } },
    }
    bypassNode(g, '26')
    assert.equal(g[26], undefined)
    assert.deepEqual(g[10].inputs.model, ['11', 0])
  })
})

describe('contracts', () => {
  it('lists three anima templates', () => {
    const list = listTemplates(templatesDir)
    assert.deepEqual(list.map((t) => t.id).sort(), ['anima-i2i', 'anima-i2i-multi-out', 'anima-txt2img'])
    const t2i = list.find((t) => t.id === 'anima-txt2img')
    assert.ok(t2i.cannot.includes('upscale'))
    assert.ok(t2i.lora_slots.some((s) => s.startsWith('quality')))
    assert.deepEqual(t2i.media.out, ['image'])
  })

  it('inspects i2i required image slot', () => {
    const info = inspectTemplate(templatesDir, 'anima-i2i')
    assert.equal(info.slots.image.required, true)
    assert.equal(info.prompt_style, 'natural_en')
    assert.equal(info.loras.length, 2)
  })
})

describe('lora trigger store', () => {
  it('prepends both-mode words and skips model-only turbo', () => {
    const settings = {
      loras: {
        'a.safetensors': { triggerWords: 'masterpiece, best quality', mode: 'both' },
        'turbo.safetensors': { triggerWords: 'turbo', mode: 'model-only' },
      },
    }
    assert.equal(
      triggerPrefix(settings, ['a.safetensors', 'turbo.safetensors']),
      'masterpiece, best quality',
    )
  })

  it('lists LoraLoader names still present in the graph', () => {
    const names = activeLoraNames({
      1: { class_type: 'LoraLoader', inputs: { lora_name: 'q.safetensors' } },
      2: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 't.safetensors' } },
      3: { class_type: 'KSampler', inputs: {} },
    })
    assert.deepEqual(names, ['q.safetensors', 't.safetensors'])
  })
})
