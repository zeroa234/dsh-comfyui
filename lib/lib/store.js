import * as fs from 'node:fs'
import * as path from 'node:path'
import { listTemplates, loadContracts } from './templates.js'

const DEFAULT_LORA_META = {
  'anima-base-1-masterpiece-v51.safetensors': {
    triggerWords: 'masterpiece, best quality, very aesthetic',
    mode: 'both',
  },
  'anima-turbo-lora-v0.2.safetensors': {
    triggerWords: 'turbo',
    mode: 'model-only',
  },
}

export function settingsFile(templatesDir) {
  return path.join(templatesDir, 'user-settings.json')
}

export function defaultSettings() {
  return {
    baseUrl: '',
    loras: { ...DEFAULT_LORA_META },
  }
}

export function loadSettings(templatesDir) {
  const p = settingsFile(templatesDir)
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
    return {
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      loras: { ...DEFAULT_LORA_META, ...(raw.loras && typeof raw.loras === 'object' ? raw.loras : {}) },
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
    }
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
  }))
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

export { listTemplates }
