import { ORIGIN, equalSecret } from './protocol.js'

const PREFIX = '/novaflow/models/'
const BODY_LIMIT = 16 * 1024 * 1024
const ENDPOINTS = Object.freeze({
  'openai-completions': '/v1/chat/completions',
  'openai-responses': '/v1/responses',
  'anthropic-messages': '/v1/messages',
})
const loopback = address => address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1'
class BridgeError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}
function fail(res, status, code) {
  if (res.destroyed || res.writableEnded) return
  // Once an SSE response started, terminate it instead of injecting JSON into its protocol.
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'Connection': 'close' })
  res.end(JSON.stringify({ error: { type: 'novaflow_bridge_error', code, message: 'NovaFlow model request could not be completed. Check account access and retry.' } }))
}
function aborted(signal) {
  if (signal.aborted) throw new BridgeError(signal.reason === 'timeout' ? 504 : 503, signal.reason === 'timeout' ? 'BRIDGE_TIMEOUT' : 'BRIDGE_CANCELLED')
}
function interruptible(promise, signal) {
  aborted(signal)
  return new Promise((resolve, reject) => {
    const abort = () => { try { aborted(signal) } catch (error) { reject(error) } }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort))
  })
}
function readBody(req, signal) {
  const declared = req.headers['content-length']
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) throw new BridgeError(413, 'BODY_TOO_LARGE')
  return new Promise((resolve,reject) => {
    let size = 0; const chunks = []
    const cleanup = () => { req.removeListener('data',data); req.removeListener('end',end); req.removeListener('error',error); req.removeListener('aborted',close); signal.removeEventListener('abort',abort) }
    const rejectAndDrain = failure => { cleanup(); req.resume(); reject(failure) }
    const data = chunk => {
      size += chunk.length
      if (size > BODY_LIMIT) return rejectAndDrain(new BridgeError(413,'BODY_TOO_LARGE'))
      chunks.push(chunk)
    }
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)) }
    const error = () => rejectAndDrain(new BridgeError(400,'INVALID_BODY'))
    const close = () => rejectAndDrain(new BridgeError(400,'CLIENT_CLOSED'))
    const abort = () => { try { aborted(signal) } catch (failure) { rejectAndDrain(failure) } }
    req.on('data',data); req.once('end',end); req.once('error',error); req.once('aborted',close); signal.addEventListener('abort',abort,{once:true})
    if (signal.aborted) abort()
  })
}
function drain(res, signal) {
  return new Promise((resolve,reject) => {
    const cleanup = () => { res.removeListener('drain',done); res.removeListener('close',close); res.removeListener('error',close); signal.removeEventListener('abort',abort) }
    const done = () => { cleanup(); resolve() }
    const close = () => { cleanup(); reject(new BridgeError(503,'CLIENT_CLOSED')) }
    const abort = () => { cleanup(); try { aborted(signal) } catch(error) { reject(error) } }
    res.once('drain',done); res.once('close',close); res.once('error',close); signal.addEventListener('abort',abort,{once:true})
    if (res.destroyed) close(); else if (signal.aborted) abort()
  })
}

/** A loopback-only, key-authenticated relay for native Harness model profiles.
 * Local bridge keys never leave this process. Device grants never enter profiles.
 */
