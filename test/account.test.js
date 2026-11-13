import test from 'node:test'
import assert from 'node:assert/strict'
import { NovaAccount } from '../src/account.js'
import { ORIGIN, PREFIX, RECORD, NovaError, challenge, tokenPair, storedGrant } from '../src/protocol.js'

const NOW = 1800000000000
const sessionId = `nfdev_${'s'.repeat(43)}`
const tokenResponse = (letter = 'a', overrides = {}) => ({ token_type: 'Bearer', access_token: `nfds_${letter.repeat(43)}`, refresh_token: `nfdr_${letter.repeat(43)}`, session_id: sessionId, expires_in: 900, refresh_expires_in: 2592000, ...overrides })
const bootstrap = { user_id: 7, display_name: '测试账户', identity_scope: 'personal', capabilities: { text: true, image: true, video: true } }
const code = expected => error => error instanceof NovaError && error.code === expected
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Matches credentials.modifyRecord: exclusive read-decide-write, with undefined
// meaning no change. Clone boundaries prevent the mock hiding mutation bugs.
class MemoryCredentials {
  constructor(record) { this.record = structuredClone(record); this.tail = Promise.resolve(); this.beforeCommit = null; this.writes = [] }
  locked(work) {
    const result = this.tail.then(work)
    this.tail = result.catch(() => {})
    return result
  }
  async readRecord(key) { assert.equal(key, RECORD); await this.tail; return structuredClone(this.record) }
  modifyRecord(key, mutate) {
    assert.equal(key, RECORD)
    return this.locked(async () => {
      const next = await mutate(structuredClone(this.record))
      if (next !== undefined) {
        await this.beforeCommit?.(next)
        this.record = structuredClone(next)
        this.writes.push(structuredClone(next))
      }
      return structuredClone(this.record)
    })
  }
  deleteRecord(key) { assert.equal(key, RECORD); return this.locked(async () => { this.record = undefined }) }
}
function harness(t, options = {}) {
  let now = NOW
  const credentials = options.credentials ?? new MemoryCredentials(options.grant ? { kind: 'grant', payload: options.grant } : undefined)
  const calls = [], catalogCalls = [], clears = []
  const api = { async request(path, request = {}) {
    calls.push({ path, ...request })
    if (options.request) {
      const result = await options.request(path, request, credentials)
      if (result !== undefined) return result
    }
    if (path === `${PREFIX}/desktop/auth/start`) return { request_id: `nfda_${'d'.repeat(43)}`, authorize_url: `${ORIGIN}/desktop/authorize?request=nfda_${'d'.repeat(43)}`, expires_in: 600 }
    if (path === `${PREFIX}/desktop/auth/exchange`) return tokenResponse()
    if (path === `${PREFIX}/desktop/auth/refresh`) return tokenResponse('b')
    if (path === `${PREFIX}/desktop/auth/revoke`) return { revoked: true }
    if (path === `${PREFIX}/creator/bootstrap`) return bootstrap
    if (path === `${PREFIX}/creator/models`) return { items: [{ group_id: '企业 空间', model_id: 'test-model', supported_endpoint_types: ['openai'] }] }
    throw new Error('Unexpected fake API path')
  } }
  const account = new NovaAccount({ credentials, api, origin: 'http://127.0.0.1:64661', now: () => now,
    onCatalog: async (...args) => { catalogCalls.push(args); return options.onCatalog ? options.onCatalog(...args) : [{ id: 'synthetic-model', label: 'Test' }] },
    onClear: async () => { clears.push(true); await options.onClear?.() },
  })
  t.after(() => account.dispose())
  return { account, credentials, calls, catalogCalls, clears, setNow: value => { now = value }, api }
}
function callback(h, mutate) {
  const start = h.calls.findLast(call => call.path.endsWith('/auth/start'))
  const url = new URL(start.body.redirect_uri)
  url.searchParams.set('code', `nfdc_${'c'.repeat(43)}`)
  url.searchParams.set('state', start.body.state)
  url.searchParams.set('iss', ORIGIN)
  mutate?.(url)
  return url
}
const count = (h, suffix) => h.calls.filter(call => call.path.endsWith(suffix)).length
const grant = overrides => ({ ...tokenPair(tokenResponse(), NOW), ...overrides })

