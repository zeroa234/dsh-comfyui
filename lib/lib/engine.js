import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  applyClassAliases,
  bypassNode,
  cloneGraph,
  injectSlot,
  injectValue,
  randomSeed,
  outputSaverNodes,
  snapMultiple,
  uniqueClassTypes,
  MODEL_FOLDERS,
} from './graph.js'
import { comfyJson, uploadImage, viewImage } from './http.js'
import { getContract, inspectTemplate, listTemplates, loadWorkflow } from './templates.js'
import { activeLoraNames, loadSettings, triggerPrefix } from './store.js'

const jobs = new Map()
const JOBS_MAX = 100

/** Bounded put: evict the oldest settled job (or oldest overall) past the cap. */
function putJob(id, job) {
  jobs.set(id, job)
  if (jobs.size <= JOBS_MAX) return
  let victim
  for (const [k, v] of jobs) {
    if (v.status !== 'running') { victim = k; break }
  }
  if (victim === undefined) victim = jobs.keys().next().value
  jobs.delete(victim)
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

export async function ping(baseUrl) {
  try {
    const res = await comfyJson(baseUrl, 'GET', '/system_stats', { timeout: 8000 })
    if (!res.ok) return { ok: false, code: 'UNREACHABLE', status: res.status }
    const dev = res.data?.devices?.[0] || {}
    return {
      ok: true,
      version: res.data?.system?.comfyui_version,
      device: dev.name,
      vram_free: dev.vram_free,
      vram_total: dev.vram_total,
    }
  } catch (e) {
    return { ok: false, code: e.code || 'UNREACHABLE', message: e.message }
  }
}

export { inspectTemplate, listTemplates }

/**
 * Live official-node set from the server's python_module tags.
 * Returns null when unreachable — callers fall back to the offline list.
 */
export async function fetchOfficialClasses(baseUrl) {
  try {
    const res = await comfyJson(baseUrl, 'GET', '/object_info', { timeout: 60000 })
    if (!res.ok || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) return null
    const set = new Set()
    for (const [name, node] of Object.entries(res.data)) {
      if (!String(node?.python_module || '').startsWith('custom_nodes')) set.add(name)
    }
    return set.size ? set : null
  } catch {
    return null
  }
}

export async function listLoraFiles(baseUrl) {
  const r = await comfyJson(baseUrl, 'GET', '/models/loras', { timeout: 20000 })
  if (!r.ok || !Array.isArray(r.data)) return []
  return r.data.map(String)
}

export async function searchAssets(baseUrl, query, kinds = ['loras', 'checkpoints', 'diffusion_models', 'text_encoders', 'vae']) {
  const q = String(query || '').toLowerCase()
  const typesRes = await comfyJson(baseUrl, 'GET', '/models', { timeout: 15000 })
  const folders = Array.isArray(typesRes.data) ? typesRes.data : kinds
  const hits = {}
  for (const folder of folders) {
    if (kinds.length && !kinds.includes(folder) && folder !== 'loras') {
      if (!['checkpoints', 'diffusion_models', 'unet', 'clip', 'text_encoders', 'vae', 'loras'].includes(folder)) continue
    }
    try {
      const r = await comfyJson(baseUrl, 'GET', `/models/${encodeURIComponent(folder)}`, { timeout: 15000 })
      const names = Array.isArray(r.data) ? r.data : []
      const matched = q ? names.filter((n) => String(n).toLowerCase().includes(q)) : names.slice(0, 40)
      if (matched.length) hits[folder] = matched.slice(0, 40)
    } catch {
      /* folder may 404 */
    }
  }
  return hits
}

async function objectInfo(baseUrl, classType, cache) {
  if (cache.has(classType)) return cache.get(classType)
  const res = await comfyJson(baseUrl, 'GET', `/object_info/${encodeURIComponent(classType)}`, { timeout: 20000 })
  const info = res.ok ? res.data?.[classType] || res.data : null
  cache.set(classType, info)
  return info
}

function requiredInputNames(info) {
  const req = info?.input?.required || {}
  return Object.keys(req)
}

async function aliasPredicate(baseUrl, cache) {
  return async (from, to, node) => {
    const liveFrom = await objectInfo(baseUrl, from, cache)
    const liveTo = await objectInfo(baseUrl, to, cache)
    if (!liveTo) return false
    if (!liveFrom) return true
    const req = requiredInputNames(liveFrom)
    if (req.includes('model_patch') && node.inputs?.lllite_name != null && !node.inputs?.model_patch) return true
    return false
  }
}

async function preflight(baseUrl, graph, cache) {
  const errors = []
  const customNodes = []
  for (const classType of uniqueClassTypes(graph)) {
    let info
    try {
      info = await objectInfo(baseUrl, classType, cache)
    } catch (e) {
      errors.push({ code: 'NODE_UNREACHABLE', class_type: classType, message: e.message })
      continue
    }
    if (!info) {
      errors.push({
        code: 'NODE_MISSING',
        class_type: classType,
        suggestion: classType === 'AnimaLLLiteApply'
          ? 'Rename to AnimaLLLiteApply_sdscripts (core stole the original id).'
          : 'Custom node not installed, or class_type mismatch.',
      })
      continue
    }
    const mod = String(info.python_module || '')
    if (mod.startsWith('custom_nodes.')) {
      customNodes.push({ class_type: classType, pack: mod.slice('custom_nodes.'.length) })
    }
  }
  for (const [id, node] of Object.entries(graph)) {
    const info = cache.get(node.class_type)
    if (!info) continue
    const required = requiredInputNames(info)
    for (const name of required) {
      if (node.inputs?.[name] === undefined || node.inputs?.[name] === null || node.inputs?.[name] === '') {
        if (['image', 'string', 'value'].includes(name) && node.inputs?.[name] === '') {
          errors.push({ code: 'REQUIRED_EMPTY', node: id, class_type: node.class_type, input: name })
        } else if (node.inputs?.[name] === undefined) {
          errors.push({
            code: 'NODE_SCHEMA_MISMATCH',
            node: id,
            class_type: node.class_type,
            missing_input: name,
          })
        }
      }
    }
  }
  return { errors, customNodes }
}

async function fileExistsInFolders(baseUrl, name, folders) {
  for (const folder of folders) {
    try {
      const r = await comfyJson(baseUrl, 'GET', `/models/${encodeURIComponent(folder)}`, { timeout: 15000 })
      const names = Array.isArray(r.data) ? r.data : []
      if (names.includes(name)) return folder
    } catch { /* skip */ }
  }
  return null
}

async function checkModels(baseUrl, graph) {
  const errors = []
  const checks = [
    ['UNETLoader', 'unet_name', MODEL_FOLDERS.unet],
    ['CLIPLoader', 'clip_name', MODEL_FOLDERS.clip],
    ['VAELoader', 'vae_name', MODEL_FOLDERS.vae],
    ['LoraLoader', 'lora_name', MODEL_FOLDERS.loras],
    ['LoraLoaderModelOnly', 'lora_name', MODEL_FOLDERS.loras],
  ]
  for (const [id, node] of Object.entries(graph)) {
    for (const [cls, field, folders] of checks) {
      if (node.class_type !== cls) continue
      const name = node.inputs?.[field]
      if (!name || typeof name !== 'string') continue
      const found = await fileExistsInFolders(baseUrl, name, folders)
      if (!found) {
        errors.push({ code: 'MODEL_MISSING', node: id, field, name, folders })
      }
    }
  }
  return errors
}

async function ingestMedia(baseUrl, graph, slot, filePath) {
  if (!filePath) {
    throw Object.assign(new Error('MEDIA_MISSING'), { code: 'MEDIA_MISSING' })
  }
  if (!fs.existsSync(filePath)) {
    throw Object.assign(new Error(`MEDIA_MISSING:${filePath}`), { code: 'MEDIA_MISSING', path: filePath })
  }
  const buf = fs.readFileSync(filePath)
  const nodeId = slotTargetsSafe(slot)[0]?.node
  const node = nodeId ? graph[String(nodeId)] : null
  const cls = node?.class_type || ''
  if (cls === 'ETN_LoadImageBase64' || cls.toLowerCase().includes('base64')) {
    injectSlot(graph, slot, buf.toString('base64'))
    return { mode: 'base64', bytes: buf.length, slot: slot.key }
  }
  const uploaded = await uploadImage(baseUrl, filePath, buf, path.basename(filePath))
  const name = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name
  injectSlot(graph, slot, name)
  return { mode: 'upload', name, bytes: buf.length, slot: slot.key }
}

async function ingestImage(baseUrl, graph, slot, imagePath) {
  return ingestMedia(baseUrl, graph, slot, imagePath)
}

function slotTargetsSafe(slot) {
  if (slot?.injects) return slot.injects
  if (slot?.node) return [{ node: String(slot.node), field: slot.field }]
  return []
}

function applyLoraPatch(graph, spec, patch) {
  if (patch.name) injectValue(graph, spec.node, spec.nameField || 'lora_name', patch.name)
  if (patch.strength != null) {
    if (spec.strengthNode) injectValue(graph, spec.strengthNode, spec.strengthField || 'string', String(patch.strength))
    else if (spec.strengthField) injectValue(graph, spec.node, spec.strengthField, Number(patch.strength))
    if (spec.clipStrengthField && graph[spec.node]?.inputs?.[spec.clipStrengthField] != null && !Array.isArray(graph[spec.node].inputs[spec.clipStrengthField])) {
      injectValue(graph, spec.node, spec.clipStrengthField, Number(patch.strength))
    }
  }
  if (patch.enabled === false) bypassNode(graph, spec.node)
}

export async function generate(opts) {
  const { baseUrl, templatesDir, outputDir, args } = opts
  const templateId = args.template
  if (!templateId) return fail('SLOT_REQUIRED', 'template is required')

  const contract = getContract(templatesDir, templateId)
  const graph = cloneGraph(loadWorkflow(contract))
  const cache = new Map()
  const liveHas = await aliasPredicate(baseUrl, cache)
  const applied_aliases = await applyClassAliases(graph, liveHas)

  const slots = contract.slots || {}
  const unknown = []
  const skipArg = new Set(['template', 'wait_s', 'loras', 'unet', 'clip', 'vae', 'vae_audio', 'clip_type', 'slots'])
  const extra = args.slots && typeof args.slots === 'object' && !Array.isArray(args.slots) ? args.slots : {}
  const provided = {}
  for (const src of [extra, args]) {
    for (const [k, v] of Object.entries(src || {})) {
      if (skipArg.has(k) || v == null || v === '') continue
      provided[k] = v
    }
  }
  if (provided.width != null) provided.width = snapMultiple(provided.width)
  if (provided.height != null) provided.height = snapMultiple(provided.height)

  let seed = provided.seed
  if (slots.seed) {
    if (seed == null || Number(seed) < 0) seed = randomSeed()
    provided.seed = seed
  } else {
    delete provided.seed
    seed = undefined
  }

  for (const key of Object.keys(provided)) {
    if (provided[key] == null || provided[key] === '') continue
    if (['wait_s', 'template', 'loras', 'unet', 'clip', 'vae', 'vae_audio', 'clip_type', 'slots'].includes(key)) continue
    if (!slots[key]) unknown.push(key)
  }
  if (unknown.length) {
    return fail('SLOT_UNKNOWN', `Unknown slots: ${unknown.join(', ')}`, {
      unknown,
      allowed: Object.keys(slots),
      hint: 'Only declared contract slots can be set. Adding LoRA nodes requires a vacant lora slot or editing in ComfyUI.',
    })
  }

  for (const slot of Object.values(slots)) {
    if (slot.required && (provided[slot.key] == null || provided[slot.key] === '')) {
      return fail('SLOT_REQUIRED', `Missing required slot: ${slot.key}`, { slot: slot.key })
    }
  }

  const MEDIA = new Set(['image', 'video', 'audio'])
  let imageMeta = null
  const mediaMeta = []
  for (const slot of Object.values(slots)) {
    if (!MEDIA.has(slot.type) || provided[slot.key] == null || provided[slot.key] === '') continue
    try {
      const meta = await ingestMedia(baseUrl, graph, slot, provided[slot.key])
      mediaMeta.push(meta)
      if (slot.type === 'image' && !imageMeta) imageMeta = meta
    } catch (e) {
      return fail(e.code || 'MEDIA_MISSING', e.message, { path: provided[slot.key], slot: slot.key })
    }
  }

  for (const [key, value] of Object.entries(provided)) {
    const slot = slots[key]
    if (!slot || MEDIA.has(slot.type) || key === 'prompt') continue
    const v = slot.type === 'number' || slot.type === 'seed' ? (slot.as_string ? String(value) : value) : value
    injectSlot(graph, slot, slot.as_string ? String(v) : v)
  }

  if (args.unet && contract.models?.unet) injectSlot(graph, contract.models.unet, args.unet)
  if (args.clip && contract.models?.clip) injectSlot(graph, contract.models.clip, args.clip)
  if (args.vae && contract.models?.vae) injectSlot(graph, contract.models.vae, args.vae)
  if (args.vae_audio && contract.models?.vae_audio) injectSlot(graph, contract.models.vae_audio, args.vae_audio)
  if (args.clip_type && contract.models?.clip_type) injectSlot(graph, contract.models.clip_type, args.clip_type)

  const loraSpecs = contract.loras || []
  const loraPatches = Array.isArray(args.loras) ? args.loras : []
  for (const patch of loraPatches) {
    const spec = loraSpecs.find((l) => l.key === patch.key)
    if (!spec) {
      return fail('SLOT_UNKNOWN', `No LoRA slot "${patch.key}"`, {
        available: loraSpecs.map((l) => l.key),
        hint: 'Cannot insert a new LoraLoader. Fill a vacant slot, replace an occupied one, or add a node in ComfyUI then re-sync.',
      })
    }
    applyLoraPatch(graph, spec, patch)
  }

  let trigger_words = ''
  if (slots.prompt && provided.prompt != null) {
    const settings = loadSettings(templatesDir)
    trigger_words = triggerPrefix(settings, activeLoraNames(graph))
    const text = trigger_words ? `${trigger_words}, ${provided.prompt}` : provided.prompt
    injectSlot(graph, slots.prompt, text)
  }

  const { errors: schemaErrors, customNodes } = await preflight(baseUrl, graph, cache)
  const hard = schemaErrors.filter((e) => e.code !== 'REQUIRED_EMPTY' || e.input !== 'image' || !imageMeta)
  if (hard.length) return fail('PROMPT_REJECTED', 'Preflight failed', { errors: hard, applied_aliases, custom_nodes: customNodes })

  const modelErrors = await checkModels(baseUrl, graph)
  if (modelErrors.length) {
    let assets = {}
    try { assets = await searchAssets(baseUrl, '', ['loras', 'diffusion_models', 'text_encoders', 'vae']) }
    catch { /* ignore */ }
    return fail('MODEL_MISSING', 'One or more model files are not on the ComfyUI server', {
      errors: modelErrors,
      available_sample: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, v.slice(0, 15)])),
    })
  }

  const clientId = randomUUID()
  const posted = await comfyJson(baseUrl, 'POST', '/prompt', {
    body: { prompt: graph, client_id: clientId },
    timeout: 60000,
  })
  if (!posted.ok) {
    return fail('PROMPT_REJECTED', `HTTP ${posted.status}`, { data: posted.data })
  }
  const nodeErrors = posted.data?.node_errors
  if (nodeErrors && Object.keys(nodeErrors).length) {
    return fail('PROMPT_REJECTED', 'ComfyUI rejected the prompt', { node_errors: nodeErrors, applied_aliases })
  }
  const promptId = posted.data?.prompt_id
  if (!promptId) return fail('PROMPT_REJECTED', 'No prompt_id', { data: posted.data })

  const job = {
    id: promptId,
    template: templateId,
    status: 'running',
    seed,
    applied_aliases,
    trigger_words,
    image: imageMeta,
    media: mediaMeta,
    saveIds: outputSaverNodes(graph),
    custom_nodes: customNodes,
    created_at: Date.now(),
    outputs: [],
  }
  putJob(promptId, job)

  const waitS = args.wait_s == null ? 180 : Number(args.wait_s)
  if (waitS <= 0) return { ok: true, job_id: promptId, status: 'running', seed, applied_aliases, trigger_words, custom_nodes: customNodes }

  const done = await waitForJob({ baseUrl, outputDir, promptId, saveIds: job.saveIds, waitS })
  return done
}

