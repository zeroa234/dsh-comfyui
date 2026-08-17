/**
 * Regenerate lib/lib/official-nodes.json from a live ComfyUI server.
 *
 * Usage: node scripts/update-official-nodes.mjs [baseUrl]
 *
 * Classification rule (no hand-maintained list):
 *   python_module NOT starting with "custom_nodes." => official
 *   (covers core "nodes", "comfy_extras.*", "comfy_api_nodes.*")
 *
 * The generated file is only the OFFLINE fallback for import-time scanning.
 * At generate time the plugin re-classifies live via /object_info, so new
 * official nodes added by ComfyUI updates are picked up automatically.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const baseUrl = (process.argv[2] || 'http://192.168.0.103:8188').replace(/\/$/, '')

const stats = await (await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(10000) })).json()
const version = stats?.system?.comfyui_version || 'unknown'

const info = await (await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(120000) })).json()

const official = []
let customCount = 0
for (const [name, node] of Object.entries(info)) {
  const mod = String(node?.python_module || '')
  if (mod.startsWith('custom_nodes')) customCount += 1
  else official.push(name)
}
official.sort((a, b) => a.localeCompare(b))

const out = {
  source: `${baseUrl} (ComfyUI ${version})`,
  generated_at: new Date().toISOString(),
  rule: 'python_module not starting with "custom_nodes." counts as official',
  official,
}

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'lib', 'official-nodes.json')
fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, `${JSON.stringify(out, null, 1)}\n`, 'utf8')
console.log(`official: ${official.length} | custom on server: ${customCount} -> ${dest}`)
