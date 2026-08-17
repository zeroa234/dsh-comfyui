/** Pure graph helpers: inject slots, alias class_types, bypass LoRA nodes. */

export const CLASS_ALIASES = {
  AnimaLLLiteApply: 'AnimaLLLiteApply_sdscripts',
}

export const MODEL_FOLDERS = {
  unet: ['unet', 'diffusion_models'],
  clip: ['clip', 'text_encoders'],
  vae: ['vae'],
  loras: ['loras'],
}

export function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph))
}

export function slotTargets(slot) {
  if (!slot) return []
  if (Array.isArray(slot.injects)) return slot.injects
  if (slot.node && slot.field) return [{ node: String(slot.node), field: slot.field }]
  return []
}

export function injectValue(graph, nodeId, field, value) {
  const node = graph[String(nodeId)]
  if (!node) throw Object.assign(new Error(`NODE_MISSING:${nodeId}`), { code: 'NODE_MISSING', node: nodeId })
  if (!node.inputs) node.inputs = {}
  node.inputs[field] = value
}

export function injectSlot(graph, slot, value) {
  const targets = slotTargets(slot)
  if (!targets.length) throw Object.assign(new Error(`SLOT_BAD:${slot.key || '?'}`), { code: 'SLOT_BAD' })
  for (const t of targets) injectValue(graph, t.node, t.field, value)
}

export function snapMultiple(n, step = 8) {
  const x = Number(n)
  if (!Number.isFinite(x)) return n
  return Math.max(step, Math.round(x / step) * step)
}

export async function applyClassAliases(graph, liveHas) {
  const applied = []
  for (const [id, node] of Object.entries(graph)) {
    const from = node.class_type
    const to = CLASS_ALIASES[from]
    if (!to) continue
    const should = liveHas ? await liveHas(from, to, node) : true
    if (!should) continue
    node.class_type = to
    applied.push({ node: id, from, to })
  }
  return applied
}

/**
 * Remove a node and rewire consumers to that node's linked inputs.
 * LoRA: output 0 → inputs.model, output 1 → inputs.clip.
 */
export function bypassNode(graph, nodeId) {
  const id = String(nodeId)
  const node = graph[id]
  if (!node) return false
  const modelSrc = Array.isArray(node.inputs?.model) ? node.inputs.model : null
  const clipSrc = Array.isArray(node.inputs?.clip) ? node.inputs.clip : null
  for (const [otherId, other] of Object.entries(graph)) {
    if (otherId === id || !other.inputs) continue
    for (const [key, val] of Object.entries(other.inputs)) {
      if (!Array.isArray(val) || String(val[0]) !== id) continue
      const slot = val[1]
      if (slot === 0 && modelSrc) other.inputs[key] = modelSrc
      else if (slot === 1 && clipSrc) other.inputs[key] = clipSrc
      else if (slot === 0 && clipSrc && !modelSrc) other.inputs[key] = clipSrc
    }
  }
  delete graph[id]
  return true
}

export function uniqueClassTypes(graph) {
  return [...new Set(Object.values(graph).map((n) => n.class_type).filter(Boolean))]
}

export function outputSaverNodes(graph) {
  return Object.entries(graph)
    .filter(([, n]) => {
      const c = n.class_type || ''
      return c === 'SaveImage' || /VHS_VideoCombine|SaveVideo|CreateVideo|SaveWEBM|SaveAudio/i.test(c)
    })
    .map(([id]) => id)
}

export function saveImageNodes(graph) {
  return outputSaverNodes(graph)
}

export function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000)
}