export function getJob(id) {
  return jobs.get(id) || null
}

export async function cancelJob(baseUrl) {
  await comfyJson(baseUrl, 'POST', '/interrupt', { body: {}, timeout: 15000 })
  return { ok: true, interrupted: true }
}

export async function waitForJob({ baseUrl, outputDir, promptId, saveIds, waitS }) {
  const deadline = Date.now() + waitS * 1000
  while (Date.now() < deadline) {
    const hist = await comfyJson(baseUrl, 'GET', `/history/${encodeURIComponent(promptId)}`, { timeout: 20000 })
    const entry = hist.data?.[promptId]
    if (entry) {
      const statusStr = entry.status?.status_str
      const messages = entry.status?.messages || []
      const failed = statusStr === 'error' || messages.some((m) => String(m?.[0] || '').includes('error'))
      if (failed) {
        const job = jobs.get(promptId) || { id: promptId }
        job.status = 'error'
        job.error = entry.status
        putJob(promptId, job)
        return fail('EXECUTION_FAILED', 'ComfyUI execution failed', { job_id: promptId, status: entry.status })
      }
      const ids = new Set(saveIds || jobs.get(promptId)?.saveIds || [])
      const saved = await collectOutputs(baseUrl, outputDir, promptId, entry, ids)
      const job = jobs.get(promptId) || { id: promptId }
      job.status = 'success'
      job.outputs = saved
      putJob(promptId, job)
      if (!saved.length) {
        return fail('NO_OUTPUT', 'No output files (previews ignored)', { job_id: promptId })
      }
      return { ok: true, job_id: promptId, status: 'success', seed: job.seed, applied_aliases: job.applied_aliases, trigger_words: job.trigger_words, custom_nodes: job.custom_nodes || [], outputs: saved }
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return { ok: true, job_id: promptId, status: 'running', message: 'Still running; call comfyui_job' }
}

async function collectOutputs(baseUrl, outputDir, promptId, entry, saveIds) {
  const dir = path.join(outputDir, promptId)
  fs.mkdirSync(dir, { recursive: true })
  const saved = []
  const outputs = entry.outputs || {}
  const bags = [
    ['images', 'image'],
    ['gifs', 'video'],
    ['videos', 'video'],
    ['audio', 'audio'],
  ]
  for (const [nodeId, nodeOut] of Object.entries(outputs)) {
    if (saveIds.size && !saveIds.has(String(nodeId))) continue
    for (const [bag, kind] of bags) {
      for (const item of nodeOut[bag] || []) {
        if (item.type && item.type !== 'output') continue
        const buf = await viewImage(baseUrl, item)
        const dest = path.join(dir, `${nodeId}_${item.filename}`)
        fs.writeFileSync(dest, buf)
        saved.push({ node: nodeId, path: dest, filename: item.filename, kind, bytes: buf.length })
      }
    }
  }
  return saved
}

export { jobs }
