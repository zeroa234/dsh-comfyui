/**
 * @dsh-external/dsh-comfyui — ComfyUI driver for DeepSeek Harness.
 * AI-first: list → inspect → generate → job. Workflow JSON never enters model context.
 */
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  cancelJob,
  fetchOfficialClasses,
  getJob,
  generate,
  inspectTemplate,
  listLoraFiles,
  ping,
  searchAssets,
  waitForJob,
} from './lib/engine.js'
import { annotateInspect, annotateTemplates, loraCatalog, loadSettings, removeLora, saveSettings, upsertLora } from './lib/store.js'
import { scanPath, saveTemplate, removeTemplate } from './lib/import-template.js'

export const name = '@dsh-external/dsh-comfyui'
export const inject = ['tools']
export const Config = z.object({
  baseUrl: z.string().default('http://127.0.0.1:8188'),
  templatesDir: z.string().default(''),
  outputDir: z.string().default('E:\\agent\\output\\comfyui'),
})

const TOOL = {
  list: '_dsh_external_dsh_comfyui_list',
  inspect: '_dsh_external_dsh_comfyui_inspect',
  generate: '_dsh_external_dsh_comfyui_generate',
  job: '_dsh_external_dsh_comfyui_job',
  import: '_dsh_external_dsh_comfyui_import',
  lora: '_dsh_external_dsh_comfyui_lora',
}

const textOut = {
  schema: { type: 'string' },
  render: (_a, v) => [{ type: 'text', text: String(v) }],
}

const PLUGIN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveCfg(config) {
  const templatesDir = config.templatesDir || path.join(PLUGIN_ROOT, 'templates')
  const saved = loadSettings(templatesDir)
  const fromFile = String(saved.baseUrl || '').trim()
  return {
    baseUrl: (fromFile || config.baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, ''),
    templatesDir,
    outputDir: config.outputDir || path.join(PLUGIN_ROOT, 'output'),
  }
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

function attachSettingsApi(ctx, config) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/comfyui/api',
    handler: async (req, res) => {
      try {
        const cfg = resolveCfg(config)
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sub = url.pathname.replace(/^\/comfyui\/api/, '') || '/'
        if (req.method === 'GET' && (sub === '/' || sub === '/state')) {
          const settings = loadSettings(cfg.templatesDir)
          return sendJson(res, 200, await settingsView(cfg, settings))
        }
        if (req.method === 'POST' && (sub === '/' || sub === '/save')) {
          const body = JSON.parse(await readBody(req) || '{}')
          const saved = saveSettings(cfg.templatesDir, body)
          const next = resolveCfg(config)
          return sendJson(res, 200, await settingsView(next, saved))
        }
        if (req.method === 'POST' && sub === '/scan') {
          const body = JSON.parse(await readBody(req) || '{}')
          const official = await fetchOfficialClasses(cfg.baseUrl)
          const scanned = scanPath(body.path, { id: body.id, title: body.title, officialClasses: official })
          return sendJson(res, 200, { ok: true, ...scanned, contract: scanned.summary, warnings: scanned.contract.warnings, draft: scanned.summary })
        }
        if (req.method === 'POST' && sub === '/import') {
          const body = JSON.parse(await readBody(req) || '{}')
          const official = await fetchOfficialClasses(cfg.baseUrl)
          const saved = saveTemplate(cfg.templatesDir, body.path, {
            id: body.id,
            title: body.title,
            overwrite: !!body.overwrite,
            officialClasses: official,
          })
          const settings = loadSettings(cfg.templatesDir)
          const view = await settingsView(cfg, settings)
          return sendJson(res, 200, { ...view, ...saved })
        }
        if (req.method === 'POST' && (sub === '/delete-template' || sub === '/template/delete')) {
          const body = JSON.parse(await readBody(req) || '{}')
          const removed = removeTemplate(cfg.templatesDir, body.id)
          const settings = loadSettings(cfg.templatesDir)
          const view = await settingsView(cfg, settings)
          return sendJson(res, 200, { ...view, ...removed })
        }
        return sendJson(res, 404, { ok: false, error: `Unknown route: ${req.method} /comfyui/api${sub}` })
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: e.message })
      }
    },
  }), '@dsh-external/dsh-comfyui: settings api')
}

