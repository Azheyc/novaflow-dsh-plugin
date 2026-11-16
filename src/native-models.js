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
export const PROTOCOL_POLICY = 'claude-messages-v2'
export const protocolForModel = id => /(?:^|[/:.])claude(?:$|[-_.:@/\s])/i.test(id) ? 'anthropic-messages' : 'openai-responses'
const anthropicCompat = compat => Object.fromEntries(Object.entries(compat || {}).filter(([key])=>['forceAdaptiveThinking','supportsTemperature','supportsLongCacheRetention','supportsEagerToolInputStreaming','supportsCacheControlOnTools','allowEmptySignature','supportsStrictTools'].includes(key)))
function protocolModel(model, api, config, libraries, allCapabilities) {
  if (api === 'openai-responses') {
    const converted = {...model,compat:responseCompat(model.compat)}
    if (allCapabilities) return responsesModel(converted)
    if (model.reasoningEfforts) {
      const allowed=new Set(['none','minimal','low','medium','high','xhigh','max',null])
      const efforts=Object.fromEntries(Object.entries(model.reasoningEfforts).map(([key,value])=>[key,key==='off' && value===null ? 'none' : value]).filter(([,value])=>allowed.has(value)))
      converted.reasoningEfforts=Object.keys(efforts).length ? efforts : false
    }
    return converted
  }
  const seed = modelSeed({id:model.id,api},config,libraries)
  let efforts=seed.reasoningEfforts
  if (!allCapabilities && model.reasoningEfforts===false) efforts=false
  else if (!allCapabilities && model.reasoningEfforts) {
    const allowed=new Set(Object.values(seed.reasoningEfforts || {}))
    const filtered=Object.fromEntries(Object.entries(model.reasoningEfforts).map(([key,value])=>[key,key==='off' && value==='none' ? null : value]).filter(([,value])=>allowed.has(value)))
    efforts=Object.keys(filtered).length ? filtered : false
  }
  return {...model,...(allCapabilities ? {input:['text','image']} : {}),reasoningEfforts:efforts,compat:{...anthropicCompat(model.compat),...seed.compat}}
}
function familyGroups(items, owners, profiles) {
  const groups=[]
  for (const source of new Set(items.map(item=>item.provider))) {
    const rows=items.filter(item=>item.provider===source), profile=profiles[source], owner=owners.providers[source]
    const ids=[...rows.map(row=>row.id),...(!owner?.protocolPolicy ? [...(profile?.models || []).map(model=>model.id),...Object.keys(profile?.modelOverrides || {})] : [])]
    const apis=new Set(ids.map(protocolForModel))
    const primary=owner?.familyApi || (apis.size===1 ? [...apis][0] : rows[0].api==='anthropic-messages' ? 'anthropic-messages' : 'openai-responses')
    for (const api of apis) {
      const provider=api===primary ? source : 'novaflow-'+createHash('sha256').update(JSON.stringify([source,api])).digest('hex').slice(0,20)
      groups.push({source,provider,api,group:rows[0].group,rows:rows.filter(row=>protocolForModel(row.id)===api).map(row=>({...row,provider,api}))})
    }
  }
  return groups
}
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
  const metadataId=item.api==='anthropic-messages' && protocolForModel(item.id)==='anthropic-messages' ? item.id.slice(item.id.toLowerCase().lastIndexOf('claude')).toLowerCase() : item.id
  let base = providers.map(p => libraries.getBuiltinModel?.(p,metadataId)).find(model => model?.api === item.api)
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
    if (profile && (profile.apiKeyEnv !== ref || ![owner.api,owner.pendingApi].includes(profile.api) || !managedURL(profile.baseURL,provider,profile.api))) return
    const key = (await ctx.credentials.resolve(ref))?.value
    if (key && owner.keyDigest && digest(key) === owner.keyDigest) await ctx.credentials.unset(ref)
  }
  let lastCatalog, lastConfigured
  async function update(catalog, selectDefault, {force=false,ownedItems,protocolsOnly=false}={}) {
    const generation = revision
    const sourceItems = ownedItems || parseCatalog(catalog), owners = await ownership(), changes = [], routes = []
    if (!ownedItems) lastCatalog = structuredClone(catalog)
    const savedPreferences = await ctx.credentials.readRecord(PREFERENCES_RECORD)
    const preferences = savedPreferences?.kind === 'grant' ? savedPreferences.payload : null
    const setupPending = !protocolsOnly && config.enableAllCapabilities === true && !preferences?.allCapabilities && !preferences?.capabilitiesInitialized
    const allCapabilities = force || setupPending || preferences?.allCapabilities === true
    const liveEntry = entry(), current = liveEntry.options.config?.providers || {}
    const groups = familyGroups(sourceItems,owners,current)
    const guarded = new Map()
    // Resolve ownership once before constructing split profiles. A changed source
    // connection/key must never be copied into a new managed child provider.
    for (const source of new Set(groups.map(group=>group.source))) {
      const prior=owners.providers[source], profile=current[source], ref=bridgeRef(source)
      if (!prior && profile) throw new NovaError('MODEL_CONFIG_CONFLICT')
      const key=(await ctx.credentials.resolve(ref))?.value
      guarded.set(source,!(profile && (profile.apiKeyEnv!==ref || !managedURL(profile.baseURL,source,profile.api))) && !(key && (!prior?.keyDigest || digest(key)!==prior.keyDigest || !key.startsWith('nfb_'))))
    }
    for (const group of groups) {
      const {provider,source,rows,group:groupId}=group
      const ref=bridgeRef(provider), prior=owners.providers[provider], existing=current[provider]
      if (!prior && existing) throw new NovaError('MODEL_CONFIG_CONFLICT')
      if (prior?.provisioned && !existing && !selectDefault) continue
      const inherit=provider!==source && !existing && !prior?.provisioned
      if ((!existing || provider===source) && !guarded.get(source)) continue
      if (inherit && owners.providers[source]?.provisioned && !current[source] && !selectDefault) continue
      if (existing && (existing.apiKeyEnv!==ref || !managedURL(existing.baseURL,provider,existing.api))) continue
      let key=(await ctx.credentials.resolve(ref))?.value
      if (key && (!prior?.keyDigest || digest(key)!==prior.keyDigest || !key.startsWith('nfb_'))) {
        if (provider!==source && !existing) throw new NovaError('MODEL_CONFIG_CONFLICT')
        continue
      }
      if (!key) key='nfb_'+randomBytes(32).toString('base64url')
      const template=existing || (inherit ? current[source] : undefined)
      const migrate=force || prior?.protocolPolicy!==PROTOCOL_POLICY
      const api=migrate ? group.api : existing?.api || group.api
      if (!['openai-completions','openai-responses','anthropic-messages'].includes(api)) continue
      const convert=migrate || force || setupPending || !template || template.api!==api
      const enhanceCapabilities=force || setupPending || (!template && (allCapabilities || config.enableAllCapabilities===true))
      const partition=inherit || prior?.protocolPolicy!==PROTOCOL_POLICY
      const selectModel=model=>!partition || protocolForModel(model.id)===group.api
      const models=template?.models ? template.models.filter(selectModel).map(model=>convert ? protocolModel(model,api,config,libraries,enhanceCapabilities) : model) : rows.map(row=>{
        const seed=modelSeed({...row,api},config,libraries)
        return protocolModel(seed,api,config,libraries,enhanceCapabilities)
      })
      const baseURL=origin+'/novaflow/models/'+provider+(api==='anthropic-messages'?'':'/v1')
      let next=template ? {...template,api,baseURL,apiKeyEnv:ref,models} : {displayName:'NovaFlow · '+groupId,api,baseURL,apiKeyEnv:ref,models,defaultContextWindow:config.contextWindow,defaultMaxTokens:config.maxTokens,transport:'sse'}
      if (template?.modelOverrides) {
        next.modelOverrides=Object.fromEntries(Object.entries(template.modelOverrides).filter(([id])=>selectModel({id})).map(([id,value])=>{
          const converted=convert ? protocolModel({...value,id},api,config,libraries,enhanceCapabilities) : {...value}
          // Overrides are partial. Absent fields must keep inheriting the model.
          if (!enhanceCapabilities && !Object.hasOwn(value,'reasoningEfforts')) delete converted.reasoningEfforts
          if (!Object.hasOwn(value,'compat')) delete converted.compat
          delete converted.id
          return [id,converted]
        }))
      }
      if (convert && template) next.compat=api==='anthropic-messages' ? anthropicCompat(template.compat) : responseCompat(template.compat)
      if (template && !prior?.namesNormalized) next={...next,models:models.map(model=>{
        const generated=rows.find(row=>row.id===model.id)
        return generated && (model.name===model.id+'（'+groupId+'）' || model.name===model.id+' ('+groupId+')') ? {...model,name:model.id} : model
      })}
      if (!isDeepStrictEqual(existing,next)) changes.push({provider,next,expected:existing})
      owners.providers[provider]={...prior,group:groupId,api:existing?.api || api,pendingApi:api,ref,namesNormalized:true,provisioned:!!existing,keyDigest:digest(key),sourceProvider:source,familyApi:group.api}
      // Discovery also follows family routing, while removed native models stay removed.
      routes.push({provider,api,group:groupId,key,models:rows.map(row=>protocolModel(modelSeed({...row,api},config,libraries),api,config,libraries,allCapabilities))})
    }
    if (generation !== revision) throw new NovaError('CANCELLED')
    await saveOwnership(owners)
    for (const route of routes) {
      if (generation !== revision) throw new NovaError('CANCELLED')
      await ctx.credentials.set(bridgeRef(route.provider),route.key)
      if (generation !== revision) { await ctx.credentials.unset(bridgeRef(route.provider)); throw new NovaError('CANCELLED') }
    }
    if (changes.length) try { await ctx.configEditor.edit(liveEntry, latest=>{
      if (generation !== revision) throw new NovaError('CANCELLED')
      const providers={...latest.providers}
      // Split profiles were derived from this exact source configuration.
      for (const group of groups) if (changes.some(change=>change.provider===group.provider) && !isDeepStrictEqual(providers[group.source],current[group.source])) throw new NovaError('MODEL_CONFIG_CONFLICT')
      for (const change of changes) {
        if (!isDeepStrictEqual(providers[change.provider],change.expected)) throw new NovaError('MODEL_CONFIG_CONFLICT')
        providers[change.provider]=change.next
      }
      return {...latest,providers}
    }) } catch { console.error('[novaflow-account] native model settings write failed'); throw new NovaError('MODEL_SETTINGS_WRITE_FAILED') }
    if (generation !== revision) throw new NovaError('CANCELLED')
    for (const route of routes) {
      Object.assign(owners.providers[route.provider],{api:route.api,provisioned:true,protocolPolicy:PROTOCOL_POLICY})
      delete owners.providers[route.provider].pendingApi
    }
    await saveOwnership(owners)
    await ctx.credentials.modifyRecord(PREFERENCES_RECORD,async()=>({kind:'grant',payload:{protocolPolicy:PROTOCOL_POLICY,allCapabilities:!!allCapabilities,capabilitiesInitialized:!!(force || setupPending || protocolsOnly || preferences?.capabilitiesInitialized)}}))
    if (generation !== revision) throw new NovaError('CANCELLED')
    const plannedProviders=new Set(routes.map(route=>route.provider))
    if (!ownedItems) {
      const facts=JSON.stringify(routes)
      if (facts!==bridgeFacts) { bridge.setRoutes(routes);bridgeFacts=facts }
      for (const provider of liveProviders) if (!plannedProviders.has(provider) && owners.providers[provider]) await releaseKey(provider,owners.providers[provider])
      liveProviders=plannedProviders
    }
    for (const provider of plannedProviders) ctx.emit('llm/models-updated',provider)
    const nativeProfiles=entry().options.config?.providers || {}
    lastConfigured={providers:[...plannedProviders].map(provider=>({provider,api:nativeProfiles[provider]?.api,modelIds:(nativeProfiles[provider]?.models || []).map(model=>model.id)}))}
    const selectedItems=groups.flatMap(group=>group.rows).filter(item=>plannedProviders.has(item.provider) && nativeProfiles[item.provider]?.models?.some(model=>model.id===item.id))
    let currentDefault=ctx.agentDefaultModel.currentSelection()
    const moved=groups.find(group=>group.source===currentDefault.provider && group.provider!==group.source && plannedProviders.has(group.provider) && nativeProfiles[group.provider]?.models?.some(model=>model.id===currentDefault.model))
    if (moved && !nativeProfiles[currentDefault.provider]?.models?.some(model=>model.id===currentDefault.model)) {
      currentDefault={...currentDefault,provider:moved.provider}
      await ctx.agentDefaultModel.saveSelection(currentDefault)
      await ctx.credentials.modifyRecord(DEFAULT_RECORD,async record=>record?.kind==='grant' && record.payload?.selected ? {...record,payload:{...record.payload,selected:currentDefault}} : undefined)
    }
    if (selectDefault && selectedItems.length && !selectedItems.some(item=>item.provider===currentDefault.provider && item.id===currentDefault.model)) {
      const selected={provider:selectedItems[0].provider,model:selectedItems[0].id}
      await ctx.credentials.modifyRecord(DEFAULT_RECORD,async record=>({kind:'grant',payload:{previous:record?.kind==='grant' && record.payload?.previous ? record.payload.previous : currentDefault,selected}}))
      await ctx.agentDefaultModel.saveSelection(selected)
    }
    return selectedItems.map(({api,...item})=>item)
  }
  async function updateSafely(...args) {
    try { return await update(...args) } catch(error) {
      bridge.clear();bridgeFacts=''
      // A failed split must not leave a new, unused child credential behind.
      const owners=await ownership().catch(()=>null)
      for(const [provider,facts] of Object.entries(owners?.providers || {})) {
        if(!facts.provisioned && !entry().options.config?.providers?.[provider]) await releaseKey(provider,facts).catch(()=>{})
      }
      throw error
    }
  }
  async function configureAllModels(force=true) {
    if (lastCatalog) await updateSafely(lastCatalog,false,{force,protocolsOnly:!force})
    else {
      const owners=await ownership(),profiles=entry().options.config?.providers || {},items=[],seen=new Set()
      for (const [provider,owner] of Object.entries(owners.providers)) {
        const profile=profiles[provider]
        if (!profile) continue
        const source=owner.sourceProvider || provider
        for (const id of [...(profile.models || []).map(model=>model.id),...Object.keys(profile.modelOverrides || {})]) {
          const key=JSON.stringify([source,id])
          if (!seen.has(key)) {seen.add(key);items.push({provider:source,id,name:id,group:owner.group,api:profile.api})}
        }
      }
      // Saved configuration can be edited without a device grant. These rows are
      // never installed as bridge permissions; only a fresh platform catalog may do so.
      await updateSafely({items:[]},false,{force,ownedItems:items,protocolsOnly:!force})
    }
    const providers=lastConfigured?.providers || []
    return {providerCount:providers.length,modelCount:providers.reduce((count,profile)=>count+profile.modelIds.length,0),protocolPolicy:PROTOCOL_POLICY,apis:['anthropic-messages','openai-responses'],capabilitiesReset:force,...(force ? {input:['text','image']} : {}),providers}
  }
  async function clear(restore = true) {
    bridge.clear(); bridgeFacts=''; lastCatalog=undefined; lastConfigured=undefined
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
  return {configureAllModels:()=>serialize(configureAllModels),migrateProtocols:()=>serialize(()=>configureAllModels(false)),summary: () => {
    const providers = entry().options.config?.providers || {}
    return [...new Set([...liveProviders,...(lastConfigured?.providers || []).map(profile=>profile.provider)])].filter(provider=>providers[provider]).map(provider => ({provider,api:providers[provider].api || null,modelCount:providers[provider]?.models?.length || 0,imageModelCount:(providers[provider]?.models || []).filter(model=>model.input?.includes('image')).length,reasoningModels:(providers[provider]?.models || []).filter(model => model.reasoningEfforts && model.reasoningEfforts !== false).map(model=>({id:model.id,efforts:Object.keys(model.reasoningEfforts)}))}))
  },update:(...args)=>serialize(()=>updateSafely(...args)),clear:(restore=true)=>{revision++;bridge.clear();return restore ? serialize(()=>clear(true)) : clear(false)},bridge}
}