export function createModelBridge({ account, origin, fetchImpl = globalThis.fetch, timeoutMs = 300000 }) {
  const local = new URL(origin)
  if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1' || !local.port || local.username || local.password || local.search || local.hash || local.pathname !== '/' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid model bridge configuration')
  if (typeof account?.accessToken !== 'function' || typeof fetchImpl !== 'function') throw new Error('Model bridge dependencies unavailable')
  let routes = new Map(), disposed = false
  const active = new Set()
  function stopActive() { for (const controller of active) controller.abort('routes-changed') }
  function setRoutes(values) {
    if (disposed) throw new Error('Model bridge disposed')
    if (!Array.isArray(values)) throw new Error('Invalid model bridge routes')
    const next = new Map()
    for (const route of values) {
      if (!route || typeof route.provider !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(route.provider) || !Object.hasOwn(ENDPOINTS,route.api) || typeof route.group !== 'string' || !route.group || typeof route.key !== 'string' || route.key.length < 32 || /\s/.test(route.key) || !Array.isArray(route.models) || next.has(route.provider)) throw new Error('Invalid model bridge route')
      const models = route.models.map(model => {
        if (!model || typeof model.id !== 'string' || !model.id || typeof model.name !== 'string') throw new Error('Invalid model bridge model')
        return Object.freeze({id:model.id,name:model.name, ...(Number.isSafeInteger(model.contextWindow) && model.contextWindow > 0 ? {contextWindow:model.contextWindow}:{}), ...(Number.isSafeInteger(model.maxTokens) && model.maxTokens > 0 ? {maxTokens:model.maxTokens}:{})})
      })
      if (new Set(models.map(model=>model.id)).size !== models.length) throw new Error('Duplicate model bridge model')
      let encodedGroup; try { encodedGroup = encodeURIComponent(route.group) } catch { throw new Error('Invalid model bridge group') }
      next.set(route.provider,Object.freeze({provider:route.provider,api:route.api,encodedGroup,key:route.key,models:Object.freeze(models)}))
    }
    stopActive(); routes = next
  }
  function clear() { stopActive(); routes = new Map() }
  function dispose() { disposed = true; clear() }
  async function handler(req,res) {
    let controller, timer, reader, upstream
    const onClose = () => { if (!res.writableFinished) controller?.abort('client-closed') }
    try {
      if (disposed) throw new BridgeError(503,'BRIDGE_UNAVAILABLE')
      if (req.headers.host !== local.host || !loopback(req.socket?.remoteAddress)) throw new BridgeError(403,'FORBIDDEN')
      if (req.headers.origin !== undefined && req.headers.origin !== local.origin) throw new BridgeError(403,'FORBIDDEN')
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new BridgeError(403,'FORBIDDEN')
      // Inspect the raw request-target; URL normalization must never broaden the route.
      if (typeof req.url !== 'string' || !req.url.startsWith(PREFIX) || /[#%\\]/.test(req.url)) throw new BridgeError(404,'ROUTE_NOT_FOUND')
      const queryAt = req.url.indexOf('?')
      const rawPath = queryAt < 0 ? req.url : req.url.slice(0,queryAt)
      const query = queryAt < 0 ? '' : req.url.slice(queryAt)
      const match = /^\/novaflow\/models\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})(\/.*)$/.exec(rawPath)
      const route = match && routes.get(match[1])
      if (!route) throw new BridgeError(404,'ROUTE_NOT_FOUND')
      const bearer = typeof req.headers.authorization === 'string' ? /^Bearer ([^\s]+)$/i.exec(req.headers.authorization)?.[1] : undefined
      const apiKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : undefined
      if (!equalSecret(bearer,route.key) && !equalSecret(apiKey,route.key)) throw new BridgeError(401,'BRIDGE_UNAUTHORIZED')
      const path = match[2]
      if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
        const limit = query ? /^\?limit=([1-9][0-9]{0,3})$/.exec(query)?.[1] : undefined
        if (query && (!limit || Number(limit) > 1000)) throw new BridgeError(400,'INVALID_QUERY')
        const data = route.models.slice(0,limit ? Number(limit) : undefined).map(model => ({id:model.id,object:'model',name:model.name,display_name:model.name, ...(model.contextWindow ? {contextWindow:model.contextWindow,context_window:model.contextWindow}:{}), ...(model.maxTokens ? {maxTokens:model.maxTokens,max_output_tokens:model.maxTokens}:{})}))
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','Referrer-Policy':'no-referrer'})
        res.end(JSON.stringify({object:'list',data})); return
      }
      const anthropicBeta = req.method === 'POST' && route.api === 'anthropic-messages' && path === '/v1/messages' && query === '?beta=true'
      if (query && !anthropicBeta) throw new BridgeError(404,'ROUTE_NOT_FOUND')
      if (req.method !== 'POST' || path !== ENDPOINTS[route.api]) throw new BridgeError(405,'METHOD_NOT_ALLOWED')
      const protocolHeaders = {}
      if (route.api === 'anthropic-messages') for (const name of ['anthropic-beta','anthropic-version']) {
        const value = req.headers[name]
        if (value === undefined) continue
        if (typeof value !== 'string' || value.length > 2048 || /[\r\n]/.test(value)) throw new BridgeError(400,'INVALID_PROTOCOL_HEADER')
        protocolHeaders[name] = value
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) throw new BridgeError(415,'UNSUPPORTED_BODY')
      controller = new AbortController(); active.add(controller)
      timer = setTimeout(()=>controller.abort('timeout'),timeoutMs); timer.unref?.()
      res.once('close',onClose)
      const body = await readBody(req,controller.signal)
      let payload; try { payload = JSON.parse(body.toString('utf8')) } catch { throw new BridgeError(400,'INVALID_JSON') }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.model !== 'string' || !route.models.some(model=>model.id===payload.model)) throw new BridgeError(400,'MODEL_NOT_ALLOWED')
      aborted(controller.signal)
      let token; try { token = await interruptible(account.accessToken(),controller.signal) } catch(error) { if (error instanceof BridgeError) throw error; throw new BridgeError(401,'ACCOUNT_SIGN_IN_REQUIRED') }
      aborted(controller.signal)
      if (typeof token !== 'string' || !token) throw new BridgeError(401,'ACCOUNT_SIGN_IN_REQUIRED')
      upstream = await interruptible(fetchImpl(ORIGIN + ENDPOINTS[route.api] + (anthropicBeta ? '?beta=true' : ''), {
        method:'POST',body,redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${token}`,'X-NovaFlow-Group':route.encodedGroup,...protocolHeaders},
      }),controller.signal)
      aborted(controller.signal)
      if (!upstream.ok) {
        await upstream.body?.cancel().catch(()=>{})
        if (upstream.status === 401 && typeof account.rejectToken === 'function') {
          // Account invalidation may itself clear this bridge and abort this request.
          // Preserve the authoritative 401 instead of turning that cleanup into 503.
          await interruptible(Promise.resolve().then(()=>account.rejectToken(token)),controller.signal).catch(()=>{})
        }
        throw new BridgeError(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, upstream.status === 401 ? 'ACCOUNT_TOKEN_REJECTED' : 'UPSTREAM_ERROR')
      }
      const type = upstream.headers.get('content-type') || ''
      if (!/^(application\/json|text\/event-stream)(?:\s*;|$)/i.test(type)) { await upstream.body?.cancel().catch(()=>{}); throw new BridgeError(502,'UPSTREAM_RESPONSE_INVALID') }
      res.writeHead(upstream.status,{'Content-Type':type,'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Accel-Buffering':'no'})
      if (upstream.body) {
        reader = upstream.body.getReader()
        while (true) {
          const {value,done} = await interruptible(reader.read(),controller.signal)
          if (done) break
          aborted(controller.signal)
          if (!res.write(value)) await drain(res,controller.signal)
        }
      }
      res.end()
    } catch(error) {
      if (controller?.signal.aborted && !(error instanceof BridgeError)) {
        fail(res,controller.signal.reason === 'timeout' ? 504 : 503,controller.signal.reason === 'timeout' ? 'BRIDGE_TIMEOUT' : 'BRIDGE_CANCELLED')
      } else if (error instanceof BridgeError) fail(res,error.status,error.code)
      else fail(res,502,'UPSTREAM_UNAVAILABLE')
    } finally {
      clearTimeout(timer); res.removeListener('close',onClose)
      if (controller) active.delete(controller)
      if (reader) { await reader.cancel().catch(()=>{}); reader.releaseLock() }
      else if (upstream?.body && !upstream.body.locked) await upstream.body.cancel().catch(()=>{})
    }
  }
  return {setRoutes,clear,dispose,handler}
}