function registerSettingsApi(ctx, config) {
  // tools stay available even if webServer is late; settings page waits for it.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => attachSettingsApi(scope, config))
    return
  }
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (!webServer || typeof webServer.register !== 'function') return
  attachSettingsApi(ctx, config)
}

function dump(value) {
  return JSON.stringify(value, null, 2)
}

async function settingsView(cfg, settings) {
  const status = await ping(cfg.baseUrl)
  let availableLoras = []
  if (status.ok) {
    try { availableLoras = await listLoraFiles(cfg.baseUrl) }
    catch { /* ignore */ }
  }
  const onServer = new Set(availableLoras)
  return {
    ok: true,
    baseUrl: cfg.baseUrl,
    ping: status,
    templates: annotateTemplates(cfg.templatesDir, settings),
    loras: loraCatalog(cfg.templatesDir, settings).map((l) => ({ ...l, on_server: onServer.has(l.name) })),
    availableLoras,
  }
}

export function apply(ctx, config) {
  registerSettingsApi(ctx, config)

  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL.list,
    description: 'ComfyUI 连通状态 + 模板清单。先看 media/mode/can/cannot 和 user_note（用户写给模型的用法）。t2v 不能当静帧。',
    parameters: {},
    output: textOut,
    async execute() {
      const runtime = resolveCfg(config)
      const status = await ping(runtime.baseUrl)
      const settings = loadSettings(runtime.templatesDir)
      const templates = annotateTemplates(runtime.templatesDir, settings)
      return dump({
        comfyui: { baseUrl: runtime.baseUrl, ...status },
        templates,
        usage: 'Match media+mode and user_note first. Then inspect(template_id). LoRA usage notes: lora(action=list).',
      })
    },
  })), '@dsh-external/dsh-comfyui: list')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL.inspect,
    description: '单个模板的槽、LoRA 坑、media、prompt_style，以及用户写的 user_note（提示词风格/底模/特殊用法）。query 搜模型文件名。',
    parameters: {
      template: { type: 'string', required: true, description: '模板 id，如 anima-txt2img / anima-i2i' },
      query: { type: 'string', description: '可选，搜模型文件名（miku、real、美化）' },
    },
    output: textOut,
    async execute(args) {
      try {
        const runtime = resolveCfg(config)
        const info = annotateInspect(inspectTemplate(runtime.templatesDir, args.template), loadSettings(runtime.templatesDir))
        let assets = undefined
        if (args.query) {
          const status = await ping(runtime.baseUrl)
          if (status.ok) assets = await searchAssets(runtime.baseUrl, args.query)
          else assets = { error: status }
        }
        return dump({ ...info, assets })
      } catch (e) {
        return dump({ ok: false, code: e.code || 'ERROR', message: e.message })
      }
    },
  })), '@dsh-external/dsh-comfyui: inspect')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL.generate,
    description: '按合同提交。先 inspect，遵守 user_note 和 prompt_style（自然语言 vs tag）。只填列出的槽。图片/视频/音频只传本地路径。不能新增 LoRA 节点。wait_s 默认 180。',
    parameters: {
      template: { type: 'string', required: true, description: '模板 id（list 里的 id，不限于 anima）' },
      prompt: { type: 'string', description: '正向提示词' },
      negative: { type: 'string', description: '负向提示词' },
      image: { type: 'string', description: '输入图本地绝对路径' },
      video: { type: 'string', description: '输入视频本地绝对路径' },
      audio: { type: 'string', description: '输入音频本地绝对路径' },
      width: { type: 'number', description: '宽，自动对齐 8。无放大节点则这是直接出图尺寸' },
      height: { type: 'number', description: '高，自动对齐 8' },
      duration: { type: 'number', description: '视频时长（秒），仅当合同有 duration 槽' },
      fps: { type: 'number', description: '帧率，仅当合同有 fps 槽' },
      aspect_ratio: { type: 'string', description: '如 9:16，仅当合同有此槽' },
      megapixels: { type: 'number', description: '视频像素量（百万像素）' },
      pixel_k: { type: 'number', description: '图生图像素量（千像素）' },
      turbo_strength: { type: 'number', description: 'turbo LoRA 强度' },
      seed: { type: 'number', description: '种子；有 seed 槽时，负数或省略则随机' },
      steps: { type: 'number', description: '采样步数' },
      cfg: { type: 'number', description: 'CFG' },
      denoise: { type: 'number', description: 'denoise' },
      unet: { type: 'string', description: '替换 UNET 文件名' },
      clip: { type: 'string', description: '替换 CLIP 文件名' },
      vae: { type: 'string', description: '替换 VAE 文件名' },
      vae_audio: { type: 'string', description: '替换音频 VAE 文件名' },
      clip_type: { type: 'string', description: 'CLIP type，如 qwen_image / stable_diffusion / minimax' },
      wait_s: { type: 'number', description: '等待秒数，0=立即返回 job_id，默认 180' },
      slots: {
        type: 'object',
        additionalProperties: true,
        description: 'inspect 列出的其它槽，key→value。与顶层字段合并，顶层优先。',
      },
      loras: {
        type: 'array',
        description: '补丁已有 LoRA 槽，如 [{key:"quality", name:"xxx.safetensors", strength:1, enabled:true}]',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            key: { type: 'string', required: true, description: 'quality | speed' },
            name: { type: 'string', description: 'loras 目录文件名' },
            strength: { type: 'number' },
            enabled: { type: 'boolean', description: 'false 则 bypass，不占显存' },
          },
        },
      },
    },
    output: textOut,
    async execute(args) {
      try {
        const runtime = resolveCfg(config)
        const result = await generate({ ...runtime, args: args || {} })
        return dump(result)
      } catch (e) {
        return dump({ ok: false, code: e.code || 'ERROR', message: e.message })
      }
    },
  })), '@dsh-external/dsh-comfyui: generate')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL.job,
    description: '查询或取消 ComfyUI 任务。action=status|wait|cancel。cancel 中断服务器当前正在运行的任务（ComfyUI 单队列，忽略 job_id）。成品只返回磁盘路径。',
    parameters: {
      job_id: { type: 'string', description: 'prompt_id' },
      action: { type: 'string', description: 'status（默认）| wait | cancel' },
      wait_s: { type: 'number', description: 'action=wait 时最多等几秒，默认 120' },
    },
    output: textOut,
    async execute(args) {
      const action = args.action || 'status'
      try {
        if (action === 'cancel') {
          const runtime = resolveCfg(config)
          return dump(await cancelJob(runtime.baseUrl))
        }
        const id = args.job_id
        if (!id) return dump({ ok: false, code: 'SLOT_REQUIRED', message: 'job_id required' })
        if (action === 'wait') {
          const runtime = resolveCfg(config)
          return dump(await waitForJob({
            baseUrl: runtime.baseUrl,
            outputDir: runtime.outputDir,
            promptId: id,
            saveIds: getJob(id)?.saveIds,
            waitS: args.wait_s == null ? 120 : Number(args.wait_s),
          }))
        }
        const job = getJob(id)
        if (!job) return dump({ ok: false, code: 'JOB_UNKNOWN', job_id: id, hint: 'Unknown in this process; try wait to hit ComfyUI history.' })
        return dump({ ok: true, job })
      } catch (e) {
        return dump({ ok: false, code: e.code || 'ERROR', message: e.message })
      }
    },
  })), '@dsh-external/dsh-comfyui: job')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL.import,
    description: '扫描、导入或删除模板。默认只扫描不落盘。commit=true 写入 templates/；remove=true 删除合同和包内工作流 JSON。绝不返回工作流 JSON。',
    parameters: {
      path: { type: 'string', description: '本地 .json 绝对路径（API Format）。删除时不需要' },
      commit: { type: 'boolean', description: 'true=写入模板；默认 false 只预览合同' },
      remove: { type: 'boolean', description: 'true=删除已有模板，须带 id' },
      id: { type: 'string', description: '模板 id。导入时默认从文件名/图推断；删除时必填' },
      title: { type: 'string', description: '显示名' },
      overwrite: { type: 'boolean', description: '覆盖已有同 id' },
    },
    output: textOut,
    async execute(args) {
      try {
        const runtime = resolveCfg(config)
        if (args.remove) {
          if (!args.id) return dump({ ok: false, code: 'SLOT_REQUIRED', message: 'id required to remove a template' })
          const removed = removeTemplate(runtime.templatesDir, args.id)
          return dump({
            ok: true,
            removed: true,
            ...removed,
            hint: 'list() will no longer show this id. Bundled anima templates may return after a plugin update.',
          })
        }
        const official = await fetchOfficialClasses(runtime.baseUrl)
        if (!args.path) return dump({ ok: false, code: 'SLOT_REQUIRED', message: 'path required' })
        if (!args.commit) {
          const scanned = scanPath(args.path, { id: args.id, title: args.title, officialClasses: official })
          return dump({
            ok: true,
            committed: false,
            ...scanned.summary,
            hint: 'If mode/media look right, call again with commit=true. If UI_FORMAT, re-export Save (API Format).',
          })
        }
        const saved = saveTemplate(runtime.templatesDir, args.path, {
          id: args.id,
          title: args.title,
          overwrite: !!args.overwrite,
          officialClasses: official,
        })
        return dump({
          ok: true,
          committed: true,
          id: saved.id,
          ...saved.summary,
          warnings: saved.warnings,
          hint: 'Next list() should include this id. Do not generate if cannot() mismatches, or if this machine lacks nodes/VRAM.',
        })
      } catch (e) {
        return dump({ ok: false, code: e.code || 'ERROR', message: e.message })
      }
    },
  })), '@dsh-external/dsh-comfyui: import')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: TOOL.lora,
    description: 'ComfyUI LoRA 文件名、触发词、用户注释。list 按 query 搜服务器；register 写入触发词和 note；remove 删除误加条目。不能插入新 LoraLoader。',
    parameters: {
      action: { type: 'string', required: true, description: 'list | register | remove' },
      query: { type: 'string', description: 'list 时按文件名过滤（miku、real、美化）。不填只返回注册表 + 服务器前 20 个' },
      name: { type: 'string', description: 'register/remove 的 lora 文件名，须与 ComfyUI loras 目录一致' },
      trigger_words: { type: 'string', description: 'register 触发词，拼到正向提示词前' },
      mode: { type: 'string', description: 'both（写词+模型，默认）| model-only（只加载不写词，如 turbo）' },
      note: { type: 'string', description: '给模型看的用法注释，如权重建议、只用于写实、不要写进提示词' },
    },
    output: textOut,
    async execute(args) {
      try {
        const runtime = resolveCfg(config)
        const action = args.action || 'list'
        if (action === 'list') {
          const settings = loadSettings(runtime.templatesDir)
          const registry = loraCatalog(runtime.templatesDir, settings)
          const status = await ping(runtime.baseUrl)
          if (!status.ok) {
            return dump({ ok: true, registry, server: { error: status }, hint: 'ComfyUI unreachable; registry is local trigger words only.' })
          }
          const all = await listLoraFiles(runtime.baseUrl)
          const q = String(args.query || '').toLowerCase()
          const server_matches = (q ? all.filter((n) => n.toLowerCase().includes(q)) : all).slice(0, 40)
          return dump({
            ok: true,
            registry,
            server_total: all.length,
            server_matches,
            hint: 'register({name, trigger_words}) saves the same table as Settings → ComfyUI. generate.loras only switches existing pits.',
          })
        }
        if (action === 'register') {
          if (!args.name) return dump({ ok: false, code: 'SLOT_REQUIRED', message: 'name required' })
          const settings = upsertLora(runtime.templatesDir, args.name, {
            triggerWords: args.trigger_words,
            mode: args.mode,
            note: args.note,
          })
          return dump({
            ok: true,
            registered: args.name,
            meta: settings.loras[args.name],
            catalog: loraCatalog(runtime.templatesDir, settings),
          })
        }
        if (action === 'remove') {
          if (!args.name) return dump({ ok: false, code: 'SLOT_REQUIRED', message: 'name required' })
          const result = removeLora(runtime.templatesDir, args.name)
          const catalog = loraCatalog(runtime.templatesDir, result.settings)
          const still = catalog.find((l) => l.name === result.name)
          return dump({
            ok: true,
            removed: result.removed,
            name: result.name,
            still_in_catalog: still ? 'A template lists this as default_name; the row remains with empty words.' : false,
            catalog,
          })
        }
        return dump({ ok: false, code: 'SLOT_UNKNOWN', message: 'action must be list | register | remove' })
      } catch (e) {
        return dump({ ok: false, code: e.code || 'ERROR', message: e.message })
      }
    },
  })), '@dsh-external/dsh-comfyui: lora')
}
