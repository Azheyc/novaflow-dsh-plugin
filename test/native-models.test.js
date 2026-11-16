import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createModelBinding, loadNativeLibraries, parseCatalog, modelSeed, nativeEfforts, bridgeRef, protocolForModel, PROTOCOL_POLICY } from '../src/native-models.js'

// These tests parse the actual installed official Config. Configuration, secret
// stores, and HTTP boundaries are isolated in memory; no real account is read.
const libraries = await loadNativeLibraries()
const config = { contextWindow: 32768, maxTokens: 4096 }
const row = (group, endpoint = 'openai', id = 'test-model', extra = {}) => ({ group_id: group, model_id: id, label: `${id}（${group}）`, kind: 'text', supported_endpoint_types: [endpoint], ...extra })
const clone = value => structuredClone(value)
const ownerRecord = 'novaflow-account/native-providers'
const defaultRecord = 'novaflow-account/default-model'
function officialProviders(providers) { return libraries.Config({ providers }).providers.get() }
function harness({ origin = 'http://127.0.0.1:64661', state: previous } = {}) {
  const state = previous || { records: new Map(), keys: new Map(), selection: { provider: 'existing-provider', model: 'existing-model' }, edits: [], events: [], registrations: [], effects: [] }
  state.entry ||= { options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: {} } } }
  const ctx = {
    credentials: {
      readRecord: async key => clone(state.records.get(key)),
      modifyRecord: async (key, mutate) => { const next = await mutate(clone(state.records.get(key))); if (next !== undefined) state.records.set(key, clone(next)); return clone(state.records.get(key)) },
      deleteRecord: async key => { state.records.delete(key) },
      resolve: async ref => state.keys.has(ref) ? { value: state.keys.get(ref), source: 'fixture' } : undefined,
      set: async (ref, value) => { state.keys.set(ref, value) },
      unset: async ref => { state.keys.delete(ref) },
    },
    configEditor: {
      entries: () => [state.entry],
      edit: async (entry, change) => {
        assert.equal(entry, state.entry)
        const next = change(clone(entry.options.config))
        officialProviders(next.providers)
        entry.options.config = clone(next)
        state.edits.push(clone(next))
      },
    },
    webServer: { getOrigin: () => origin, register: route => { state.registrations.push(route); return () => {} } },
    effect: callback => { const dispose = callback(); state.effects.push(dispose); return dispose },
    emit: (...args) => state.events.push(args),
    agentDefaultModel: { currentSelection: () => clone(state.selection), saveSelection: async value => { state.selection = clone(value) } },
  }
  const account = { accessToken: async () => { throw Error('These config tests must not access a device grant') } }
  return { ctx, state, account }
}
async function bindingFor(t, options) {
  const h = harness(options)
  h.binding = await createModelBinding(h.ctx, h.account, config, libraries)
  t.after(async () => { await h.binding.clear(false); for (const dispose of h.state.effects.splice(0).reverse()) await dispose?.() })
  return h
}

test('catalog preserves raw model names without group suffixes and uses stable group/protocol identities', () => {
  const data = { items: [row('研发 A'), row('研发 B'), row('研发 A'), row('研发 A', 'anthropic'), row('image', 'image-generation', 'image', { kind: 'image' })] }
  const items = parseCatalog(data)
  assert.equal(items.length, 3)
  assert.equal(new Set(items.map(item => item.provider)).size, 3)
  assert.ok(items.every(item => item.name === item.id && item.id === 'test-model'))
  assert.deepEqual(parseCatalog({ items: [...data.items].reverse() }).map(item => item.provider).sort(), items.map(item => item.provider).sort())
})

test('first sync saves official providers via ConfigEditor, with secret references rather than keys', async t => {
  const h = await bindingFor(t)
  const items = await h.binding.update({ items: [row('研发 A'), row('研发 B', 'anthropic'), row('Responses', 'openai-response')] }, true)
  assert.equal(h.state.edits.length, 1)
  assert.equal(h.state.registrations[0].kind, 'prefix')
  assert.equal(h.state.registrations[0].path, '/novaflow/models/')
  const saved = h.state.entry.options.config.providers
  const parsed = officialProviders(saved)
  for (const item of items) {
    const profile = saved[item.provider]
    assert.equal(profile.apiKeyEnv, bridgeRef(item.provider))
    assert.equal(profile.models[0].name, item.id)
    assert.equal(profile.models[0].reasoningEfforts, false)
    assert.equal(parsed[item.provider].api, profile.api)
    assert.ok(profile.baseURL.startsWith('http://127.0.0.1:64661/novaflow/models/' + item.provider))
    const key = h.state.keys.get(profile.apiKeyEnv)
    assert.match(key, /^nfb_[A-Za-z0-9_-]{43}$/)
    assert.equal(JSON.stringify(saved).includes(key), false)
    assert.equal(JSON.stringify(h.state.records.get(ownerRecord)).includes(key), false)
  }
  assert.deepEqual(h.state.selection, { provider: items[0].provider, model: items[0].id })
  assert.equal(JSON.stringify(saved).includes('nfds_'), false)
  assert.equal(JSON.stringify(saved).includes('nfdr_'), false)
})

test('repeated sync preserves native edits, removals, reasoning preference and unrelated providers', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A', 'anthropic', 'claude-opus-4-6'), row('A', 'anthropic', 'claude-custom-model')] }
  const [item] = await h.binding.update(catalog, false)
  const profile = h.state.entry.options.config.providers[item.provider]
  profile.displayName = 'My custom provider'
  profile.reasoningEffort = 'low'
  profile.models = [{ ...profile.models[0], name: 'My model', contextWindow: 99999, maxTokens: 1234 }]
  h.state.entry.options.config.providers.unrelated = { api: 'openai-completions', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'UNRELATED_KEY', models: [{ id: 'other', contextWindow: 8192, maxTokens: 1024, reasoningEfforts: false }] }
  const before = clone(h.state.entry.options.config)
  const editCount = h.state.edits.length
  const selected = await h.binding.update(catalog, false)
  assert.deepEqual(h.state.entry.options.config, before)
  assert.equal(h.state.edits.length, editCount, 'no-op sync must not cause a ConfigEditor restart')
  assert.deepEqual(selected.map(value => value.id), ['claude-opus-4-6'])
})