function assertPublicState(h) {
  const serialized = JSON.stringify(h.account.snapshot())
  const start = h.calls.findLast(call => call.path.endsWith('/auth/start'))
  const exchange = h.calls.findLast(call => call.path.endsWith('/auth/exchange'))
  for (const secret of [tokenResponse().access_token, tokenResponse().refresh_token, tokenResponse('b').access_token, tokenResponse('b').refresh_token, start?.body.state, exchange?.body.code_verifier].filter(Boolean)) assert.equal(serialized.includes(secret), false)
  assert.equal(h.account.snapshot().balance, null)
}

test('PKCE sign-in stores a grant only after bootstrap and publishes no credentials', async t => {
  const h = harness(t)
  const waiting = await h.account.start()
  const start = h.calls[0]
  assert.equal(start.body.client_id, 'novaflow-creator')
  assert.equal(start.body.code_challenge_method, 'S256')
  assert.match(start.body.state, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(start.body.redirect_uri, 'http://127.0.0.1:64661/novaflow/callback')
  assert.equal(waiting.attempt.phase, 'waiting')
  assert.equal(await h.credentials.readRecord(RECORD), undefined)
  const result = await h.account.callback(callback(h))
  const exchange = h.calls.find(call => call.path.endsWith('/auth/exchange'))
  assert.equal(challenge(exchange.body.code_verifier), start.body.code_challenge)
  assert.deepEqual(Object.keys(exchange.body).sort(), ['code', 'code_verifier', 'redirect_uri'])
  assert.equal(exchange.body.redirect_uri, start.body.redirect_uri)
  assert.equal(result.connected, true)
  assert.deepEqual(result.account, { displayName: '测试账户', role: 'personal' })
  assert.equal(storedGrant(await h.credentials.readRecord(RECORD)).sessionId, sessionId)
  assert.equal(h.catalogCalls[0][1], true)
  assertPublicState(h)
  await assert.rejects(h.account.callback(callback(h)), code('LOGIN_EXPIRED'))
  assert.equal(count(h, '/auth/exchange'), 1)
})

test('callback rejects wrong issuer/state/ownership, duplicates, extras, and malformed code', async t => {
  const h = harness(t)
  await h.account.start()
  const mutations = [
    url => url.searchParams.set('state', 'x'.repeat(43)),
    url => url.searchParams.set('state', 'é'.repeat(43)),
    url => url.searchParams.set('iss', 'https://evil.example'),
    url => url.searchParams.set('iss', 'https://ycnovaflow.vip'),
    url => url.searchParams.append('state', 'extra'),
    url => url.searchParams.append('code', 'extra'),
    url => url.searchParams.append('iss', ORIGIN),
    url => url.searchParams.set('extra', '1'),
    url => url.searchParams.delete('iss'),
    url => url.searchParams.set('code', 'nfdc_short'),
    url => { url.port = '64662' },
    url => { url.hostname = 'localhost' },
    url => { url.pathname = '/other' },
    url => { url.hash = 'fragment' },
    url => { url.username = 'user' },
  ]
  for (const mutate of mutations) await assert.rejects(h.account.callback(callback(h, mutate)), code('INVALID_CALLBACK'))
  assert.equal(count(h, '/auth/exchange'), 0)
  assert.equal(h.account.snapshot().attempt.phase, 'waiting')
})

test('an admitted callback cannot exchange twice while the first exchange is pending', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t, { request: async path => { if (path.endsWith('/auth/exchange')) { entered.resolve(); return release.promise } } })
  await h.account.start()
  const result = h.account.callback(callback(h))
  await entered.promise
  await assert.rejects(h.account.callback(callback(h)), code('LOGIN_EXPIRED'))
  release.resolve(tokenResponse())
  await result
  assert.equal(count(h, '/auth/exchange'), 1)
})

