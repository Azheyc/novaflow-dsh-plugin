import { createRequire, findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { NovaError } from './protocol.js'
import { createModelBridge } from './model-bridge.js'

/** Resolve shipped libraries from this running installation, never another global DSH. */
export async function loadNativeLibraries() {
  const require = createRequire(import.meta.url)
  // DSH_INSTALL_DIR is injected into tool subprocesses, not guaranteed in the Host.
  // Desktop exposes its own resourcesPath; CLI exposes its entry script. Package
  // resolution verifies each candidate rather than relying on the current directory.
  const anchors = [process.env.DSH_INSTALL_DIR, process.argv[1], process.resourcesPath && resolve(process.resourcesPath, 'app.asar/dsh')].filter(Boolean)
  let entry
  for (const anchor of anchors) { try { entry = require.resolve('@deepseek-ai/dsh-llm-pi-ai', {paths:[anchor]}); break } catch {} }
  if (!entry) throw new NovaError('RUNTIME_UNSUPPORTED')
  const llmEntry = require.resolve('@deepseek-ai/dsh-llm', { paths: [dirname(entry)] })
  const manifestPath = findPackageJSON('@earendil-works/pi-ai', pathToFileURL(entry))
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const target = manifest.exports?.['./api/*']?.import
  if (typeof target !== 'string' || !target.startsWith('./')) throw new NovaError('RUNTIME_UNSUPPORTED')
  const api = async (name, factory) => {
    const module = await import(pathToFileURL(resolve(dirname(manifestPath), target.replace('*', name))).href)
    return module[factory]()
  }
  const [adapter, llm, completions, responses, anthropic] = await Promise.all([
    import(pathToFileURL(entry).href), import(pathToFileURL(llmEntry).href),
    api('openai-completions.lazy', 'openAICompletionsApi'), api('openai-responses.lazy', 'openAIResponsesApi'), api('anthropic-messages.lazy', 'anthropicMessagesApi'),
  ])
  const providerTarget = manifest.exports?.['./providers/*']?.import
  if (typeof providerTarget !== 'string' || !providerTarget.startsWith('./')) throw new NovaError('RUNTIME_UNSUPPORTED')
  const builtins = await import(pathToFileURL(resolve(dirname(manifestPath), providerTarget.replace('*', 'all'))).href)
  const {z}=await import(pathToFileURL(require.resolve('zod',{paths:[dirname(entry)]})).href)
  return { ...adapter, ...llm, z, getBuiltinModel: builtins.getBuiltinModel, protocols: { 'openai-completions': completions, 'openai-responses': responses, 'anthropic-messages': anthropic } }
}
export function parseCatalog(data) {
  if (!Array.isArray(data?.items) || data.items.length > 10000) throw new NovaError('INVALID_RESPONSE')
  const result = [], seen = new Set()
  for (const item of data.items) {
    if (!item || typeof item.group_id !== 'string' || !item.group_id || typeof item.model_id !== 'string' || !item.model_id || !Array.isArray(item.supported_endpoint_types)) throw new NovaError('INVALID_RESPONSE')
    const types = item.supported_endpoint_types
    // Only text conversation protocols belong in Harness's LLM selector.
    if (item.kind !== 'text') continue
    const api = types.includes('anthropic') ? 'anthropic-messages' : types.includes('openai-response') ? 'openai-responses' : types.includes('openai') ? 'openai-completions' : null
    if (!api) continue
    const provider = 'novaflow-' + createHash('sha256').update(JSON.stringify([item.group_id, api])).digest('hex').slice(0, 20)
    const key = JSON.stringify([provider,item.model_id]); if (seen.has(key)) continue; seen.add(key)
    result.push({ provider, id: item.model_id, name: item.model_id, group: item.group_id, api })
  }
  return result
}

const OWNER_RECORD = 'novaflow-account/native-providers'
const PREFERENCES_RECORD = 'novaflow-account/model-preferences'
const RESPONSE_EFFORTS = {off:'none',low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'max'}
const responseCompat = compat => Object.fromEntries(Object.entries(compat || {}).filter(([key])=>['supportsDeveloperRole','supportsMaxOutputTokens','supportsStrictMode','supportsLongCacheRetention'].includes(key)))
const responsesModel = model => ({...model,input:['text','image'],reasoningEfforts:{...RESPONSE_EFFORTS},compat:responseCompat(model.compat)})
const DEFAULT_RECORD = 'novaflow-account/default-model'
export const bridgeRef = provider => provider.toUpperCase().replaceAll('-', '_') + '_API_KEY'
const levels = ['off','minimal','low','medium','high','xhigh','max']
function managedURL(value, provider, api) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port && !url.username && !url.password && !url.search && !url.hash && [ '/novaflow/models/' + provider, '/novaflow/models/' + provider + '/v1' ].includes(url.pathname)
  } catch { return false }
}
export function nativeEfforts(base) {
  if (!base?.reasoning) return false
  const result = {}
  for (const level of levels) {
    const wire = base.thinkingLevelMap?.[level]
    if (wire === null || (['xhigh','max'].includes(level) && wire === undefined)) continue
    result[level] = typeof wire === 'string' ? wire : level === 'off' ? null : base.api === 'anthropic-messages' && base.compat?.forceAdaptiveThinking && level === 'minimal' ? 'low' : level
  }
  return result
}
export function modelSeed(item, config, libraries) {
  const providers = item.api === 'anthropic-messages' ? ['anthropic'] : item.api === 'openai-responses' ? ['openai'] : ['openai','deepseek','google']
  let base = providers.map(p => libraries.getBuiltinModel?.(p,item.id)).find(model => model?.api === item.api)
  // OpenAI publishes recent GPT capabilities on its Responses route, while gateways
  // may expose the same exact model through Chat Completions. Its effort vocabulary
  // is shared by those two OpenAI serializers; preserve the exact model's levels.
  const openai = libraries.getBuiltinModel?.('openai',item.id)
  if (!base && item.api === 'openai-completions' && openai?.api === 'openai-responses') base = openai
  const compat = {}
  for (const key of ['forceAdaptiveThinking','supportsTemperature','supportsReasoningEffort','thinkingFormat','maxTokensField','requiresReasoningContentOnAssistantMessages']) if (base?.compat?.[key] !== undefined) compat[key] = base.compat[key]
  if (item.api === 'openai-completions' && base?.api === 'openai-responses' && base.reasoning) compat.supportsReasoningEffort = true
  return { id:item.id, name:item.id, contextWindow:base?.contextWindow || config.contextWindow, maxTokens: Math.min(base?.maxTokens || config.maxTokens,config.maxTokens), input:['text'], reasoningEfforts:nativeEfforts(base), ...(Object.keys(compat).length ? {compat} : {}) }
}

