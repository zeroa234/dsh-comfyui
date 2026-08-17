import * as fs from 'node:fs'
import * as path from 'node:path'
import { listTemplates, loadContracts } from './templates.js'

const DEFAULT_LORA_META = {
  'anima-base-1-masterpiece-v51.safetensors': {
    triggerWords: 'masterpiece, best quality, very aesthetic',
    mode: 'both',
    note: '画质 LoRA。触发词会写进正向提示词。',
  },
  'anima-turbo-lora-v0.2.safetensors': {
    triggerWords: 'turbo',
    mode: 'model-only',
    note: '加速用，只加载模型、不要把 turbo 写进画面描述。',
  },
}

export function settingsFile(templatesDir) {
  return path.join(templatesDir, 'user-settings.json')
}

export function defaultSettings() {
  return {
    baseUrl: '',
    loras: { ...DEFAULT_LORA_META },
    templates: {},
  }
}

export function loadSettings(templatesDir) {
  const p = settingsFile(templatesDir)
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    const hasLoras = raw.loras && typeof raw.loras === 'object'
    return {
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      loras: hasLoras ? normalizeLoras(raw.loras) : { ...DEFAULT_LORA_META },
      templates: raw.templates && typeof raw.templates === 'object' ? normalizeTemplateNotes(raw.templates) : {},
    }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(templatesDir, patch) {
  const cur = loadSettings(templatesDir)
  const next = {
    baseUrl: patch.baseUrl != null ? String(patch.baseUrl) : cur.baseUrl,
    loras: patch.loras != null ? normalizeLoras(patch.loras) : cur.loras,
    templates: patch.templates != null ? normalizeTemplateNotes(patch.templates) : cur.templates,
  }
  fs.mkdirSync(templatesDir, { recursive: true })
  fs.writeFileSync(settingsFile(templatesDir), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

function normalizeLoras(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  for (const [name, meta] of Object.entries(input)) {
    const key = String(name).trim()
    if (!key) continue
    out[key] = {
      triggerWords: String(meta?.triggerWords ?? ''),
      mode: meta?.mode === 'model-only' ? 'model-only' : 'both',
      note: String(meta?.note ?? ''),
    }
  }
  return out
}

function normalizeTemplateNotes(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  for (const [id, meta] of Object.entries(input)) {
    const key = String(id).trim()
    if (!key) continue
    out[key] = { note: typeof meta === 'string' ? meta : String(meta?.note ?? '') }
  }
  return out
}

export function loraCatalog(templatesDir, settings) {
  const used = {}
  for (const c of loadContracts(templatesDir)) {
    for (const l of c.loras || []) {
      const name = l.default_name
      if (!name) continue
      if (!used[name]) used[name] = []
      used[name].push(`${c.id}:${l.key}`)
    }
  }
  const names = new Set([...Object.keys(used), ...Object.keys(settings.loras || {})])
  return [...names].sort().map((name) => ({
    name,
    triggerWords: settings.loras?.[name]?.triggerWords ?? '',
    mode: settings.loras?.[name]?.mode ?? 'both',
    usedBy: used[name] || [],
    in_registry: Object.prototype.hasOwnProperty.call(settings.loras || {}, name),
    note: settings.loras?.[name]?.note ?? '',
  }))
}

export function upsertLora(templatesDir, name, meta = {}) {
  const key = String(name || '').trim()
  if (!key) {
    throw Object.assign(new Error('lora name required'), { code: 'SLOT_REQUIRED' })
  }
  const cur = loadSettings(templatesDir)
  const prev = cur.loras[key] || { triggerWords: '', mode: 'both' }
  const nextMeta = {
    triggerWords: meta.triggerWords != null ? String(meta.triggerWords) : prev.triggerWords,
    mode: meta.mode === 'model-only' || meta.mode === 'both' ? meta.mode : prev.mode,
    note: meta.note != null ? String(meta.note) : (prev.note || ''),
  }
  return saveSettings(templatesDir, { loras: { ...cur.loras, [key]: nextMeta } })
}

export function removeLora(templatesDir, name) {
  const key = String(name || '').trim()
  const cur = loadSettings(templatesDir)
  if (!Object.prototype.hasOwnProperty.call(cur.loras, key)) {
    return { settings: cur, removed: false, name: key }
  }
  const loras = { ...cur.loras }
  delete loras[key]
  return { settings: saveSettings(templatesDir, { loras }), removed: true, name: key }
}

export function activeLoraNames(graph) {
  const names = []
  for (const node of Object.values(graph || {})) {
    if (node.class_type !== 'LoraLoader' && node.class_type !== 'LoraLoaderModelOnly') continue
    const n = node.inputs?.lora_name
    if (typeof n === 'string' && n) names.push(n)
  }
  return names
}

export function triggerPrefix(settings, names) {
  const parts = []
  for (const name of names) {
    const meta = settings?.loras?.[name]
    if (!meta?.triggerWords) continue
    if (meta.mode === 'model-only') continue
    const t = String(meta.triggerWords).trim()
    if (t) parts.push(t)
  }
  return parts.join(', ')
}

export function annotateTemplates(templatesDir, settings) {
  const notes = settings?.templates || {}
  return listTemplates(templatesDir).map((t) => {
    const user_note = String(notes[t.id]?.note || '').trim()
    return user_note ? { ...t, user_note } : { ...t, user_note: '' }
  })
}

export function annotateInspect(info, settings) {
  const user_note = String(settings?.templates?.[info.id]?.note || '').trim()
  const loras = (info.loras || []).map((l) => {
    const n = l.default_name ? settings?.loras?.[l.default_name]?.note : ''
    return { ...l, user_note: String(n || '').trim() }
  })
  return { ...info, user_note, loras }
}
