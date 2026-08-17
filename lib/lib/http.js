/** ComfyUI HTTP helpers. Native fetch (Node 18+). */

function joinUrl(baseUrl, pathname, query) {
  const base = String(baseUrl).replace(/\/$/, '')
  const url = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, `${base}/`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      url.searchParams.set(k, String(v))
    }
  }
  return url
}

export async function comfyFetch(baseUrl, method, pathname, opts = {}) {
  const { body, timeout = 30000, query, raw = false } = opts
  const url = joinUrl(baseUrl, pathname, query)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const headers = { ...(opts.headers || {}) }
    let payload = body
    if (payload && !(payload instanceof FormData) && typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(payload)
    }
    const res = await fetch(url, { method, headers, body: payload, signal: ctrl.signal })
    const buf = Buffer.from(await res.arrayBuffer())
    if (raw) return { ok: res.ok, status: res.status, buf, contentType: res.headers.get('content-type') || '' }
    const text = buf.toString('utf8')
    let data = null
    if (text) {
      try { data = JSON.parse(text) }
      catch { data = { raw: text } }
    }
    return { ok: res.ok, status: res.status, data }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    throw Object.assign(new Error(aborted ? `TIMEOUT ${method} ${pathname}` : `HTTP ${method} ${pathname}: ${err.message}`), {
      code: aborted ? 'TIMEOUT' : 'HTTP_ERROR',
      cause: err,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function comfyJson(baseUrl, method, pathname, opts = {}) {
  return comfyFetch(baseUrl, method, pathname, opts)
}

export async function uploadImage(baseUrl, filePath, buf, filename) {
  const fd = new FormData()
  const blob = new Blob([buf], { type: 'application/octet-stream' })
  fd.append('image', blob, filename)
  fd.append('overwrite', 'true')
  fd.append('type', 'input')
  const res = await comfyFetch(baseUrl, 'POST', '/upload/image', { body: fd, timeout: 120000 })
  if (!res.ok) {
    throw Object.assign(new Error(`UPLOAD_FAILED ${res.status}`), { code: 'UPLOAD_FAILED', data: res.data })
  }
  return res.data
}

export async function viewImage(baseUrl, { filename, subfolder = '', type = 'output' }) {
  const res = await comfyFetch(baseUrl, 'GET', '/view', {
    query: { filename, subfolder, type },
    raw: true,
    timeout: 120000,
  })
  if (!res.ok) {
    throw Object.assign(new Error(`VIEW_FAILED ${res.status} ${filename}`), { code: 'VIEW_FAILED' })
  }
  return res.buf
}