test('deleted native provider stays deleted on background sync and explicit fresh sign-in reprovisions it', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A')] }
  const [item] = await h.binding.update(catalog, false)
  delete h.state.entry.options.config.providers[item.provider]
  assert.deepEqual(await h.binding.update(catalog, false), [])
  assert.equal(h.state.entry.options.config.providers[item.provider], undefined)
  assert.equal(h.state.keys.has(bridgeRef(item.provider)), false)
  assert.equal((await h.binding.update(catalog, true)).length, 1)
  assert.ok(h.state.entry.options.config.providers[item.provider])
})

test('restart updates the loopback port while preserving native profile edits and stable key', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A')] }
  const [item] = await h.binding.update(catalog, false)
  h.state.entry.options.config.providers[item.provider].models[0].name = 'User name'
  const key = h.state.keys.get(bridgeRef(item.provider))
  const restarted = harness({ state: h.state, origin: 'http://127.0.0.1:65432' })
  const next = await createModelBinding(restarted.ctx, restarted.account, config, libraries)
  t.after(() => next.clear(false))
  await next.update(catalog, false)
  const profile = h.state.entry.options.config.providers[item.provider]
  assert.equal(profile.baseURL, 'http://127.0.0.1:65432/novaflow/models/' + item.provider + '/v1')
  assert.equal(profile.models[0].name, 'User name')
  assert.equal(h.state.keys.get(bridgeRef(item.provider)), key)
})

test('sign-out removes local keys but keeps official editable config and restores the old default', async t => {
  const h = await bindingFor(t)
  const original = clone(h.state.selection)
  const items = await h.binding.update({ items: [row('A'), row('B')] }, true)
  const saved = clone(h.state.entry.options.config)
  h.state.selection = { provider: items[1].provider, model: items[1].id }
  await h.binding.clear()
  assert.equal(h.state.keys.size, 0)
  assert.deepEqual(h.state.entry.options.config, saved)
  assert.deepEqual(h.state.selection, original)
  assert.equal(h.state.records.has(defaultRecord), false)
  assert.ok(h.state.records.has(ownerRecord), 'ownership is retained to preserve native deletion intent')
})

test('logout preserves a later external default while unloading retains current NovaFlow default', async t => {
  const h = await bindingFor(t)
  await h.binding.update({ items: [row('A')] }, true)
  const current = clone(h.state.selection)
  await h.binding.clear(false)
  assert.deepEqual(h.state.selection, current)
  assert.ok(h.state.records.has(defaultRecord))
  h.state.selection = { provider: 'user-provider', model: 'user-model' }
  await h.binding.clear(true)
  assert.deepEqual(h.state.selection, { provider: 'user-provider', model: 'user-model' })
})

test('sync refuses an unmanaged profile collision instead of overwriting it', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A')] }, [item] = parseCatalog(catalog)
  h.state.entry.options.config.providers[item.provider] = { api: 'openai-completions', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'USER_KEY', models: [] }
  const before = clone(h.state.entry.options.config)
  await assert.rejects(h.binding.update(catalog, false), error => error.code === 'MODEL_CONFIG_CONFLICT')
  assert.deepEqual(h.state.entry.options.config, before)
  assert.equal(h.state.keys.size, 0)
})

test('repurposed provider connection is not overwritten or given a new bridge key', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A')] }, [item] = await h.binding.update(catalog, false)
  const profile = h.state.entry.options.config.providers[item.provider]
  profile.baseURL = 'https://user.example.invalid/v1'; profile.apiKeyEnv = 'USER_KEY'
  h.state.keys.set('USER_KEY', 'user-fixture-key')
  const before = clone(profile)
  assert.deepEqual(await h.binding.update(catalog, false), [])
  assert.deepEqual(h.state.entry.options.config.providers[item.provider], before)
  assert.equal(h.state.keys.get('USER_KEY'), 'user-fixture-key')
})

test('a failed initial configuration save can be retried without treating it as user deletion', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('retry')] }
  const save = h.ctx.configEditor.edit
  let fail = true
  h.ctx.configEditor.edit = async (...args) => { if (fail) { fail = false; throw Error('fixture write rejected') } return save(...args) }
  await assert.rejects(h.binding.update(catalog, false), error => error.code === 'MODEL_SETTINGS_WRITE_FAILED')
  const items = await h.binding.update(catalog, false)
  assert.equal(items.length, 1)
  assert.ok(h.state.entry.options.config.providers[items[0].provider])
})

test('manual external base URL is preserved even when its path resembles the bridge path', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A')] }, [item] = await h.binding.update(catalog, false)
  const profile = h.state.entry.options.config.providers[item.provider]
  profile.baseURL = 'https://user.example.invalid/novaflow/models/' + item.provider + '/v1'
  const before = clone(profile)
  assert.deepEqual(await h.binding.update(catalog, false), [])
  assert.deepEqual(h.state.entry.options.config.providers[item.provider], before)
})