test('cancel during exchange discards returned tokens and revokes the new device', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t, { request: async path => { if (path.endsWith('/auth/exchange')) { entered.resolve(); return release.promise } } })
  await h.account.start()
  const result = assert.rejects(h.account.callback(callback(h)), code('CANCELLED'))
  await entered.promise
  h.account.cancel(h.account.snapshot().attempt.id)
  release.resolve(tokenResponse())
  await result
  assert.equal(storedGrant(await h.credentials.readRecord(RECORD)), null)
  assert.equal(h.account.snapshot().connected, false)
  assert.equal(h.account.snapshot().attempt.phase, 'cancelled')
  assert.equal(count(h, '/auth/revoke'), 1)
  assert.equal(h.calls.find(call => call.path.endsWith('/auth/revoke')).token, tokenResponse().refresh_token)
  assertPublicState(h)
})

test('cancel while the credential write commits cannot restore a cancelled account', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t)
  let intercepted = false
  h.credentials.beforeCommit = async next => { if (!intercepted && next.payload) { intercepted = true; entered.resolve(); await release.promise } }
  await h.account.start()
  const result = assert.rejects(h.account.callback(callback(h)), code('CANCELLED'))
  await entered.promise
  h.account.cancel()
  release.resolve()
  await result
  assert.equal(storedGrant(await h.credentials.readRecord(RECORD)), null)
  assert.equal(h.account.snapshot().connected, false)
  assert.equal(count(h, '/auth/revoke'), 1)
})

test('bootstrap rejection after exchange revokes the device and never persists it', async t => {
  const h = harness(t, { request: async path => { if (path.endsWith('/creator/bootstrap')) throw new NovaError('AUTH_REQUIRED') } })
  await h.account.start()
  await assert.rejects(h.account.callback(callback(h)), code('AUTH_REQUIRED'))
  assert.equal(await h.credentials.readRecord(RECORD), undefined)
  assert.equal(count(h, '/auth/revoke'), 1)
  assert.equal(h.account.snapshot().connected, false)
})

test('expired or superseded login attempts cannot exchange a callback', async t => {
  const h = harness(t)
  await h.account.start()
  const old = callback(h)
  await h.account.start()
  assert.notEqual(callback(h).searchParams.get('state'), old.searchParams.get('state'))
  await assert.rejects(h.account.callback(old), code('INVALID_CALLBACK'))
  h.setNow(NOW + 600000)
  await assert.rejects(h.account.callback(callback(h)), code('LOGIN_EXPIRED'))
  assert.equal(count(h, '/auth/exchange'), 0)
})

test('cancelling a stale attempt id cannot cancel the current login', async t => {
  const h = harness(t)
  const first = await h.account.start()
  const second = await h.account.start()
  h.account.cancel(first.attempt.id)
  assert.equal(h.account.snapshot().attempt.id, second.attempt.id)
  assert.equal(h.account.snapshot().attempt.phase, 'waiting')
})

test('refresh is single-flight and persists its one-use marker before sending', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t, { grant: grant({ expiresAt: NOW + 10000 }), request: async (path, _request, credentials) => {
    if (path.endsWith('/auth/refresh')) {
      assert.equal(typeof storedGrant(await credentials.readRecord(RECORD)).refreshPending, 'string')
      entered.resolve()
      return release.promise
    }
  } })
  const pending = [h.account.accessToken(), h.account.accessToken(), h.account.accessToken()]
  await entered.promise
  assert.equal(count(h, '/auth/refresh'), 1)
  release.resolve(tokenResponse('b'))
  assert.deepEqual(await Promise.all(pending), Array(3).fill(tokenResponse('b').access_token))
  const saved = storedGrant(await h.credentials.readRecord(RECORD))
  assert.equal(saved.refreshToken, tokenResponse('b').refresh_token)
  assert.equal(saved.refreshPending, undefined)
})