/** Save connection facts through the same ConfigEditor as the official Models page.
 * All model editing, discovery, reasoning choices and request serialization belong
 * to the shipped llm-pi-ai provider. Only rotating device auth stays in the bridge. */
export async function createModelBinding(ctx, account, config, libraries) {
  const origin = ctx.webServer.getOrigin()
  const bridge = createModelBridge({account,origin})
  ctx.effect(() => ctx.webServer.register({kind:'prefix',path:'/novaflow/models/',handler:bridge.handler}))
  const entry = () => {
    const found = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai' && row.options.name === '@deepseek-ai/dsh-llm-pi-ai')
    if (!found) throw new NovaError('MODEL_SETTINGS_UNAVAILABLE')
    return found
  }
  let bridgeFacts = '', revision = 0, liveProviders = new Set()
  async function ownership() {
    const record = await ctx.credentials.readRecord(OWNER_RECORD)
    return record?.kind === 'grant' && record.payload?.version === 1 ? structuredClone(record.payload) : {version:1,providers:{}}
  }
  const saveOwnership = data => ctx.credentials.modifyRecord(OWNER_RECORD,async () => ({kind:'grant',payload:data}))
  const digest = key => createHash('sha256').update(key).digest('hex')
  async function releaseKey(provider, owner) {
    const profile = entry().options.config?.providers?.[provider]
    const ref = owner.ref || bridgeRef(provider)
    if (profile && (profile.apiKeyEnv !== ref || profile.api !== owner.api || !managedURL(profile.baseURL,provider,owner.api))) return
    const key = (await ctx.credentials.resolve(ref))?.value
    if (key && owner.keyDigest && digest(key) === owner.keyDigest) await ctx.credentials.unset(ref)
  }
  async function update(catalog, selectDefault) {
    const generation = revision
    const items = parseCatalog(catalog), owners = await ownership(), changes = [], routes = []
    const savedPreferences = await ctx.credentials.readRecord(PREFERENCES_RECORD)
    const preferences = savedPreferences?.kind === 'grant' ? savedPreferences.payload : null
    const setupPending = config.enableAllCapabilities === true && !preferences?.allCapabilities
    const liveEntry = entry()
    const current = liveEntry.options.config?.providers || {}
    for (const provider of new Set(items.map(item => item.provider))) {
      const rows = items.filter(item => item.provider === provider), item = rows[0]
      const ref = bridgeRef(provider)
      const prior = owners.providers[provider]
      const existing = current[provider]
      const api = setupPending ? 'openai-responses' : existing?.api || preferences?.api || item.api
      if (!['openai-completions','openai-responses','anthropic-messages'].includes(api)) continue
      const baseURL = origin + '/novaflow/models/' + provider + (api === 'anthropic-messages' ? '' : '/v1')
      if (!prior && existing) throw new NovaError('MODEL_CONFIG_CONFLICT')
      // Once a native provider is deleted, background synchronization leaves it deleted.
      // A fresh user sign-in explicitly provisions it again.
      if (prior?.provisioned && !existing && !selectDefault) continue
      if (existing && prior && (existing.apiKeyEnv !== ref || !managedURL(existing.baseURL,provider,api))) {
        continue // The user has repurposed this profile. Never overwrite it or its key.
      }
      let key = (await ctx.credentials.resolve(ref))?.value
      if (key && prior?.keyDigest && digest(key) !== prior.keyDigest) continue
      if (key && !key.startsWith('nfb_')) continue
      if (!key) key = 'nfb_' + randomBytes(32).toString('base64url')
      const models = existing?.models ? existing.models.map(model => setupPending ? responsesModel(model) : model) : rows.map(row => {
        const seed = modelSeed({...row,api},config,libraries)
        return setupPending || preferences?.allCapabilities ? responsesModel(seed) : seed
      })
      let next = existing ? {...existing,api,baseURL,models,...(setupPending ? {compat:responseCompat(existing.compat)} : {}),...(setupPending && existing.modelOverrides ? {modelOverrides:Object.fromEntries(Object.entries(existing.modelOverrides).map(([id,value])=>[id,responsesModel(value)]))} : {})} : {displayName:'NovaFlow · ' + item.group,api,baseURL,apiKeyEnv:ref,models,defaultContextWindow:config.contextWindow,defaultMaxTokens:config.maxTokens,transport:'sse'}
      // One-time migration of 2.0 platform-generated labels; user names thereafter remain theirs.
      if (existing && !prior?.namesNormalized) next = {...next,models:models.map(model => {
        const generated = rows.find(row => row.id === model.id)
        return generated && (model.name === model.id + '（' + item.group + '）' || model.name === model.id + ' (' + item.group + ')') ? {...model,name:model.id} : model
      })}
      if (!isDeepStrictEqual(existing,next)) changes.push({provider,next,expected:existing})
      owners.providers[provider] = {group:item.group,api,ref,namesNormalized:true,provisioned:!!existing,keyDigest:digest(key)}
      // The bridge catalog is the platform permission catalog, independent of the user's
      // native model selection. Get models can therefore add removed models again.
      routes.push({provider,api,group:item.group,key,models:rows.map(row => modelSeed({...row,api},config,libraries))})
    }
    if (generation !== revision) throw new NovaError('CANCELLED')
    await saveOwnership(owners)
    for (const route of routes) {
      if (generation !== revision) throw new NovaError('CANCELLED')
      await ctx.credentials.set(bridgeRef(route.provider),route.key)
      if (generation !== revision) { await ctx.credentials.unset(bridgeRef(route.provider)); throw new NovaError('CANCELLED') }
    }
    if (changes.length) try { await ctx.configEditor.edit(liveEntry, latest => {
      if (generation !== revision) throw new NovaError('CANCELLED')
      const providers = {...latest.providers}
      for (const change of changes) {
        if (!isDeepStrictEqual(providers[change.provider],change.expected)) throw new NovaError('MODEL_CONFIG_CONFLICT')
        providers[change.provider] = change.next
      }
      return {...latest,providers}
    }) } catch (error) { console.error('[novaflow-account] native model settings write failed'); throw new NovaError('MODEL_SETTINGS_WRITE_FAILED') }
    if (generation !== revision) throw new NovaError('CANCELLED')
    for (const route of routes) owners.providers[route.provider].provisioned = true
    await saveOwnership(owners)
    if (setupPending) await ctx.credentials.modifyRecord(PREFERENCES_RECORD,async()=>({kind:'grant',payload:{api:'openai-responses',allCapabilities:true}}))
    if (generation !== revision) throw new NovaError('CANCELLED')
    const facts = JSON.stringify(routes)
    if (facts !== bridgeFacts) { bridge.setRoutes(routes); bridgeFacts = facts }
    for (const provider of liveProviders) if (!routes.some(route => route.provider === provider) && owners.providers[provider]) await releaseKey(provider,owners.providers[provider])
    liveProviders = new Set(routes.map(route => route.provider))
    for (const provider of liveProviders) ctx.emit('llm/models-updated',provider)
    const nativeProfiles = entry().options.config?.providers || {}
    const selectedItems = items.filter(item => liveProviders.has(item.provider) && nativeProfiles[item.provider]?.models?.some(model => model.id === item.id))
    if (selectDefault && selectedItems.length) {
      const currentDefault = ctx.agentDefaultModel.currentSelection()
      if (!selectedItems.some(item => item.provider === currentDefault.provider && item.id === currentDefault.model)) {
        const selected = {provider:selectedItems[0].provider,model:selectedItems[0].id}
        await ctx.credentials.modifyRecord(DEFAULT_RECORD,async record => ({kind:'grant',payload:{previous:record?.kind === 'grant' && record.payload?.previous ? record.payload.previous : currentDefault,selected}}))
        await ctx.agentDefaultModel.saveSelection(selected)
      }
    }
    return selectedItems.map(({api,...item})=>item)
  }
  async function configureAllModels() {
    const generation = revision
    const owners = await ownership(), liveEntry = entry()
    const enhance = model => responsesModel({...model,name:model.id || model.name})
    let providerCount=0,modelCount=0
    await ctx.configEditor.edit(liveEntry, latest => {
      if (generation !== revision) throw new NovaError('CANCELLED')
      const providers={...latest.providers}
      for (const [provider, owner] of Object.entries(owners.providers)) {
        const profile=providers[provider]
        if (!profile || profile.apiKeyEnv !== owner.ref || !managedURL(profile.baseURL,provider,profile.api)) continue
        const models=(profile.models || []).map(enhance)
        const modelOverrides=Object.fromEntries(Object.entries(profile.modelOverrides || {}).map(([id,value])=>[id,enhance({...value,id})]))
        for(const value of Object.values(modelOverrides)) delete value.id
        providers[provider]={...profile,compat:responseCompat(profile.compat),api:'openai-responses',baseURL:origin+'/novaflow/models/'+provider+'/v1',models,...(Object.keys(modelOverrides).length ? {modelOverrides} : {})}
        owners.providers[provider]={...owner,api:'openai-responses'}
        providerCount++;modelCount+=models.length
      }
      return {...latest,providers}
    })
    if(generation !== revision) throw new NovaError('CANCELLED')
    await saveOwnership(owners)
    await ctx.credentials.modifyRecord(PREFERENCES_RECORD,async()=>({kind:'grant',payload:{api:'openai-responses',allCapabilities:true}}))
    return {providerCount,modelCount,api:'openai-responses',input:['text','image'],reasoningEfforts:Object.keys(RESPONSE_EFFORTS)}
  }
  async function clear(restore = true) {
    bridge.clear(); bridgeFacts=''
    const owners = await ownership()
    for (const [provider, facts] of Object.entries(owners.providers)) {
      // The private ref is owned by this bridge, while model configuration remains
      // available for editing in the official page after sign-out.
      await releaseKey(provider,facts)
      ctx.emit('llm/models-updated',provider)
    }
    liveProviders.clear()
    if (restore) {
      const record = await ctx.credentials.readRecord(DEFAULT_RECORD)
      const saved = record?.kind === 'grant' ? record.payload : null
      const selected = ctx.agentDefaultModel.currentSelection()
      if (saved?.previous && owners.providers[selected.provider]) await ctx.agentDefaultModel.saveSelection(saved.previous)
      await ctx.credentials.deleteRecord(DEFAULT_RECORD)
    }
  }
  let mutations = Promise.resolve()
  const serialize = operation => { const result=mutations.then(operation);mutations=result.catch(()=>{});return result }
  return {configureAllModels:()=>serialize(configureAllModels),summary: () => {
    const providers = entry().options.config?.providers || {}
    return [...liveProviders].map(provider => ({provider,api:providers[provider]?.api,modelCount:providers[provider]?.models?.length || 0,imageModelCount:(providers[provider]?.models || []).filter(model=>model.input?.includes('image')).length,reasoningModels:(providers[provider]?.models || []).filter(model => model.reasoningEfforts && model.reasoningEfforts !== false).map(model=>({id:model.id,efforts:Object.keys(model.reasoningEfforts)}))}))
  },update:(...args)=>serialize(async()=>{try{return await update(...args)}catch(error){bridge.clear();bridgeFacts='';throw error}}),clear:(restore=true)=>{revision++;bridge.clear();return restore ? serialize(()=>clear(true)) : clear(false)},bridge}
}