test('unload clears without waiting for a queued ConfigEditor write and stale callback cannot recreate a profile or key', { timeout: 2000 }, async t => {
  const h = await bindingFor(t)
  let entered, release
  const queued = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const save = h.ctx.configEditor.edit
  h.ctx.configEditor.edit = async (...args) => { entered(); await gate; return save(...args) }
  const pending = h.binding.update({ items: [row('queued')] }, false)
  const settled = pending.then(value => ({ value }), error => ({ error }))
  await queued
  let timer
  try {
    await Promise.race([h.binding.clear(false), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('clear(false) waited on the same config queue')), 150) })])
    assert.equal(h.state.keys.size, 0)
    assert.deepEqual(h.state.entry.options.config.providers, {})
  } finally { clearTimeout(timer); release() }
  const result = await settled
  assert.ok(['CANCELLED', 'MODEL_SETTINGS_WRITE_FAILED'].includes(result.error?.code))
  assert.equal(h.state.keys.size, 0)
  assert.deepEqual(h.state.entry.options.config.providers, {})
})

for (const userKey of ['nfb_' + 'u'.repeat(43), 'manual-fixture-key']) {
  test(`sync and sign-out preserve a user-replaced ${userKey.startsWith('nfb_') ? 'bridge-shaped' : 'ordinary'} credential`, async t => {
    const h = await bindingFor(t)
    const catalog = { items: [row('A')] }, [item] = await h.binding.update(catalog, false)
    const ref = bridgeRef(item.provider)
    h.state.keys.set(ref, userKey)
    const before = clone(h.state.entry.options.config)
    assert.deepEqual(await h.binding.update(catalog, false), [])
    assert.equal(h.state.keys.get(ref), userKey)
    assert.deepEqual(h.state.entry.options.config, before)
    await h.binding.clear()
    assert.equal(h.state.keys.get(ref), userKey)
  })
}

test('sign-out preserves the credential after the user repurposes the profile to an external endpoint', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A')] }, [item] = await h.binding.update(catalog, false)
  const ref = bridgeRef(item.provider), key = h.state.keys.get(ref)
  h.state.entry.options.config.providers[item.provider].baseURL = 'https://user.example.invalid/v1'
  await h.binding.update(catalog, false)
  await h.binding.clear()
  assert.equal(h.state.keys.get(ref), key)
  assert.equal(h.state.entry.options.config.providers[item.provider].baseURL, 'https://user.example.invalid/v1')
})

test('unknown model capabilities remain reasoning false; known builtin metadata survives official Config', () => {
  const unknown = modelSeed({ id: 'unknown-fixture', api: 'openai-responses' }, config, libraries)
  assert.equal(unknown.reasoningEfforts, false)
  assert.equal(unknown.contextWindow, config.contextWindow)
  const claude = modelSeed({ id: 'claude-opus-4-6', api: 'anthropic-messages' }, config, libraries)
  assert.equal(claude.name, 'claude-opus-4-6')
  assert.equal(claude.compat.forceAdaptiveThinking, true)
  assert.equal(claude.reasoningEfforts.low, 'low'); assert.equal(claude.reasoningEfforts.high, 'high'); assert.equal(claude.reasoningEfforts.max, 'max')
  const openai = modelSeed({ id: 'gpt-5.4', api: 'openai-responses' }, config, libraries)
  assert.equal(openai.reasoningEfforts.low, 'low'); assert.equal(openai.reasoningEfforts.high, 'high'); assert.equal(openai.reasoningEfforts.xhigh, 'xhigh')
  assert.equal(Object.hasOwn(openai.reasoningEfforts, 'max'), false)
  const parsed = officialProviders({ claude: { api: 'anthropic-messages', baseURL: 'http://127.0.0.1:64661/novaflow/models/test', apiKeyEnv: 'TEST_KEY', models: [claude] }, openai: { api: 'openai-responses', baseURL: 'http://127.0.0.1:64661/novaflow/models/test/v1', apiKeyEnv: 'TEST_KEY', models: [openai, unknown] } })
  assert.deepEqual(parsed.claude.models[0].reasoningEfforts, claude.reasoningEfforts)
  assert.equal(parsed.openai.models[1].reasoningEfforts, false)
  assert.equal(nativeEfforts({ reasoning: false }), false)
})

// Exercise the installed official Host entry, not a hand-written profile resolver:
// Config -> official apply -> resolveProfiles/catalog -> PiAiAdapter -> native SDK.
// Optional settings/auth flows stay absent; all credential reads use a fixture.
function officialAdapter(id, api, configuredSeed) {
  const seed = configuredSeed || modelSeed({ id, api }, config, libraries)
  let adapter
  const handle = () => Object.assign(() => {}, { replace: () => {} })
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    inject: () => {}, on: () => () => {},
    get: key => key === 'credentials' ? { resolve: async ref => { assert.equal(ref, 'TEST_KEY'); return { value: 'nfb_fixture', source: 'fixture' } } } : undefined,
    waterfall: (_name, ...args) => args.at(-1)(),
    logger: { warn: () => {}, debug: () => {}, error: () => {} },
    llm: {
      registerConfigurableProviders: handle, registerModelDiscovery: () => () => {},
      registerAdapter: (providers, value) => { assert.deepEqual(providers, ['test']); adapter = value; return handle() },
    },
  }
  const baseURL = 'http://127.0.0.1:64661/novaflow/models/test' + (api === 'anthropic-messages' ? '' : '/v1')
  libraries.apply(ctx, libraries.Config({ providers: { test: { api, baseURL, apiKeyEnv: 'TEST_KEY', models: [seed] } } }))
  assert.ok(adapter)
  return adapter
}
const requestOptions = (model, effort) => ({ provider: 'test', model, reasoningEffort: effort, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })
async function consume(iterable) { for await (const ignored of iterable) void ignored }
for (const [model, api, efforts, path] of [
  ['claude-opus-4-6', 'anthropic-messages', ['low', 'high', 'max'], '/novaflow/models/test/v1/messages'],
  ['gpt-6.1-sol', 'openai-responses', ['low', 'high', 'max'], '/novaflow/models/test/v1/responses'],
  ['gpt-6.1-sol', 'openai-completions', ['high', 'max'], '/novaflow/models/test/v1/chat/completions'],
  ['deepseek-v4-pro', 'openai-completions', ['high', 'max'], '/novaflow/models/test/v1/chat/completions'],
]) {
  for (const effort of efforts) {
    test(`official Config and catalog send ${model} ${api} native ${effort} reasoning`, async t => {
      const originalFetch = globalThis.fetch
      t.after(() => { globalThis.fetch = originalFetch })
      const requests = []
      globalThis.fetch = async (url, init) => {
        const request = new Request(url, init)
        requests.push({ url: new URL(request.url), body: await request.json() })
        return new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'fixture-only' } }), { status: 401, headers: { 'content-type': 'application/json' } })
      }
      const adapter = officialAdapter(model, api)
      const modelInfo = await adapter.resolveModel('test', model)
      assert.ok(modelInfo.reasoning.efforts.some(value => value.id === effort))
      const call = await adapter.prepareCall('test', model)
      await consume(call.stream(requestOptions(model, effort)))
      assert.equal(requests.length, 1)
      assert.equal(requests[0].url.pathname, path)
      assert.equal(requests[0].body.model, model)
      if (api === 'anthropic-messages') {
        assert.equal(requests[0].body.output_config.effort, effort)
        assert.equal(requests[0].body.thinking.type, 'adaptive')
      } else if (api === 'openai-responses') {
        assert.equal(requests[0].body.reasoning.effort, effort)
      } else {
        assert.equal(requests[0].body.reasoning_effort, effort)
        if (model.startsWith('deepseek')) assert.equal(requests[0].body.thinking.type, 'enabled')
      }
    })
  }
}

