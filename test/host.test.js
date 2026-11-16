import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config } from '../index.js'
import { RELEASE_VERSION } from '../src/release.js'

test('Host activates against actual installed libraries; management route is owner-only and schema bounded', async t => {
  const effects = [], routes = [], webRoutes = [], tools = [], records = new Map()
  let principal = {kind:'owner'}, interactions = 'answer', rejected = false, account
  let installationCalls=0
  const ctx = {
    get: () => undefined, provide: (name,value) => {if(name==='novaflowAccount')account=value}, emit: () => {},
    pluginManager:{listBundles:async()=>{installationCalls++;return ['dshmarket','dsh-ops','dsh-free-search','@michengai/dsh-archive-manager','dsh-rewind-plugin'].map(name=>({name,installed:true,enabled:true,version:'1.0.0'}))},installBundle:async()=>{throw Error('already installed must not install')}},
    storageDomain:{open:async spec=>{let value=spec.global.initial;return {global:{get:()=>value,set:async next=>{value=spec.global.schema.parse(next)}},close:async()=>{}}}},
    configEditor:{entries:()=>[{options:{id:'llm-pi-ai',name:'@deepseek-ai/dsh-llm-pi-ai',config:{providers:{}}}}],edit:async()=>{throw Error('signed-out startup must not edit providers')}},
    effect(fn) { const disposer = fn(); effects.push(disposer); return disposer },
    credentials: {readRecord: async key => records.get(key), modifyRecord: async (key,change) => {const next=await change(records.get(key));if(next!==undefined) records.set(key,next);return records.get(key)}, deleteRecord:async key=>records.delete(key),unset:async()=>{},resolve:async()=>undefined,set:async()=>{}},
    connection: {admit:()=> rejected ? {rejection:401} : {peer:{principal,interactions}},fetch:{register:route=>{routes.push(route);return async()=>{}}}},
    webServer: {getOrigin:()=> 'http://127.0.0.1:64661',register:route=>{webRoutes.push(route);return ()=>{}}},
    llm: {registerAdapter:()=>{throw new Error('signed-out startup must not add any models')}},
    agentDefaultModel: {currentSelection:()=>({provider:'existing',model:'existing'}),saveSelection:async()=>{throw new Error('signed-out startup must not change defaults')}},
    workingDirectory:{defaultDirectory:'/tmp'},
    mcpManager:{list:()=>[{name:'magpie-image',status:{state:'connected',toolCount:4}}],register:(name,config)=>{assert.equal(name,'magpie-image');assert.equal(config.transport,'streamable-http');assert.match(config.url,/\/novaflow\/magpie-image\/mcp$/);return ()=>{}}},
    tools:{register:tool=>{tools.push(tool);return ()=>{}}},
  }
  t.after(async()=>{for(const dispose of effects.reverse()) if(typeof dispose==='function') await dispose()})
  await apply(ctx,Config({}))
  assert.equal(routes.length,1); assert.equal(webRoutes.length,3); assert.equal(tools.length,1)
  const fetch=routes[0].fetch
  const request=(body,type='application/json')=>new Request('http://127.0.0.1:64661/api/novaflow-account',{method:'POST',headers:{'content-type':type},body})
  const state=await (await fetch(request('{"action":"state"}'))).json()
  assert.equal(state.ok,true);assert.equal(state.value.connected,false);assert.equal(state.value.hasCredential,false);assert.equal(state.value.media.defaultImageModel,'gpt-image-2.6');assert.equal(state.value.media.videoModelRequired,true);assert.equal(state.value.media.mcp.toolCount,4)
  assert.equal((await fetch(request('{"action":"state"}','text/plain'))).status,415)
  assert.equal((await fetch(request('{"action":"state","token":"do-not-accept"}'))).status,400)
  assert.equal((await fetch(request('bad json'))).status,400)
  rejected=true;assert.equal((await fetch(request('{"action":"state"}'))).status,403);rejected=false
  interactions='none';assert.equal((await fetch(request('{"action":"state"}'))).status,403);interactions='answer'
  principal={kind:'other'};assert.equal((await fetch(request('{"action":"state"}'))).status,403);principal={kind:'owner'}
  assert.deepEqual(tools[0].parameters.properties.action.enum,['state','refresh','cancel','signout','configure_models','retry_plugins','migrate_protocols'])
  assert.equal((await tools[0].execute({action:'start'})).error.code,'INVALID_REQUEST')
  assert.equal((await tools[0].execute({action:'state'})).value.connected,false)
  let status,body
  const res={setHeader:()=>{},writeHead:n=>{status=n},end:value=>{body=value}}
  await webRoutes.find(route=>route.path==='/novaflow/callback').handler({method:'GET',headers:{host:'evil.example'},url:'/novaflow/callback'},res)
  assert.equal(status,400);assert.equal(body,'Invalid NovaFlow callback.')
  account.publish({connected:true,hasCredential:true})
  const connected=await tools[0].execute({action:'state'})
  assert.equal(connected.value.pluginSetup.confirmationRequired,true)
  assert.equal(connected.value.delivery.version,RELEASE_VERSION)
  const id=connected.value.pluginSetup.confirmationId
  await tools[0].execute({action:'retry_plugins'})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(installationCalls,0,'login, state and retry request must not inspect or install before confirmation')
  assert.equal((await tools[0].execute({action:'confirm_plugins',confirmationId:id})).error.code,'USER_CONFIRMATION_REQUIRED')
  const confirmed=await (await fetch(request(JSON.stringify({action:'confirm_plugins',confirmationId:id})))).json()
  assert.equal(confirmed.ok,true);assert.equal(confirmed.value.pluginSetup.running,true)
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve))
  assert.ok(installationCalls>0,'interactive confirmation admits official installer inventory')
  const stale=await (await fetch(request(JSON.stringify({action:'confirm_plugins',confirmationId:id})))).json()
  assert.equal(stale.ok,false);assert.equal(stale.error.code,'INSTALL_CONFIRMATION_EXPIRED')
})
