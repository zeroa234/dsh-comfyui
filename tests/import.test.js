import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { removeTemplate } from '../lib/lib/import-template.js'
import { loadSettings, saveSettings } from '../lib/lib/store.js'
import { listTemplates } from '../lib/lib/templates.js'

describe('removeTemplate', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-comfyui-rm-'))
  const outside = path.join(dir, '..', 'outside-workflow.json')
  after(() => {
    rmSync(dir, { recursive: true, force: true })
    try { rmSync(outside, { force: true }) } catch { /* ignore */ }
  })

  it('deletes contract + in-folder workflow and drops the user note', () => {
    writeFileSync(path.join(dir, 'gone.json'), '{"1":{"class_type":"SaveImage","inputs":{}}}')
    writeFileSync(path.join(dir, 'gone.contract.json'), JSON.stringify({
      id: 'gone',
      title: 'Gone',
      workflow: 'gone.json',
      slots: {},
    }))
    saveSettings(dir, { templates: { gone: { note: 'delete me' } } })

    const result = removeTemplate(dir, 'gone')
    assert.equal(result.ok, true)
    assert.ok(result.deleted.includes('gone.json'))
    assert.ok(result.deleted.includes('gone.contract.json'))
    assert.equal(existsSync(path.join(dir, 'gone.json')), false)
    assert.equal(existsSync(path.join(dir, 'gone.contract.json')), false)
    assert.equal(listTemplates(dir).some((t) => t.id === 'gone'), false)
    assert.equal(loadSettings(dir).templates.gone, undefined)
  })

  it('does not unlink a workflow that lives outside templates/', () => {
    writeFileSync(outside, '{"keep":true}')
    writeFileSync(path.join(dir, 'ext.contract.json'), JSON.stringify({
      id: 'ext',
      title: 'External',
      workflow: outside,
      slots: {},
    }))

    removeTemplate(dir, 'ext')
    assert.equal(existsSync(path.join(dir, 'ext.contract.json')), false)
    assert.equal(existsSync(outside), true)
  })

  it('throws TEMPLATE_NOT_FOUND for an unknown id', () => {
    assert.throws(() => removeTemplate(dir, 'nope'), /TEMPLATE_NOT_FOUND/)
  })
})