test('configureAllModels uses family protocols with image and native effort profiles without resetting model lists', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A', 'anthropic', 'claude-opus-4-6'), row('A', 'anthropic', 'claude-deleted-model'), row('B', 'openai', 'unknown-model')] }
  const items = await h.binding.update(catalog, false)
  const first = h.state.entry.options.config.providers[items[0].provider]
  first.models = [first.models[0]]
  const beforeIds = Object.fromEntries(Object.entries(h.state.entry.options.config.providers).map(([id,profile]) => [id,profile.models.map(model => model.id)]))
  const result = await h.binding.configureAllModels()
  assert.equal(result.providerCount, 2); assert.equal(result.modelCount, 2)
  const saved = h.state.entry.options.config.providers
  const parsed = officialProviders(saved)
  for (const [provider, profile] of Object.entries(parsed)) {
    const expectedApi=protocolForModel(profile.models[0].id)
    assert.equal(profile.api, expectedApi)
    assert.ok(profile.baseURL.endsWith('/' + provider + (expectedApi==='anthropic-messages' ? '' : '/v1')))
    assert.deepEqual(profile.models.map(model => model.id), beforeIds[provider])
    for (const model of profile.models) {
      assert.deepEqual(model.input, ['text','image'])
      assert.deepEqual(model.reasoningEfforts, expectedApi==='anthropic-messages' ? modelSeed({id:model.id,api:expectedApi},config,libraries).reasoningEfforts : {off:'none',low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'max'})
      const raw = saved[provider].models.find(value => value.id === model.id)
      const metadata = await officialAdapter(model.id, profile.api, raw).resolveModel('test', model.id)
      assert.deepEqual(metadata.inputModalities, ['text','image'])
    }
  }
  await h.binding.update(catalog, false)
  assert.deepEqual(h.state.entry.options.config.providers, saved)
  const [newItem] = (await h.binding.update({ items:[...catalog.items,row('New','openai','new-unknown')] }, false)).filter(item => item.group === 'New')
  const newProfile = officialProviders(h.state.entry.options.config.providers)[newItem.provider]
  assert.equal(newProfile.api, 'openai-responses')
  assert.deepEqual(newProfile.models[0].input, ['text','image'])
  assert.equal(newProfile.models[0].reasoningEfforts.max, 'max')
})

test('enableAllCapabilities startup migration runs once, cleans incompatible protocol metadata, and preserves later native edits', async t => {
  const h = await bindingFor(t)
  const catalog = { items: [row('A','anthropic','claude-opus-4-6')] }
  const [item] = await h.binding.update(catalog, false)
  const old = h.state.entry.options.config.providers[item.provider]
  old.compat = {forceAdaptiveThinking:true}
  old.modelOverrides = {'claude-opus-4-6':{compat:{forceAdaptiveThinking:true}}}
  const migrated = await createModelBinding(h.ctx,h.account,{...config,enableAllCapabilities:true},libraries)
  t.after(()=>migrated.clear(false))
  await migrated.update(catalog,false)
  const profile = h.state.entry.options.config.providers[item.provider]
  assert.equal(profile.api,'anthropic-messages')
  assert.deepEqual(profile.models[0].input,['text','image'])
  assert.equal(profile.models[0].reasoningEfforts.max,'max')
  assert.equal(profile.compat.forceAdaptiveThinking,true)
  assert.equal(profile.models[0].compat.forceAdaptiveThinking,true)
  assert.equal(profile.modelOverrides['claude-opus-4-6'].compat.forceAdaptiveThinking,true)
  await officialAdapter(item.id,profile.api,profile.models[0]).resolveModel('test',item.id)
  assert.equal(h.state.records.get('novaflow-account/model-preferences').payload.allCapabilities,true)
  profile.models[0].input=['text']
  profile.models[0].reasoningEfforts=false
  const edited=clone(profile)
  await migrated.update(catalog,false)
  assert.deepEqual(h.state.entry.options.config.providers[item.provider],edited)
})

