import * as fs from 'node:fs'
import * as path from 'node:path'
import { scanGraph } from './scan.js'
import { loadSettings, saveSettings } from './store.js'
import { getContract } from './templates.js'

const MAX_BYTES = 20 * 1024 * 1024

function safeId(id) {
  const s = String(id || '').trim().replace(/[<>:"/\\|?*]/g, '-').replace(/\.+$/, '')
  if (!s || s === '.' || s === '..') {
    throw Object.assign(new Error('Bad template id'), { code: 'BAD_ID' })
  }
  return s
}

export function scanPath(filePath, opts = {}) {
  const abs = path.resolve(String(filePath || ''))
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw Object.assign(new Error(`FILE_MISSING:${abs}`), { code: 'FILE_MISSING', path: abs })
  }
  const st = fs.statSync(abs)
  if (st.size > MAX_BYTES) {
    throw Object.assign(new Error('Workflow JSON too large'), { code: 'TOO_LARGE' })
  }
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'))
  return scanGraph(raw, { ...opts, fileBase: path.basename(abs), sourcePath: abs })
}

export function saveTemplate(templatesDir, filePath, opts = {}) {
  const scanned = scanPath(filePath, opts)
  const id = safeId(opts.id || scanned.contract.id)
  const title = String(opts.title || scanned.contract.title || id)
  scanned.contract.id = id
  scanned.contract.title = title
  scanned.contract.workflow = `${id}.json`

  const wfDest = path.join(templatesDir, `${id}.json`)
  const cDest = path.join(templatesDir, `${id}.contract.json`)
  if (!opts.overwrite && (fs.existsSync(wfDest) || fs.existsSync(cDest))) {
    throw Object.assign(new Error(`Template id "${id}" already exists`), { code: 'EXISTS', id })
  }

  const abs = path.resolve(String(filePath))
  fs.mkdirSync(templatesDir, { recursive: true })
  fs.copyFileSync(abs, wfDest)

  const contract = { ...scanned.contract }
  const warnings = contract.warnings || []
  delete contract.warnings
  fs.writeFileSync(cDest, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    id,
    workflow: wfDest,
    contract: cDest,
    summary: scanned.summary,
    warnings,
  }
}

function insideTemplatesDir(templatesDir, file) {
  if (!file) return false
  const root = path.resolve(templatesDir)
  const abs = path.resolve(file)
  const rel = path.relative(root, abs)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function unlinkInside(templatesDir, file, deleted) {
  if (!insideTemplatesDir(templatesDir, file)) return
  const abs = path.resolve(file)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return
  fs.unlinkSync(abs)
  deleted.push(path.basename(abs))
}

export function removeTemplate(templatesDir, id) {
  const key = safeId(id)
  const contract = getContract(templatesDir, key)
  const deleted = []
  unlinkInside(templatesDir, contract._contractPath, deleted)
  unlinkInside(templatesDir, contract._workflowPath, deleted)
  unlinkInside(templatesDir, path.join(templatesDir, `${key}.json`), deleted)
  unlinkInside(templatesDir, path.join(templatesDir, `${key}.contract.json`), deleted)

  const cur = loadSettings(templatesDir)
  const templates = { ...cur.templates }
  delete templates[key]
  saveSettings(templatesDir, { templates })

  return { ok: true, id: key, deleted: [...new Set(deleted)] }
}