test('credential locking prevents a second account instance replaying an in-flight refresh', async t => {
  const credentials = new MemoryCredentials({ kind: 'grant', payload: grant({ expiresAt: NOW }) })
  const entered = deferred(), release = deferred()
  const first = harness(t, { credentials, request: async path => { if (path.endsWith('/auth/refresh')) { entered.resolve(); return release.promise } } })
  const second = harness(t, { credentials })
  const pending = first.account.accessToken()
  await entered.promise
  await assert.rejects(second.account.accessToken(), code('AUTH_REQUIRED'))
  assert.equal(count(second, '/auth/refresh'), 0)
  release.resolve(tokenResponse('b'))
  await pending
  assert.equal(await second.account.accessToken(), tokenResponse('b').access_token)
})

test('unknown refresh outcome survives restart and is never retried with the old token', async t => {
  const h = harness(t, { grant: grant({ expiresAt: NOW }), request: async path => { if (path.endsWith('/auth/refresh')) throw new NovaError('NETWORK_ERROR') } })
  await assert.rejects(h.account.accessToken(), code('NETWORK_ERROR'))
  assert.ok(storedGrant(await h.credentials.readRecord(RECORD)).refreshPending)
  await assert.rejects(h.account.accessToken(), code('AUTH_REQUIRED'))
  assert.equal(count(h, '/auth/refresh'), 1)
  const restarted = harness(t, { credentials: h.credentials })
  const state = await restarted.account.initialize()
  assert.equal(state.error, 'AUTH_REQUIRED')
  assert.equal(state.connected, false)
  assert.equal(restarted.calls.length, 0)
})

test('a refresh response for another device cannot overwrite the stored session', async t => {
  const h = harness(t, { grant: grant({ expiresAt: NOW }), request: async path => { if (path.endsWith('/auth/refresh')) return tokenResponse('b', { session_id: `nfdev_${'z'.repeat(43)}` }) } })
  await assert.rejects(h.account.accessToken(), code('INVALID_RESPONSE'))
  const saved = storedGrant(await h.credentials.readRecord(RECORD))
  assert.equal(saved.sessionId, sessionId)
  assert.equal(saved.accessToken, tokenResponse().access_token)
  assert.ok(saved.refreshPending)
})

test('sign-out waits for rotation then revokes with the newest refresh and clears locally', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t, { grant: grant({ expiresAt: NOW }), request: async path => { if (path.endsWith('/auth/refresh')) { entered.resolve(); return release.promise } } })
  const refresh = h.account.accessToken()
  await entered.promise
  const logout = h.account.signout()
  assert.equal(count(h, '/auth/revoke'), 0)
  release.resolve(tokenResponse('b'))
  await refresh
  const state = await logout
  assert.equal(await h.credentials.readRecord(RECORD), undefined)
  assert.equal(state.connected, false)
  assert.equal(state.account, null)
  assert.deepEqual(state.models, [])
  assert.equal(h.calls.find(call => call.path.endsWith('/auth/revoke')).token, tokenResponse('b').refresh_token)
  assertPublicState(h)
})

test('failed revocation still clears local access and emits a safe warning', async t => {
  const h = harness(t, { grant: grant(), request: async path => { if (path.endsWith('/auth/revoke')) throw new Error('sensitive response text') } })
  const state = await h.account.signout()
  assert.equal(state.warning, 'REVOKE_FAILED')
  assert.equal(await h.credentials.readRecord(RECORD), undefined)
  await assert.rejects(h.account.accessToken(), code('AUTH_REQUIRED'))
  assert.equal(JSON.stringify(state).includes('sensitive'), false)
})

test('catalog completion after sign-out cannot republish an old account', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t, { grant: grant(), onCatalog: async () => { entered.resolve(); return release.promise } })
  const refresh = assert.rejects(h.account.refresh(), code('CANCELLED'))
  await entered.promise
  await h.account.signout()
  release.resolve([{ id: 'stale-model' }])
  await refresh
  assert.equal(h.account.snapshot().connected, false)
  assert.deepEqual(h.account.snapshot().models, [])
  assert.ok(h.clears.length >= 2)
})