test('configured Responses image and max effort are serialized by the actual official SDK', async t => {
  const h = await bindingFor(t)
  const [item] = await h.binding.update({ items:[row('A','openai','gpt-6.1-sol')] }, false)
  await h.binding.configureAllModels()
  const profile = officialProviders(h.state.entry.options.config.providers)[item.provider]
  const adapter = officialAdapter(item.id, profile.api, h.state.entry.options.config.providers[item.provider].models[0])
  const metadata = await adapter.resolveModel('test',item.id)
  assert.deepEqual(metadata.inputModalities,['text','image'])
  assert.ok(metadata.reasoning.efforts.some(effort => effort.id === 'max'))
  // Image bytes are supplied at the SDK boundary; the official metadata and effort
  // resolution above stay real. Attachment-store integration is a separate tier.
  const originalFetch=globalThis.fetch
  t.after(()=>{globalThis.fetch=originalFetch})
  let body
  globalThis.fetch=async(url,init)=>{body=await new Request(url,init).json();return new Response(JSON.stringify({error:{message:'fixture-only'}}),{status:401,headers:{'content-type':'application/json'}})}
  const seed=profile.models[0]
  const model={id:seed.id,name:seed.name,provider:'test',api:'openai-responses',baseUrl:profile.baseURL,contextWindow:seed.contextWindow,maxTokens:seed.maxTokens,input:seed.input,reasoning:true,thinkingLevelMap:seed.reasoningEfforts,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}
  await consume(libraries.protocols['openai-responses'].streamSimple(model,{messages:[{role:'user',timestamp:0,content:[{type:'text',text:'describe'},{type:'image',data:'aGVsbG8=',mimeType:'image/png'}]}]},{apiKey:'nfb_fixture',reasoning:'max',maxRetries:0}))
  assert.equal(body.reasoning.effort,'max')
  assert.ok(body.input.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='input_image'&&part.image_url==='data:image/png;base64,aGVsbG8=')))
})

test('official catalog rejects unsupported DeepSeek low instead of flattening it into high', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let requests = 0
  globalThis.fetch = async () => { requests++; throw Error('No network should be attempted') }
  const adapter = officialAdapter('deepseek-v4-pro', 'openai-completions')
  const modelInfo = await adapter.resolveModel('test', 'deepseek-v4-pro')
  assert.equal(modelInfo.reasoning.efforts.some(value => value.id === 'low'), false)
  const call = await adapter.prepareCall('test', 'deepseek-v4-pro')
  await assert.rejects(consume(call.stream(requestOptions('deepseek-v4-pro', 'low'))), error => error.code === 'UNSUPPORTED_REASONING_EFFORT')
  assert.equal(requests, 0)
})

function legacyResponses(h,catalog) {
  const owners={version:1,providers:{}},profiles=h.state.entry.options.config.providers
  for(const item of parseCatalog(catalog)) {
    const ref=bridgeRef(item.provider),key='nfb_'+createHash('sha256').update(item.provider).digest('base64url')
    h.state.keys.set(ref,key)
    owners.providers[item.provider]={group:item.group,api:'openai-responses',ref,namesNormalized:true,provisioned:true,keyDigest:createHash('sha256').update(key).digest('hex')}
    profiles[item.provider] ||= {displayName:'Custom '+item.group,api:'openai-responses',apiKeyEnv:ref,baseURL:'http://127.0.0.1:64661/novaflow/models/'+item.provider+'/v1',models:[]}
    profiles[item.provider].models.push({...modelSeed({...item,api:'openai-responses'},config,libraries),input:['text','image'],reasoningEfforts:{off:'none',low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'max'},compat:{supportsDeveloperRole:true}})
  }
  h.state.records.set(ownerRecord,{kind:'grant',payload:owners})
  h.state.records.set('novaflow-account/model-preferences',{kind:'grant',payload:{api:'openai-responses',allCapabilities:true}})
  return profiles
}

test('family protocol selection recognizes Claude IDs including vendor prefixes without matching unrelated names',()=>{
  for(const id of ['claude-opus-4-6','Claude-Sonnet-4-5','anthropic/claude-haiku-4-5','anthropic:claude-opus-4-6','us.anthropic.claude-3-5-sonnet'])assert.equal(protocolForModel(id),'anthropic-messages',id)
  for(const id of ['gpt-6.1-sol','deepseek-v4-pro','gemini-pro','notclaude','claudette','unknown'])assert.equal(protocolForModel(id),'openai-responses',id)
})

test('new catalog and discovery split mixed legacy groups into family protocols regardless of advertised protocol',async t=>{
  const h=await bindingFor(t)
  const catalog={items:[row('mixed','openai','claude-opus-4-6'),row('mixed','openai','gpt-6.1-sol'),row('other','anthropic','deepseek-v4-pro')]}
  const items=await h.binding.update(catalog,false)
  assert.equal(items.length,3)
  assert.notEqual(items[0].provider,items[1].provider)
  for(const item of items)assert.equal(h.state.entry.options.config.providers[item.provider].api,protocolForModel(item.id))
  const handler=h.state.registrations[0].handler
  // The route allowlist is exercised by the separate real HTTP bridge suite.
  assert.equal(typeof handler,'function')
  const before=clone(h.state.entry.options.config)
  await h.binding.update({items:[...catalog.items].reverse()},false)
  assert.deepEqual(h.state.entry.options.config,before)
})

