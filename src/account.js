import { platform, hostname } from 'node:os'
import { ORIGIN, PREFIX, RECORD, NovaError, safeCode, nonce, challenge, equalSecret, callbackOrigin, authorizationUrl, tokenPair, storedGrant } from './protocol.js'

/** Owns one device grant. UI snapshots never contain either token or the PKCE verifier. */
export class NovaAccount {
  constructor({ credentials, api, origin, onCatalog = async () => [], onClear = async () => {}, now = Date.now }) {
    Object.assign(this, { credentials, api, origin, onCatalog, onClear, now })
    this.state = { connected: false, hasCredential: false, account: null, models: [], attempt: null, balance: null, error: null, warning: null, revision: 0 }
    this.generation = 0; this.pending = null; this.disposed = false; this.refreshing = null; this.rotation = null
    this.controller = new AbortController()
  }
  publish(patch) { this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }; return this.snapshot() }
  snapshot() { return structuredClone(this.state) }
  async initialize() {
    const grant = storedGrant(await this.credentials.readRecord(RECORD))
    if (grant) this.publish({hasCredential:true})
    if (grant && !grant.refreshPending) { try { await this.refresh() } catch (error) { this.publish({ error: safeCode(error) }) } }
    else if (grant) this.publish({ error: 'AUTH_REQUIRED' })
    return this.snapshot()
  }
  assertActive() { if (this.disposed) throw new NovaError('CANCELLED') }
  async start() {
    this.assertActive()
    if (this.state.connected || storedGrant(await this.credentials.readRecord(RECORD))) throw new NovaError('SIGNOUT_REQUIRED')
    this.cancel()
    const id = nonce(), verifier = nonce(), state = nonce()
    const attempt = { id, verifier, state, redirectUri: callbackOrigin(this.origin) + '/novaflow/callback', deadline: this.now() + 600000, claimed: false }
    this.pending = attempt
    this.publish({ attempt: { id, phase: 'starting', expiresAt: attempt.deadline }, error: null, warning: null })
    try {
      const data = await this.api.request(PREFIX + '/desktop/auth/start', { body: { client_id: 'novaflow-creator', code_challenge: challenge(verifier), code_challenge_method: 'S256', state, redirect_uri: attempt.redirectUri, device_name: `DeepSeek Harness · ${platform()} · ${hostname()}`.slice(0,80) }, signal: this.controller.signal })
      if (this.pending !== attempt || this.disposed) throw new NovaError('CANCELLED')
      if (typeof data?.request_id !== 'string' || !data.request_id || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 600) throw new NovaError('INVALID_RESPONSE')
      const authorizeUrl = authorizationUrl(data.authorize_url, data.request_id)
      attempt.deadline = Math.min(attempt.deadline, this.now() + data.expires_in * 1000)
      this.timer = setTimeout(() => { if (this.pending === attempt) { this.pending = null; this.publish({ attempt: { id, phase: 'expired', expiresAt: attempt.deadline }, error: 'LOGIN_EXPIRED' }) } }, Math.max(0, attempt.deadline - this.now()))
      this.timer.unref?.()
      return this.publish({ attempt: { id, phase: 'waiting', authorizeUrl, expiresAt: attempt.deadline } })
    } catch (error) {
      if (this.pending === attempt) { this.pending = null; this.publish({ attempt: { id, phase: 'failed', expiresAt: attempt.deadline }, error: safeCode(error) }) }
      throw error
    }
  }
  cancel(id) {
    if (id && this.pending?.id !== id) return this.snapshot()
    const attempt = this.pending; this.pending = null; clearTimeout(this.timer)
    if (attempt) this.publish({ attempt: { id: attempt.id, phase: 'cancelled', expiresAt: attempt.deadline }, error: null })
    return this.snapshot()
  }
  async callback(url) {
    const a = this.pending
    if (!a || this.disposed || a.claimed || this.now() >= a.deadline) throw new NovaError('LOGIN_EXPIRED')
    if (url.username || url.password || url.hash || url.origin !== callbackOrigin(this.origin) || url.pathname !== '/novaflow/callback' || [...url.searchParams.keys()].some(k => !['code','state','iss'].includes(k)) || ['code','state','iss'].some(k => url.searchParams.getAll(k).length !== 1) || !equalSecret(url.searchParams.get('state'), a.state) || url.searchParams.get('iss') !== ORIGIN || !/^nfdc_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code') || '')) throw new NovaError('INVALID_CALLBACK')
    a.claimed = true
    this.publish({ attempt: { id: a.id, phase: 'exchanging', expiresAt: a.deadline } })
    let grant
    try {
      grant = tokenPair(await this.api.request(PREFIX + '/desktop/auth/exchange', { body: { code: url.searchParams.get('code'), code_verifier: a.verifier, redirect_uri: a.redirectUri }, signal: this.controller.signal }), this.now())
      const bootstrap = await this.api.request(PREFIX + '/creator/bootstrap', { token: grant.accessToken, signal: this.controller.signal })
      const account = this.accountView(bootstrap)
      if (this.pending !== a || this.disposed || this.now() >= a.deadline) throw new NovaError('CANCELLED')
      await this.credentials.modifyRecord(RECORD, async current => {
        if (this.pending !== a || this.disposed || this.now() >= a.deadline || storedGrant(current)) throw new NovaError('CANCELLED')
        return { kind: 'grant', payload: grant }
      })
      // Cancellation during the credential write cannot restore a cancelled login.
      if (this.pending !== a || this.disposed) {
        await this.credentials.modifyRecord(RECORD, async current => storedGrant(current)?.sessionId === grant.sessionId ? {kind:'grant',payload:null} : undefined)
        throw new NovaError('CANCELLED')
      }
      this.pending = null; clearTimeout(this.timer); this.generation++
      const committedGeneration = this.generation
      this.publish({ connected: false, hasCredential: true, account, error: null, attempt: { id: a.id, phase: 'exchanging', expiresAt: a.deadline } })
      try { await this.refresh(true) } catch (error) { if (committedGeneration === this.generation && !this.disposed) this.publish({ error: safeCode(error) }) }
      if (committedGeneration === this.generation && !this.disposed) this.publish({ attempt: { id: a.id, phase: 'succeeded', expiresAt: a.deadline } })
      return this.snapshot()
    } catch (error) {
      if (grant) await this.revoke(grant).catch(() => {})
      if (this.pending === a) { this.pending = null; clearTimeout(this.timer); this.publish({ attempt: { id: a.id, phase: 'failed', expiresAt: a.deadline }, error: safeCode(error) }) }
      throw error
    }
  }
  accountView(data) {
    if (!data || typeof data.display_name !== 'string' || typeof data.identity_scope !== 'string' || !Number.isInteger(data.user_id)) throw new NovaError('INVALID_RESPONSE')
    return { displayName: data.display_name, role: data.identity_scope }
  }
  async accessToken() {
    this.assertActive()
    if (this.rotation) return this.rotation
    const work = this.resolveToken()
    this.rotation = work
    try { return await work } finally { if (this.rotation === work) this.rotation = null }
  }
  async resolveToken() {
    let selected, owner = nonce()
    await this.credentials.modifyRecord(RECORD, async current => {
      const grant = storedGrant(current)
      if (!grant || grant.refreshPending || grant.refreshExpiresAt <= this.now()) throw new NovaError('AUTH_REQUIRED')
      selected = grant
      if (grant.expiresAt > this.now() + 60000) return undefined
      return { kind: 'grant', payload: { ...grant, refreshPending: owner } }
    })
    if (selected.expiresAt > this.now() + 60000) return selected.accessToken
    // Persist the in-flight marker BEFORE sending the rotating refresh. A crash or lost response
    // requires signing in again, never replaying an already-consumed refresh token.
    const pair = tokenPair(await this.api.request(PREFIX + '/desktop/auth/refresh', { body: { refresh_token: selected.refreshToken }, signal: this.controller.signal }), this.now())
    if (pair.sessionId !== selected.sessionId) throw new NovaError('INVALID_RESPONSE')
    let committed = false
    await this.credentials.modifyRecord(RECORD, async current => {
      const grant = storedGrant(current)
      if (this.disposed || grant?.sessionId !== selected.sessionId || grant.refreshPending !== owner) return undefined
      committed = true; return { kind: 'grant', payload: pair }
    })
    if (!committed) { await this.revoke(pair).catch(() => {}); throw new NovaError('AUTH_REQUIRED') }
    return pair.accessToken
  }
  async refresh(selectDefault = false) {
    this.assertActive()
    if (this.refreshing) return this.refreshing
    const generation = this.generation
    const operation = (async () => {
      try {
        const token = await this.accessToken()
        const bootstrap = await this.api.request(PREFIX + '/creator/bootstrap', { token, signal: this.controller.signal })
        const catalog = await this.api.request(PREFIX + '/creator/models', { token, signal: this.controller.signal })
        const account = this.accountView(bootstrap)
        if (generation !== this.generation || this.disposed) throw new NovaError('CANCELLED')
        const models = await this.onCatalog(catalog, selectDefault)
        if (generation !== this.generation || this.disposed) { await this.onClear(!this.disposed); throw new NovaError('CANCELLED') }
        return this.publish({ connected: true, hasCredential: true, account, models, error: null })
      } catch (error) {
        if (generation === this.generation && !this.disposed) {
          if (safeCode(error) === 'AUTH_REQUIRED') { this.publish({ connected: false, account: null, models: [], error: 'AUTH_REQUIRED' }); try { await this.onClear() } catch { this.publish({warning:'MODEL_CLEANUP_FAILED'}) } }
          else this.publish({ error: safeCode(error) })
        }
        throw error
      }
    })()
    this.refreshing = operation
    try { return await operation } finally { if (this.refreshing === operation) this.refreshing = null }
  }
  async rejectToken(token) {
    let rejected = false
    await this.credentials.modifyRecord(RECORD, async current => {
      const grant = storedGrant(current)
      if (!grant || grant.accessToken !== token) return undefined
      rejected = true
      return {kind:'grant',payload:{...grant, refreshPending:'rejected'}}
    })
    if (rejected) { this.generation++; await this.onClear(); this.publish({connected:false,account:null,models:[],error:'AUTH_REQUIRED'}) }
  }
  async revoke(grant) { await this.api.request(PREFIX + '/desktop/auth/revoke', { body: {}, token: grant.refreshToken }) }
  async signout() {
    this.assertActive(); this.cancel(); this.generation++
    // Wait for an admitted rotation so revocation uses its latest refresh token.
    if (this.rotation) await this.rotation.catch(() => {})
    const grant = storedGrant(await this.credentials.readRecord(RECORD))
    await this.credentials.deleteRecord(RECORD)
    this.publish({ connected: false, hasCredential: false, account: null, models: [], attempt: null, error: null, warning: null })
    try { await this.onClear() } catch { this.publish({ warning: 'MODEL_CLEANUP_FAILED' }) }
    if (grant) { try { await this.revoke(grant) } catch { this.publish({ warning: this.state.warning ? 'CLEANUP_AND_REVOKE_FAILED' : 'REVOKE_FAILED' }) } }
    return this.snapshot()
  }
  async dispose(waitForWork = true) { this.disposed = true; this.cancel(); this.generation++; this.controller.abort(); if (waitForWork) await Promise.allSettled([this.refreshing, this.rotation]); await this.onClear(false) }
}