test('a stale rejected token cannot invalidate a newer grant', async t => {
  const h = harness(t, { grant: grant() })
  await h.account.initialize()
  await h.account.rejectToken(tokenResponse('b').access_token)
  assert.equal(h.account.snapshot().connected, true)
  await h.account.rejectToken(tokenResponse().access_token)
  assert.equal(h.account.snapshot().connected, false)
  assert.equal(h.account.snapshot().error, 'AUTH_REQUIRED')
  await assert.rejects(h.account.accessToken(), code('AUTH_REQUIRED'))
  assert.equal(count(h, '/auth/refresh'), 0)
})

test('existing grants require explicit sign-out before switching accounts', async t => {
  const h = harness(t, { grant: grant() })
  await assert.rejects(h.account.start(), code('SIGNOUT_REQUIRED'))
  assert.equal(h.calls.length, 0)
  await h.account.signout()
  assert.equal((await h.account.start()).attempt.phase, 'waiting')
})

test('cancellation before start returns cannot revive the waiting authorization URL', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t, { request: async path => { if (path.endsWith('/auth/start')) { entered.resolve(); return release.promise } } })
  const starting = assert.rejects(h.account.start(), code('CANCELLED'))
  await entered.promise
  h.account.cancel()
  release.resolve({ request_id: 'cancelled-request', authorize_url: `${ORIGIN}/desktop/authorize?request=cancelled-request`, expires_in: 600 })
  await starting
  assert.equal(h.account.snapshot().attempt.phase, 'cancelled')
  assert.equal(h.account.snapshot().attempt.authorizeUrl, undefined)
  assert.equal(storedGrant(await h.credentials.readRecord(RECORD)), null)
})

test('concurrent catalog refreshes share one read and one model publication', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t, { grant: grant(), request: async path => { if (path.endsWith('/creator/bootstrap')) { entered.resolve(); return release.promise } } })
  const pending = [h.account.refresh(), h.account.refresh(), h.account.refresh()]
  await entered.promise
  release.resolve(bootstrap)
  const results = await Promise.all(pending)
  assert.equal(count(h, '/creator/bootstrap'), 1)
  assert.equal(count(h, '/creator/models'), 1)
  assert.equal(h.catalogCalls.length, 1)
  assert.ok(results.every(result => result.connected))
})

test('disposal during token rotation cannot save or return the newly issued credential', async t => {
  const entered = deferred(), release = deferred()
  const h = harness(t, { grant: grant({ expiresAt: NOW }), request: async path => { if (path.endsWith('/auth/refresh')) { entered.resolve(); return release.promise } } })
  const rotation = assert.rejects(h.account.accessToken(), code('AUTH_REQUIRED'))
  await entered.promise
  const disposal = h.account.dispose()
  release.resolve(tokenResponse('b'))
  await Promise.all([rotation, disposal])
  const saved = storedGrant(await h.credentials.readRecord(RECORD))
  assert.equal(saved.accessToken, tokenResponse().access_token)
  assert.ok(saved.refreshPending)
  assert.equal(h.calls.find(call => call.path.endsWith('/auth/revoke')).token, tokenResponse('b').refresh_token)
  await assert.rejects(h.account.accessToken(), code('CANCELLED'))
})

test('corrupt stored records are ignored without any platform request', async t => {
  const credentials = new MemoryCredentials({ kind: 'grant', payload: { version: 1, issuer: ORIGIN, accessToken: 'invalid', refreshToken: 'invalid', sessionId } })
  const h = harness(t, { credentials })
  assert.equal((await h.account.initialize()).connected, false)
  assert.equal(h.calls.length, 0)
})

test('expired refresh deadlines require reauthorization without an API refresh', async t => {
  const h = harness(t, { grant: grant({ expiresAt: NOW, refreshExpiresAt: NOW }) })
  await assert.rejects(h.account.accessToken(), code('AUTH_REQUIRED'))
  assert.equal(h.calls.length, 0)
})