test('legacy pure Claude provider migrates in place with its key, names, image settings and native thinking metadata',async t=>{
  const h=await bindingFor(t),catalog={items:[row('old','anthropic','claude-opus-4-6')]}
  const profiles=legacyResponses(h,catalog),[id]=Object.keys(profiles),profile=profiles[id],key=h.state.keys.get(bridgeRef(id))
  Object.assign(profile.models[0],{name:'My Opus',contextWindow:77777,maxTokens:1234})
  profile.compat={supportsDeveloperRole:true,supportsStrictMode:true}
  profile.modelOverrides={'claude-opus-4-6':{compat:{supportsDeveloperRole:true},maxTokens:1024}}
  await h.binding.update(catalog,false)
  const saved=h.state.entry.options.config.providers[id]
  assert.equal(saved.api,'anthropic-messages');assert.ok(saved.baseURL.endsWith('/'+id))
  assert.equal(h.state.keys.get(bridgeRef(id)),key)
  assert.equal(saved.models[0].name,'My Opus');assert.equal(saved.models[0].contextWindow,77777);assert.equal(saved.models[0].maxTokens,1234)
  assert.deepEqual(saved.models[0].input,['text','image'])
  assert.equal(saved.models[0].reasoningEfforts.off,null);assert.equal(saved.models[0].reasoningEfforts.xhigh,undefined)
  assert.equal(saved.models[0].compat.forceAdaptiveThinking,true)
  assert.equal(saved.models[0].compat.supportsDeveloperRole,undefined)
  assert.deepEqual(saved.compat,{})
  assert.equal(saved.modelOverrides['claude-opus-4-6'].id,undefined)
  assert.equal(saved.modelOverrides['claude-opus-4-6'].reasoningEfforts,undefined)
  assert.equal(saved.modelOverrides['claude-opus-4-6'].maxTokens,1024)
  assert.equal(h.state.records.get(ownerRecord).payload.providers[id].protocolPolicy,PROTOCOL_POLICY)
  const adapter=officialAdapter('claude-opus-4-6',saved.api,saved.models[0])
  assert.ok((await adapter.resolveModel('test','claude-opus-4-6')).reasoning.efforts.some(effort=>effort.id==='max'))
})

test('legacy mixed provider splits atomically while preserving native deletions, overrides and default selection',async t=>{
  const h=await bindingFor(t),catalog={items:[row('mixed','openai','claude-opus-4-6'),row('mixed','openai','claude-deleted'),row('mixed','openai','gpt-6.1-sol')]}
  const profiles=legacyResponses(h,catalog),[source]=Object.keys(profiles)
  profiles[source].models=profiles[source].models.filter(model=>model.id!=='claude-deleted')
  profiles[source].models[0].name='Custom Opus'
  profiles[source].modelOverrides={'claude-opus-4-6':{maxTokens:1234},'gpt-6.1-sol':{maxTokens:2222}}
  h.state.selection={provider:source,model:'claude-opus-4-6'}
  h.state.records.set(defaultRecord,{kind:'grant',payload:{previous:{provider:'external',model:'old'},selected:clone(h.state.selection)}})
  const items=await h.binding.update(catalog,false),claude=items.find(item=>item.id==='claude-opus-4-6')
  assert.notEqual(claude.provider,source)
  const saved=h.state.entry.options.config.providers
  assert.equal(Object.keys(saved).length,2);assert.equal(h.state.edits.length,1)
  assert.equal(saved[source].api,'openai-responses');assert.deepEqual(saved[source].models.map(model=>model.id),['gpt-6.1-sol'])
  assert.equal(saved[claude.provider].api,'anthropic-messages');assert.deepEqual(saved[claude.provider].models.map(model=>model.id),['claude-opus-4-6'])
  assert.equal(saved[claude.provider].models[0].name,'Custom Opus')
  assert.deepEqual(Object.keys(saved[source].modelOverrides),['gpt-6.1-sol'])
  assert.deepEqual(Object.keys(saved[claude.provider].modelOverrides),['claude-opus-4-6'])
  assert.deepEqual(h.state.selection,{provider:claude.provider,model:claude.id})
  assert.deepEqual(h.state.records.get(defaultRecord).payload.selected,h.state.selection)
  assert.deepEqual(h.state.records.get(defaultRecord).payload.previous,{provider:'external',model:'old'})
  const edits=h.state.edits.length,before=clone(saved)
  await h.binding.update(catalog,false)
  assert.deepEqual(h.state.entry.options.config.providers,before);assert.equal(h.state.edits.length,edits)
  delete h.state.entry.options.config.providers[claude.provider]
  await h.binding.update(catalog,false)
  assert.equal(h.state.entry.options.config.providers[claude.provider],undefined)
  assert.equal(h.state.keys.has(bridgeRef(claude.provider)),false)
})

test('failed split migration retries from the unchanged native list instead of restoring deleted models',async t=>{
  const h=await bindingFor(t),catalog={items:[row('mixed','openai','claude-opus-4-6'),row('mixed','openai','claude-deleted'),row('mixed','openai','gpt-6.1-sol')]}
  const profiles=legacyResponses(h,catalog),[source]=Object.keys(profiles)
  profiles[source].models=profiles[source].models.filter(model=>model.id!=='claude-deleted')
  profiles[source].models[0].name='Preserved on retry'
  const edit=h.ctx.configEditor.edit;let fail=true
  h.ctx.configEditor.edit=async(...args)=>{if(fail){fail=false;throw Error('write failed fixture')}return edit(...args)}
  await assert.rejects(h.binding.update(catalog,false),error=>error.code==='MODEL_SETTINGS_WRITE_FAILED')
  const items=await h.binding.update(catalog,false),claude=items.find(item=>item.id==='claude-opus-4-6')
  assert.deepEqual(h.state.entry.options.config.providers[claude.provider].models.map(model=>model.id),['claude-opus-4-6'])
  assert.equal(h.state.entry.options.config.providers[claude.provider].models[0].name,'Preserved on retry')
})

