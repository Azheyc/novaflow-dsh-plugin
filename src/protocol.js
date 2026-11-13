import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const ORIGIN = 'https://www.ycnovaflow.vip'
export const PREFIX = '/api/novaflow/v1'
export const RECORD = 'novaflow-account/creator'
export class NovaError extends Error {
  constructor(code) { super(code); this.code = code }
}
export function safeCode(error) {
  return error instanceof NovaError ? error.code : 'INTERNAL_ERROR'
}
export const nonce = () => randomBytes(32).toString('base64url')
export const challenge = value => createHash('sha256').update(value).digest('base64url')
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
export function callbackOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1024 || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new NovaError('CALLBACK_UNAVAILABLE')
  return url.origin
}
export function authorizationUrl(value, requestId) {
  const url = new URL(value)
  if (url.origin !== ORIGIN || url.pathname !== '/desktop/authorize' || url.username || url.password || url.hash || url.searchParams.get('request') !== requestId || url.searchParams.getAll('request').length !== 1 || [...url.searchParams.keys()].some(key => key !== 'request')) throw new NovaError('INVALID_RESPONSE')
  return url.href
}
export function tokenPair(data, now = Date.now()) {
  if (!data || data.token_type !== 'Bearer' || !/^nfds_[A-Za-z0-9_-]{43}$/.test(data.access_token) || !/^nfdr_[A-Za-z0-9_-]{43}$/.test(data.refresh_token) || !/^nfdev_[A-Za-z0-9_-]{43}$/.test(data.session_id) || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 || data.expires_in > 900 || !Number.isSafeInteger(data.refresh_expires_in) || data.refresh_expires_in <= 0 || data.refresh_expires_in > 90*86400) throw new NovaError('INVALID_RESPONSE')
  return { version: 1, issuer: ORIGIN, accessToken: data.access_token, refreshToken: data.refresh_token, sessionId: data.session_id, expiresAt: now + data.expires_in * 1000, refreshExpiresAt: now + data.refresh_expires_in * 1000 }
}
export function storedGrant(record) {
  const value = record?.kind === 'grant' ? record.payload : null
  return value?.version === 1 && value.issuer === ORIGIN && /^nfds_[A-Za-z0-9_-]{43}$/.test(value.accessToken) && /^nfdr_[A-Za-z0-9_-]{43}$/.test(value.refreshToken) && /^nfdev_[A-Za-z0-9_-]{43}$/.test(value.sessionId) && Number.isFinite(value.expiresAt) && value.expiresAt > 0 && Number.isFinite(value.refreshExpiresAt) && value.refreshExpiresAt > 0 ? value : null
}
export class NovaApi {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) { this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs }
  async request(path, { body, token, signal } = {}) {
    if (!path.startsWith(PREFIX + '/') || path.includes('..') || path.includes('?')) throw new NovaError('INVALID_REQUEST')
    const headers = { accept: 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    let response
    try {
      response = await this.fetchImpl(ORIGIN + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs) })
    } catch { throw new NovaError('NETWORK_ERROR') }
    if (response.status === 401 || response.status === 403) throw new NovaError('AUTH_REQUIRED')
    if (!response.ok) throw new NovaError('PLATFORM_ERROR')
    try {
      const reader = response.body.getReader(); const chunks = []; let size = 0
      try {
        while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) throw new Error(); chunks.push(value) }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (data.code !== 0 || !Object.hasOwn(data, 'data')) throw new Error()
      return data.data
    } catch { throw new NovaError('INVALID_RESPONSE') }
  }
}
