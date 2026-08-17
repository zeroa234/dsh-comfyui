import * as fs from 'node:fs'
import * as path from 'node:path'

export function loadContracts(templatesDir) {
  if (!templatesDir || !fs.existsSync(templatesDir)) return []
  const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.contract.json'))
  const list = []
  for (const file of files) {
    const full = path.join(templatesDir, file)
    const raw = JSON.parse(fs.readFileSync(full, 'utf8'))
    raw._contractPath = full
    if (raw.workflow && !path.isAbsolute(raw.workflow)) {
      raw._workflowPath = path.join(templatesDir, raw.workflow)
    } else {
      raw._workflowPath = raw.workflow
    }
    list.push(raw)
  }
  return list.sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

export function getContract(templatesDir, id) {
  const found = loadContracts(templatesDir).find((c) => c.id === id)
  if (!found) {
    throw Object.assign(new Error(`TEMPLATE_NOT_FOUND:${id}`), { code: 'TEMPLATE_NOT_FOUND', template: id })
  }
  return found
}

export function loadWorkflow(contract) {
  const p = contract._workflowPath
  if (!p || !fs.existsSync(p)) {
    throw Object.assign(new Error(`WORKFLOW_MISSING:${p}`), { code: 'WORKFLOW_MISSING' })
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

export function deriveMedia(c) {
  if (c.media) return c.media
  const mode = c.capabilities?.mode || []
  const inn = []
  const out = []
  if (c.slots?.prompt) inn.push('text')
  if (c.slots?.image) inn.push('image')
  if (c.slots?.video) inn.push('video')
  if (c.slots?.audio) inn.push('audio')
  if (mode.includes('t2v') || mode.includes('i2v') || mode.includes('video')) out.push('video')
  else out.push('image')
  if ((c.capabilities?.can || []).includes('audio')) out.push('audio')
  return { in: [...new Set(inn)], out: [...new Set(out)] }
}

export function summarizeContract(c) {
  const slots = c.slots || {}
  const required = Object.values(slots).filter((s) => s.required).map((s) => s.key)
  const loraKeys = (c.loras || []).map((l) => `${l.key}:${l.role || 'lora'}${l.vacant ? ':vacant' : ''}`)
  const media = deriveMedia(c)
  return {
    id: c.id,
    title: c.title,
    prompt_style: c.prompt_style,
    prompt_hint: c.prompt_hint,
    media,
    capabilities: c.capabilities || {},
    required_slots: required,
    optional_slots: Object.values(slots).filter((s) => !s.required).map((s) => s.key),
    lora_slots: loraKeys,
    cannot: c.capabilities?.cannot || [],
  }
}

export function inspectContract(c) {
  return {
    id: c.id,
    title: c.title,
    prompt_style: c.prompt_style,
    prompt_hint: c.prompt_hint,
    media: deriveMedia(c),
    capabilities: c.capabilities || {},
    warnings: c.warnings || [],
    slots: c.slots,
    loras: (c.loras || []).map((l) => ({
      key: l.key,
      role: l.role,
      vacant: !!l.vacant,
      default_name: l.default_name,
      note: l.vacant
        ? 'Empty pit: fill to add a LoRA without editing the graph.'
        : 'Occupied: replace name/strength, or enabled=false to bypass. Cannot insert a new node.',
    })),
    models: c.models,
    notes: c.notes,
  }
}

export function listTemplates(templatesDir) {
  return loadContracts(templatesDir).map(summarizeContract)
}

export function inspectTemplate(templatesDir, id) {
  return inspectContract(getContract(templatesDir, id))
}