for(const repurpose of ['key','url','deleted'])test('mixed legacy source '+repurpose+' prevents implicit split provisioning',async t=>{
  const h=await bindingFor(t),catalog={items:[row('mixed','openai','claude-opus-4-6'),row('mixed','openai','gpt-6.1-sol')]}
  const profiles=legacyResponses(h,catalog),[source]=Object.keys(profiles)
  if(repurpose==='key')h.state.keys.set(bridgeRef(source),'user-owned-key')
  if(repurpose==='url')profiles[source].baseURL='https://user.invalid/v1'
  if(repurpose==='deleted')delete profiles[source]
  const before=clone(profiles)
  assert.deepEqual(await h.binding.update(catalog,false),[])
  assert.deepEqual(h.state.entry.options.config.providers,before)
})

test('family migration preserves disabled thinking and unknown Claude does not claim adaptive support',async t=>{
  const h=await bindingFor(t),catalog={items:[row('Claude','openai','claude-unknown'),row('known','openai','claude-opus-4-6')]}
  const profiles=legacyResponses(h,catalog)
  for(const profile of Object.values(profiles))profile.models[0].reasoningEfforts=false
  await h.binding.update(catalog,false)
  for(const profile of Object.values(h.state.entry.options.config.providers))assert.equal(profile.models[0].reasoningEfforts,false)
  const unknown=Object.values(h.state.entry.options.config.providers).find(profile=>profile.models[0].id==='claude-unknown')
  assert.equal(unknown.models[0].compat.forceAdaptiveThinking,undefined)
})

test('migrated Claude image and max thinking use the actual Anthropic SDK messages serializer',async t=>{
  const h=await bindingFor(t),catalog={items:[row('old','openai','claude-opus-4-6')]}
  legacyResponses(h,catalog)
  const [item]=await h.binding.update(catalog,false),profile=officialProviders(h.state.entry.options.config.providers)[item.provider],seed=profile.models[0]
  const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch})
  let body,path
  globalThis.fetch=async(url,init)=>{const request=new Request(url,init);path=new URL(request.url).pathname;body=await request.json();return new Response(JSON.stringify({error:{message:'fixture-only'}}),{status:401,headers:{'content-type':'application/json'}})}
  const model={id:seed.id,name:seed.name,provider:'test',api:profile.api,baseUrl:profile.baseURL,contextWindow:seed.contextWindow,maxTokens:seed.maxTokens,input:seed.input,reasoning:true,thinkingLevelMap:seed.reasoningEfforts,compat:seed.compat,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}
  await consume(libraries.protocols['anthropic-messages'].streamSimple(model,{messages:[{role:'user',timestamp:0,content:[{type:'text',text:'describe'},{type:'image',data:'aGVsbG8=',mimeType:'image/png'}]}]},{apiKey:'nfb_fixture',reasoning:'max',maxRetries:0}))
  assert.equal(path,'/novaflow/models/'+item.provider+'/v1/messages')
  assert.equal(body.output_config.effort,'max');assert.equal(body.thinking.type,'adaptive')
  assert.ok(body.messages[0].content.some(part=>part.type==='image'&&part.source.type==='base64'))
})

for(const committed of [false,true])test('cancel Claude protocol migration '+(committed?'after':'before')+' config commit releases owned keys without waiting', {timeout:2000},async t=>{
  const h=await bindingFor(t),catalog={items:[row('old','openai','claude-opus-4-6')]}
  legacyResponses(h,catalog)
  let entered,release
  const gate=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{entered=resolve}),edit=h.ctx.configEditor.edit
  h.ctx.configEditor.edit=async(...args)=>{if(committed)await edit(...args);entered();await gate;if(!committed)await edit(...args)}
  const pending=h.binding.update(catalog,false).then(value=>({value}),error=>({error}))
  await ready
  try{await h.binding.clear(false);assert.equal(h.state.keys.size,0)}finally{release()}
  const result=await pending
  assert.ok(['CANCELLED','MODEL_SETTINGS_WRITE_FAILED'].includes(result.error?.code))
  assert.equal(h.state.keys.size,0)
})

test('a pre-existing unowned bridge-shaped child credential prevents split without takeover',async t=>{
  const h=await bindingFor(t),catalog={items:[row('mixed','openai','claude-opus-4-6'),row('mixed','openai','gpt-6.1-sol')]}
  const profiles=legacyResponses(h,catalog),[source]=Object.keys(profiles),before=clone(profiles)
  const child='novaflow-'+createHash('sha256').update(JSON.stringify([source,'anthropic-messages'])).digest('hex').slice(0,20),foreign='nfb_'+'u'.repeat(43)
  h.state.keys.set(bridgeRef(child),foreign)
  await assert.rejects(h.binding.update(catalog,false),error=>error.code==='MODEL_CONFIG_CONFLICT')
  assert.deepEqual(h.state.entry.options.config.providers,before)
  await h.binding.clear(true)
  assert.equal(h.state.keys.get(bridgeRef(child)),foreign)
  assert.equal(h.state.records.get(ownerRecord).payload.providers[child],undefined)
})

test('new source does not take over an unowned bridge-shaped credential',async t=>{
  const h=await bindingFor(t),catalog={items:[row('new','openai','gpt-6.1-sol')]},[item]=parseCatalog(catalog),foreign='nfb_'+'u'.repeat(43)
  h.state.keys.set(bridgeRef(item.provider),foreign)
  assert.deepEqual(await h.binding.update(catalog,false),[])
  await h.binding.clear(true)
  assert.equal(h.state.keys.get(bridgeRef(item.provider)),foreign)
  assert.deepEqual(h.state.entry.options.config.providers,{})
})

