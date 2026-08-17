window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-comfyui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const inject = ['slots']
    const API = '/comfyui/api'

    const styles = `
.cfy-page{font-family:ui-sans-serif,system-ui,sans-serif;font-size:13px;line-height:1.5;padding:14px 16px;max-width:760px}
.cfy-page h3{margin:0 0 6px;font-size:15px}
.cfy-intro{opacity:.75;margin:0 0 14px;font-size:12px}
.cfy-card{border:1px solid var(--theme-border,#80808040);border-radius:8px;padding:12px;margin-bottom:12px}
.cfy-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cfy-field{display:flex;flex-direction:column;gap:4px;margin:8px 0;font-size:12px}
.cfy-field input,.cfy-field textarea,.cfy-field select{font:inherit;color:inherit;background:var(--theme-input-bg,#80808014);border:1px solid var(--theme-border,#80808059);border-radius:6px;padding:6px 8px}
.cfy-field textarea{min-height:56px;resize:vertical}
.cfy-btn{font:inherit;cursor:pointer;background:var(--theme-accent,#4a9eff);color:#fff;border:none;border-radius:6px;padding:6px 12px}
.cfy-btn.ghost{background:transparent;border:1px solid var(--theme-border,#444);color:inherit}
.cfy-st{font-size:12px;opacity:.85}
.cfy-st.on{color:#2ecc71}
.cfy-st.off{color:#e67e22}
.cfy-err{color:#d04848;font-size:12px;margin:8px 0}
.cfy-name{font-weight:600;font-size:12px;word-break:break-all}
.cfy-used{opacity:.6;font-size:11px}
.cfy-pre{font:11px/1.45 ui-monospace,monospace;white-space:pre-wrap;background:var(--theme-input-bg,#80808014);border-radius:6px;padding:8px;margin:8px 0;max-height:240px;overflow:auto}
.cfy-tpl{font-size:12px;margin:4px 0}
.cfy-tpl-block{border-top:1px dashed #80808040;padding-top:10px;margin-top:10px}
.cfy-tpl-block:first-of-type{border-top:none;padding-top:0;margin-top:0}
.cfy-lora{border-top:1px dashed #80808040;padding-top:10px;margin-top:10px}
.cfy-btn.danger{background:transparent;border:1px solid #d33;color:#d33}
.cfy-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.cfy-pick{flex:1;min-width:160px;font:inherit;color:inherit;background:var(--theme-input-bg,#80808014);border:1px solid var(--theme-border,#80808059);border-radius:6px;padding:6px 8px}
`

    function fetchJson(path, init) {
      return fetch(API + path, {
        headers: { 'content-type': 'application/json' },
        ...init,
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status))
        return d
      })
    }

    function ComfySettings() {
      const [state, setState] = React.useState(null)
      const [baseUrl, setBaseUrl] = React.useState('')
      const [loras, setLoras] = React.useState([])
      const [loraFilter, setLoraFilter] = React.useState('')
      const [loraPick, setLoraPick] = React.useState('')
      const [tplNotes, setTplNotes] = React.useState({})
      const [importPath, setImportPath] = React.useState('')
      const [importId, setImportId] = React.useState('')
      const [importTitle, setImportTitle] = React.useState('')
      const [draft, setDraft] = React.useState(null)
      const [msg, setMsg] = React.useState('')
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const applyState = (d) => {
        setState(d)
        setBaseUrl(d.baseUrl || '')
        setLoras((d.loras || []).map((l) => ({ ...l })))
        const notes = {}
        for (const t of d.templates || []) notes[t.id] = t.user_note || ''
        setTplNotes(notes)
      }

      const refresh = React.useCallback(() => {
        fetchJson('/state')
          .then((d) => {
            applyState(d)
            setErr('')
          })
          .catch((e) => setErr(String(e.message || e)))
      }, [])

      React.useEffect(() => { refresh() }, [refresh])

      const save = () => {
        setBusy(true)
        const payload = {
          baseUrl,
          loras: Object.fromEntries(loras.map((l) => [l.name, { triggerWords: l.triggerWords, mode: l.mode, note: l.note || '' }])),
          templates: Object.fromEntries(Object.entries(tplNotes).map(([id, note]) => [id, { note }])),
        }
        fetchJson('/save', { method: 'POST', body: JSON.stringify(payload) })
          .then((d) => {
            applyState(d)
            setMsg('已保存。模板/LoRA 注释会在 list 和 inspect 里给模型看。')
            setErr('')
          })
          .catch((e) => setErr(String(e.message || e)))
          .finally(() => setBusy(false))
      }

      const scanWf = () => {
        setBusy(true)
        fetchJson('/scan', { method: 'POST', body: JSON.stringify({ path: importPath, id: importId || undefined, title: importTitle || undefined }) })
          .then((d) => {
            setDraft(d.draft || d.summary)
            setImportId((d.draft || d.summary)?.id || importId)
            setImportTitle((d.draft || d.summary)?.title || importTitle)
            setErr('')
            setMsg('已扫描。确认 mode/media 无误后再点导入。不会在这台机器上跑图。')
          })
          .catch((e) => setErr(String(e.message || e)))
          .finally(() => setBusy(false))
      }

      const importWf = () => {
        setBusy(true)
        fetchJson('/import', { method: 'POST', body: JSON.stringify({ path: importPath, id: importId || undefined, title: importTitle || undefined }) })
          .then((d) => {
            applyState(d)
            setDraft(d.summary || null)
            setMsg('已导入模板 ' + (d.id || '') + '。对话里 list 能看到；跑不起来会 NODE_MISSING，不会假出一张图。')
            setErr('')
          })
          .catch((e) => setErr(String(e.message || e)))
          .finally(() => setBusy(false))
      }
      const deleteTpl = (id) => {
        setBusy(true)
        fetchJson('/delete-template', { method: 'POST', body: JSON.stringify({ id }) })
          .then((d) => {
            applyState(d)
            setMsg('已删除模板 ' + id + '。对话里 list 不会再看到它。')
            setErr('')
          })
          .catch((e) => setErr(String(e.message || e)))
          .finally(() => setBusy(false))
      }
      const pingOk = state?.ping?.ok
      const persistLoras = (next, note) => {
        setLoras(next)
        setBusy(true)
        fetchJson('/save', {
          method: 'POST',
          body: JSON.stringify({
            baseUrl,
            loras: Object.fromEntries(next.map((l) => [l.name, { triggerWords: l.triggerWords, mode: l.mode, note: l.note || '' }])),
            templates: Object.fromEntries(Object.entries(tplNotes).map(([id, n]) => [id, { note: n }])),
          }),
        })
          .then((d) => {
            applyState(d)
            setMsg(note || '已保存。')
            setErr('')
          })
          .catch((e) => setErr(String(e.message || e)))
          .finally(() => setBusy(false))
      }
      return React.createElement('div', { className: 'cfy-page' },
        React.createElement('style', null, styles),
        React.createElement('h3', null, 'ComfyUI'),
        React.createElement('p', { className: 'cfy-intro' },
          '给模型用的连接、模板/LoRA 注释和触发词。出图仍走对话里的工具；改节点去本机 ComfyUI。'),
        err ? React.createElement('div', { className: 'cfy-err' }, err) : null,
        msg ? React.createElement('div', { className: 'cfy-st' }, msg) : null,
        React.createElement('div', { className: 'cfy-card' },
          React.createElement('div', { className: 'cfy-st ' + (pingOk ? 'on' : 'off') },
            pingOk
              ? `已连接 ${state.ping.device || ''} · ComfyUI ${state.ping.version || ''}`
              : `未连接（${state?.ping?.message || state?.ping?.code || '检查地址'}）`),
          React.createElement('label', { className: 'cfy-field' }, 'ComfyUI 地址',
            React.createElement('input', {
              value: baseUrl,
              onChange: (e) => setBaseUrl(e.target.value),
              placeholder: 'http://127.0.0.1:8188',
            })),
          React.createElement('div', { className: 'cfy-row' },
            React.createElement('button', { className: 'cfy-btn', disabled: busy, onClick: save }, '保存'),
            React.createElement('button', { className: 'cfy-btn ghost', onClick: refresh }, '刷新状态'),
          ),
        ),
        React.createElement('div', { className: 'cfy-card' },
          React.createElement('h3', null, '模板注释（给 AI 看）'),
          React.createElement('p', { className: 'cfy-intro' },
            '写这个模板用什么底模、提示词是自然语言还是 Danbooru tag、有什么限制。删除会立刻去掉合同和包内工作流 JSON。随包的 anima 模板更新插件后可能回来。'),
          (state?.templates || []).map((t) => React.createElement('div', { className: 'cfy-tpl-block', key: t.id },
            React.createElement('div', { className: 'cfy-head' },
              React.createElement('div', null,
                React.createElement('div', { className: 'cfy-name' }, t.id + ' — ' + (t.title || '')),
                React.createElement('div', { className: 'cfy-used' },
                  [
                    t.prompt_style || '',
                    (t.media && t.media.out && t.media.out.join('+')) || '',
                    (t.capabilities && t.capabilities.mode && t.capabilities.mode.join(',')) || '',
                  ].filter(Boolean).join(' · ')),
                t.prompt_hint ? React.createElement('div', { className: 'cfy-used' }, t.prompt_hint) : null,
              ),
              React.createElement('button', {
                className: 'cfy-btn danger',
                disabled: busy,
                onClick: () => deleteTpl(t.id),
              }, '删除'),
            ),
            React.createElement('label', { className: 'cfy-field' }, '给 AI 的注释',
              React.createElement('textarea', {
                value: tplNotes[t.id] || '',
                placeholder: '例如：Qwen 底模，用英文自然语言，不要 1girl tag；或 SD1.5 用 danbooru tag。',
                onChange: (e) => setTplNotes({ ...tplNotes, [t.id]: e.target.value }),
              })),
          )),
          !(state?.templates || []).length ? React.createElement('p', { className: 'cfy-intro' }, '还没有模板。') : null,
          React.createElement('div', { className: 'cfy-row', style: { marginTop: 8 } },
            React.createElement('button', { className: 'cfy-btn', disabled: busy, onClick: save }, '保存模板注释'),
          ),
        ),
        React.createElement('div', { className: 'cfy-card' },
          React.createElement('h3', null, '导入工作流'),
          React.createElement('p', { className: 'cfy-intro' },
            'ComfyUI：Enable Dev mode → Save (API Format)。扫描只写合同标签（文生视频/图生图等），不在这台机器上跑。'),
          React.createElement('label', { className: 'cfy-field' }, 'JSON 路径',
            React.createElement('input', {
              value: importPath,
              onChange: (e) => setImportPath(e.target.value),
              placeholder: 'D:\\download\\workflow.json',
            })),
          React.createElement('div', { className: 'cfy-row' },
            React.createElement('input', {
              style: { flex: 1 },
              value: importId,
              placeholder: '模板 id（可留空自动）',
              onChange: (e) => setImportId(e.target.value),
            }),
            React.createElement('input', {
              style: { flex: 1 },
              value: importTitle,
              placeholder: '显示名',
              onChange: (e) => setImportTitle(e.target.value),
            }),
          ),
          React.createElement('div', { className: 'cfy-row', style: { marginTop: 8 } },
            React.createElement('button', { className: 'cfy-btn ghost', disabled: busy || !importPath.trim(), onClick: scanWf }, '扫描'),
            React.createElement('button', { className: 'cfy-btn', disabled: busy || !importPath.trim(), onClick: importWf }, '导入'),
          ),
          draft ? React.createElement('pre', { className: 'cfy-pre' },
            [
              `mode: ${(draft.mode || []).join(', ')}`,
              `in: ${(draft.media && draft.media.in || []).join(', ')}  out: ${(draft.media && draft.media.out || []).join(', ')}`,
              `can: ${(draft.can || []).join(', ')}`,
              `cannot: ${(draft.cannot || []).join(', ')}`,
              `必填: ${(draft.required_slots || []).join(', ')}`,
              `可选: ${(draft.optional_slots || []).join(', ')}`,
              (draft.warnings || []).map((w) => '⚠ ' + w).join('\n'),
            ].filter(Boolean).join('\n')) : null,
        ),
        React.createElement('div', { className: 'cfy-card' },
          React.createElement('h3', null, 'LoRA 触发词与注释'),
          React.createElement('p', { className: 'cfy-intro' },
            '和对话里的 lora 工具是同一张表。注释写特殊用法（权重、只用于写实、不要写进提示词等）。点删除会立刻保存。模板默认占用的条目删了还会出现，但触发词和注释会清空。'),
          loras.map((l, i) => React.createElement('div', { className: 'cfy-lora', key: l.name },
            React.createElement('div', { className: 'cfy-head' },
              React.createElement('div', null,
                React.createElement('div', { className: 'cfy-name' }, l.name),
                l.usedBy?.length ? React.createElement('div', { className: 'cfy-used' }, `用于 ${l.usedBy.join(', ')}`) : null,
                l.on_server === false ? React.createElement('div', { className: 'cfy-err' }, 'ComfyUI 上没有这个文件') : null,
              ),
              React.createElement('button', {
                className: 'cfy-btn danger',
                disabled: busy,
                onClick: () => persistLoras(loras.filter((x) => x.name !== l.name), '已删除 ' + l.name),
              }, '删除'),
            ),
            React.createElement('label', { className: 'cfy-field' }, '触发词',
              React.createElement('textarea', {
                value: l.triggerWords,
                onChange: (e) => {
                  const next = loras.slice()
                  next[i] = { ...l, triggerWords: e.target.value }
                  setLoras(next)
                },
              })),
            React.createElement('label', { className: 'cfy-field' }, '用法',
              React.createElement('select', {
                value: l.mode,
                onChange: (e) => {
                  const next = loras.slice()
                  next[i] = { ...l, mode: e.target.value }
                  setLoras(next)
                },
              },
                React.createElement('option', { value: 'both' }, '写入提示词 + 模型'),
                React.createElement('option', { value: 'model-only' }, '仅模型（不写词）'),
              )),
            React.createElement('label', { className: 'cfy-field' }, '给 AI 的注释',
              React.createElement('textarea', {
                value: l.note || '',
                placeholder: '特殊用法、建议权重、和哪些模板搭配、要不要写触发词。',
                onChange: (e) => {
                  const next = loras.slice()
                  next[i] = { ...l, note: e.target.value }
                  setLoras(next)
                },
              })),
          )),
          (() => {
            const registered = {}
            loras.forEach((l) => { registered[l.name] = true })
            const q = loraFilter.trim().toLowerCase()
            const choices = (state?.availableLoras || []).filter((n) => !registered[n] && (!q || n.toLowerCase().includes(q)))
            const pick = choices.includes(loraPick) ? loraPick : (choices[0] || '')
            return React.createElement('div', { style: { marginTop: 12 } },
              React.createElement('p', { className: 'cfy-intro' },
                pingOk
                  ? `ComfyUI 上共 ${(state?.availableLoras || []).length} 个 LoRA，筛选后从下拉列表选择。`
                  : '没连上 ComfyUI 时只能手打文件名。'),
              React.createElement('div', { className: 'cfy-row' },
                React.createElement('input', {
                  className: 'cfy-pick',
                  value: loraFilter,
                  placeholder: pingOk ? '筛选文件名' : '手打文件名.safetensors',
                  onChange: (e) => setLoraFilter(e.target.value),
                }),
                pingOk ? React.createElement('select', {
                  className: 'cfy-pick',
                  value: pick,
                  disabled: !choices.length,
                  onChange: (e) => setLoraPick(e.target.value),
                },
                  choices.length
                    ? choices.slice(0, 400).map((n) => React.createElement('option', { key: n, value: n }, n))
                    : React.createElement('option', { value: '' }, '没有可添加的（或被筛空了）'),
                ) : null,
                React.createElement('button', {
                  className: 'cfy-btn ghost',
                  disabled: busy || !(pingOk ? pick : loraFilter.trim()),
                  onClick: () => {
                    const name = pingOk ? pick : loraFilter.trim()
                    if (!name || loras.some((x) => x.name === name)) return
                    persistLoras(loras.concat([{ name, triggerWords: '', mode: 'both', note: '', usedBy: [] }]), '已添加 ' + name)
                    setLoraPick('')
                    if (!pingOk) setLoraFilter('')
                  },
                }, '添加'),
              ),
            )
          })(),
          React.createElement('div', { className: 'cfy-row', style: { marginTop: 12 } },
            React.createElement('button', { className: 'cfy-btn', disabled: busy, onClick: save }, '保存触发词与注释'),
          ),
        ),
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-comfyui',
        order: 42,
        label: () => 'ComfyUI',
      }, ComfySettings)), 'dsh-comfyui: settings')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
