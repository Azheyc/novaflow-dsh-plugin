import test from 'node:test'
import assert from 'node:assert/strict'
import { ORIGIN, PREFIX, NovaError, NovaApi, nonce, challenge, equalSecret, callbackOrigin, authorizationUrl, tokenPair, storedGrant, safeCode } from '../src/protocol.js'

const pair = overrides => ({ token_type: 'Bearer', access_token: `nfds_${'a'.repeat(43)}`, refresh_token: `nfdr_${'r'.repeat(43)}`, session_id: `nfdev_${'s'.repeat(43)}`, expires_in: 900, refresh_expires_in: 2592000, ...overrides })
const response = (data, status = 200) => new Response(JSON.stringify(data), { status })
const code = expected => error => error instanceof NovaError && error.code === expected

test('PKCE follows RFC 7636 S256 and produces unique 256-bit URL-safe nonces', () => {
  assert.equal(challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  const values = Array.from({ length: 64 }, nonce)
  assert.equal(new Set(values).size, values.length)
  for (const value of values) assert.match(value, /^[A-Za-z0-9_-]{43}$/)
})

test('secret comparison handles malformed Unicode without throwing', () => {
  assert.equal(equalSecret('abc', 'abc'), true)
  for (const [a, b] of [['abc', 'abd'], ['a', 'é'], ['', undefined], [undefined, ''], [null, null], ['abc', 'ab']]) assert.equal(equalSecret(a, b), false)
})

test('callback origin accepts only the intended loopback origin and port range', () => {
  assert.equal(callbackOrigin('http://127.0.0.1:64661'), 'http://127.0.0.1:64661')
  assert.equal(callbackOrigin('http://127.0.0.1:1024/'), 'http://127.0.0.1:1024')
  assert.equal(callbackOrigin('http://127.0.0.1:65535/'), 'http://127.0.0.1:65535')
  for (const value of ['https://127.0.0.1:64661', 'http://localhost:64661', 'http://[::1]:64661', 'http://127.0.0.1:1023', 'http://127.0.0.1', 'http://user@127.0.0.1:64661', 'http://127.0.0.1:64661/path', 'http://127.0.0.1:64661/?q=1', 'http://127.0.0.1:64661/#hash', 'http://evil.example:64661']) assert.throws(() => callbackOrigin(value))
})

test('authorization URL is pinned to issuer, path, and one request parameter', () => {
  const request = `nfda_${'a'.repeat(43)}`
  const valid = `${ORIGIN}/desktop/authorize?request=${request}`
  assert.equal(authorizationUrl(valid, request), valid)
  for (const value of [valid.replace(ORIGIN, 'https://evil.example'), valid.replace('/desktop/authorize', '/sign-in'), valid.replace('https://', 'http://'), valid.replace('https://', 'https://user@'), `${valid}#hash`, `${valid}&request=another`, `${valid}&redirect_uri=https://evil.example`, valid.replace(request, 'wrong')]) assert.throws(() => authorizationUrl(value, request), code('INVALID_RESPONSE'))
})

test('token response converts relative seconds to deadlines without retaining extra fields', () => {
  const value = tokenPair(pair({ secret_backend_key: 'must-not-be-retained' }), 1000)
  assert.deepEqual(value, { version: 1, issuer: ORIGIN, accessToken: pair().access_token, refreshToken: pair().refresh_token, sessionId: pair().session_id, expiresAt: 901000, refreshExpiresAt: 2592001000 })
})

test('token response fails closed on malformed tokens, identity, and TTL', () => {
  for (const overrides of [
    { token_type: 'Basic' }, { token_type: 7 }, { access_token: 'nfds_a' }, { refresh_token: 'nfdr_r' }, { session_id: 'anything' },
    { access_token: `nfdr_${'a'.repeat(43)}` }, { refresh_token: `nfds_${'r'.repeat(43)}` },
    { expires_in: 0 }, { expires_in: 901 }, { expires_in: Infinity }, { expires_in: 0.5 },
    { refresh_expires_in: 0 }, { refresh_expires_in: NaN }, { refresh_expires_in: 1.5 },
  ]) assert.throws(() => tokenPair(pair(overrides)), code('INVALID_RESPONSE'), JSON.stringify(overrides))
})

test('stored grants require the pinned issuer and structurally valid deadlines and tokens', () => {
  const grant = tokenPair(pair(), 1000)
  assert.deepEqual(storedGrant({ kind: 'grant', payload: grant }), grant)
  assert.equal(storedGrant(undefined), null)
  assert.equal(storedGrant({ kind: 'api-key', key: 'test' }), null)
  for (const override of [{ issuer: 'https://evil.example' }, { version: 2 }, { accessToken: 'short' }, { refreshToken: 'short' }, { sessionId: '' }, { expiresAt: undefined }, { refreshExpiresAt: undefined }, { expiresAt: NaN }, { refreshExpiresAt: Infinity }]) assert.equal(storedGrant({ kind: 'grant', payload: { ...grant, ...override } }), null, JSON.stringify(override))
})

test('API uses only the pinned origin, explicit Bearer, JSON, and redirect rejection', async () => {
  const calls = []
  const api = new NovaApi({ fetchImpl: async (...args) => { calls.push(args); return response({ code: 0, message: '', data: { ok: true } }) } })
  assert.deepEqual(await api.request(`${PREFIX}/creator/bootstrap`, { token: 'synthetic-token' }), { ok: true })
  await api.request(`${PREFIX}/desktop/auth/refresh`, { body: { refresh_token: 'synthetic-refresh' } })
  assert.equal(calls[0][0], `${ORIGIN}${PREFIX}/creator/bootstrap`)
  assert.equal(calls[0][1].method, 'GET')
  assert.equal(calls[0][1].headers.authorization, 'Bearer synthetic-token')
  assert.equal(calls[0][1].redirect, 'error')
  assert.ok(calls[0][1].signal instanceof AbortSignal)
  assert.equal(calls[1][1].method, 'POST')
  assert.equal(calls[1][1].headers['content-type'], 'application/json')
  assert.equal(calls[1][1].body, '{"refresh_token":"synthetic-refresh"}')
  for (const path of ['https://evil.example', '//evil.example', '/v1/models', `${PREFIX}/../admin`, `${PREFIX}/creator/models?secret=value`]) await assert.rejects(api.request(path), code('INVALID_REQUEST'))
  assert.equal(calls.length, 2)
})

test('API errors expose stable codes rather than server or network secrets', async () => {
  const secret = 'synthetic-sensitive-server-content'
  for (const [status, expected] of [[401, 'AUTH_REQUIRED'], [403, 'AUTH_REQUIRED'], [429, 'PLATFORM_ERROR'], [500, 'PLATFORM_ERROR']]) {
    const api = new NovaApi({ fetchImpl: async () => response({ message: secret }, status) })
    await assert.rejects(api.request(`${PREFIX}/creator/models`), code(expected))
  }
  const api = new NovaApi({ fetchImpl: async () => { throw new Error(secret) } })
  await assert.rejects(api.request(`${PREFIX}/creator/models`), error => code('NETWORK_ERROR')(error) && !String(error).includes(secret))
  assert.equal(safeCode(new Error(secret)), 'INTERNAL_ERROR')
})

test('API requires a successful envelope and caps response bytes', async () => {
  for (const body of ['not JSON', JSON.stringify({ code: 1, data: null }), JSON.stringify({ code: 0 }), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    const api = new NovaApi({ fetchImpl: async () => new Response(body) })
    await assert.rejects(api.request(`${PREFIX}/creator/models`), code('INVALID_RESPONSE'))
  }
})

test('API combines caller cancellation with its deadline without real network', async () => {
  const controller = new AbortController()
  controller.abort()
  const api = new NovaApi({ fetchImpl: async (_url, options) => { assert.equal(options.signal.aborted, true); options.signal.throwIfAborted() } })
  await assert.rejects(api.request(`${PREFIX}/creator/models`, { signal: controller.signal }), code('NETWORK_ERROR'))
})