test('failed split reclaims unused child keys even when the source is deleted before retry',async t=>{
  const h=await bindingFor(t),catalog={items:[row('mixed','openai','claude-opus-4-6'),row('mixed','openai','gpt-6.1-sol')]}
  const profiles=legacyResponses(h,catalog),[source]=Object.keys(profiles),edit=h.ctx.configEditor.edit
  h.ctx.configEditor.edit=async()=>{throw Error('fixture failure')}
  await assert.rejects(h.binding.update(catalog,false),error=>error.code==='MODEL_SETTINGS_WRITE_FAILED')
  assert.deepEqual([...h.state.keys.keys()],[bridgeRef(source)])
  delete profiles[source];h.ctx.configEditor.edit=edit
  await h.binding.update(catalog,false)
  assert.ok([...h.state.keys.keys()].every(key=>key===bridgeRef(source)))
})

test('later native additions and partial overrides are retained on both family providers',async t=>{
  const h=await bindingFor(t),catalog={items:[row('mixed','openai','claude-opus-4-6'),row('mixed','openai','gpt-6.1-sol')]}
  const items=await h.binding.update(catalog,false),profiles=h.state.entry.options.config.providers
  const claude=items.find(item=>item.id.startsWith('claude')),gpt=items.find(item=>item.id.startsWith('gpt'))
  profiles[gpt.provider].models.push({id:'claude-custom-added',name:'Keep this native addition',reasoningEfforts:false})
  profiles[gpt.provider].modelOverrides={'claude-custom-added':{maxTokens:2345}}
  profiles[claude.provider].models.push({id:'gpt-custom-added',name:'Keep this too',reasoningEfforts:false})
  const before=clone(profiles)
  await h.binding.update(catalog,false)
  assert.deepEqual(h.state.entry.options.config.providers,before)
})

test('valid custom Claude effort mapping survives migration instead of receiving generated defaults',async t=>{
  const h=await bindingFor(t),catalog={items:[row('old','openai','claude-opus-4-6')]}
  const profiles=legacyResponses(h,catalog),[source]=Object.keys(profiles)
  profiles[source].models[0].reasoningEfforts={off:null,low:'medium',high:'max'}
  await h.binding.update(catalog,false)
  assert.deepEqual(h.state.entry.options.config.providers[source].models[0].reasoningEfforts,{off:null,low:'medium',high:'max'})
  assert.equal(protocolForModel('Claude 4.6'),'anthropic-messages')
})

test('saved profiles migrate offline without publishing cached models as bridge permissions or resetting capabilities',async t=>{
  const h=await bindingFor(t),catalog={items:[row('old','openai','claude-opus-4-6'),row('old','openai','gpt-6.1-sol')]}
  const profiles=legacyResponses(h,catalog),[source]=Object.keys(profiles)
  profiles[source].models[0].input=['text'];profiles[source].models[0].reasoningEfforts=false
  const setRoutes=h.binding.bridge.setRoutes;let published=0
  h.binding.bridge.setRoutes=()=>{published++}
  const result=await h.binding.migrateProtocols()
  assert.equal(result.providerCount,2);assert.equal(result.modelCount,2);assert.equal(result.capabilitiesReset,false)
  const claude=result.providers.find(profile=>profile.api==='anthropic-messages')
  assert.deepEqual(profiles[source].models.map(model=>model.id),['claude-opus-4-6','gpt-6.1-sol'],'fixture snapshot must not be mutated')
  const saved=h.state.entry.options.config.providers[claude.provider]
  assert.deepEqual(saved.models[0].input,['text']);assert.equal(saved.models[0].reasoningEfforts,false)
  assert.equal(published,0,'saved rows never become a live permission catalog')
  assert.equal(h.binding.summary().length,2)
  h.binding.bridge.setRoutes=setRoutes
  await h.binding.update(catalog,false)
  assert.equal(h.binding.summary().length,2)
})

test('explicit capability configuration works offline and still never publishes cached bridge routes',async t=>{
  const h=await bindingFor(t),catalog={items:[row('old','openai','claude-opus-4-6')]}
  legacyResponses(h,catalog)
  h.binding.bridge.setRoutes=()=>{throw Error('cached permissions must never be published')}
  const result=await h.binding.configureAllModels()
  assert.equal(result.capabilitiesReset,true)
  const profile=h.state.entry.options.config.providers[result.providers[0].provider]
  assert.equal(profile.api,'anthropic-messages');assert.deepEqual(profile.models[0].input,['text','image'])
})

test('protocol-only offline migration with missing preferences preserves capabilities through the next online refresh',async t=>{
  const h=await bindingFor(t),catalog={items:[row('old','openai','claude-opus-4-6'),row('other','openai','gpt-6.1-sol')]}
  const profiles=legacyResponses(h,catalog)
  h.state.records.delete('novaflow-account/model-preferences')
  for(const profile of Object.values(profiles)) {profile.models[0].input=['text'];profile.models[0].reasoningEfforts=false}
  const next=await createModelBinding(h.ctx,h.account,{...config,enableAllCapabilities:true},libraries)
  t.after(()=>next.clear(false))
  const result=await next.migrateProtocols()
  assert.equal(result.capabilitiesReset,false)
  await next.update(catalog,false)
  for(const profile of Object.values(h.state.entry.options.config.providers)) {
    assert.deepEqual(profile.models[0].input,['text']);assert.equal(profile.models[0].reasoningEfforts,false)
  }
  assert.equal(h.state.records.get('novaflow-account/model-preferences').payload.capabilitiesInitialized,true)
})

test('Responses migration preserves custom effort subsets and normalizes only off wire value',async t=>{
  const h=await bindingFor(t),catalog={items:[row('old','openai','gpt-6.1-sol')]}
  const profiles=legacyResponses(h,catalog),[source]=Object.keys(profiles)
  profiles[source].api='openai-completions'
  profiles[source].models[0].reasoningEfforts={off:null,high:'high'}
  await h.binding.migrateProtocols()
  const profile=h.state.entry.options.config.providers[source]
  assert.equal(profile.api,'openai-responses')
  assert.deepEqual(profile.models[0].reasoningEfforts,{off:'none',high:'high'})
})
