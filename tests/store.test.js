import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  annotateInspect,
  annotateTemplates,
  loadSettings,
  saveSettings,
} from '../lib/lib/store.js'
import { inspectTemplate } from '../lib/lib/templates.js'

describe('user notes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-comfyui-'))
  after(() => rmSync(dir, { recursive: true, force: true }))

  writeFileSync(path.join(dir, 'demo.contract.json'), JSON.stringify({
    id: 'demo',
    title: 'Demo',
    prompt_style: 'tags',
    prompt_hint: 'danbooru tags',
    slots: { prompt: { key: 'prompt', type: 'text', required: true, node: '1', field: 'text' } },
    loras: [{ key: 'style', default_name: 'foo.safetensors' }],
  }))

  it('round-trips template and lora notes', () => {
    saveSettings(dir, {
      loras: { 'foo.safetensors': { triggerWords: 'foo', mode: 'both', note: 'weight 0.7, photoreal only' } },
      templates: { demo: { note: 'SD1.5, use danbooru tags' } },
    })
    const settings = loadSettings(dir)
    assert.equal(settings.templates.demo.note, 'SD1.5, use danbooru tags')
    assert.equal(settings.loras['foo.safetensors'].note, 'weight 0.7, photoreal only')

    const listed = annotateTemplates(dir, settings)
    assert.equal(listed[0].user_note, 'SD1.5, use danbooru tags')
    assert.equal(listed[0].prompt_style, 'tags')

    const inspected = annotateInspect(inspectTemplate(dir, 'demo'), settings)
    assert.equal(inspected.user_note, 'SD1.5, use danbooru tags')
    assert.equal(inspected.loras[0].user_note, 'weight 0.7, photoreal only')
  })

  it('accepts a plain string as a template note', () => {
    saveSettings(dir, { templates: { demo: 'plain string note' } })
    assert.equal(loadSettings(dir).templates.demo.note, 'plain string note')
  })

  it('saving only loras does not wipe template notes', () => {
    saveSettings(dir, { templates: { demo: { note: 'keep me' } } })
    saveSettings(dir, { loras: { 'bar.safetensors': { triggerWords: 'bar' } } })
    assert.equal(loadSettings(dir).templates.demo.note, 'keep me')
  })

})
