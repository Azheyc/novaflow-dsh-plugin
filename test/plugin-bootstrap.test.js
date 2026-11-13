import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginBootstrap, PLUGIN_REGISTRY, RECOMMENDED_PLUGINS, openBootstrapState } from '../src/plugin-bootstrap.js'
import { loadNativeLibraries } from '../src/native-models.js'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require=createRequire(import.meta.url)
const {UNIT_NAME_RE}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-storage',{paths:[process.env.DSH_INSTALL_DIR]})).href)
const {defineDomain}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-storage-domain',{paths:[process.env.DSH_INSTALL_DIR]})).href)

const NAMES = ['dshmarket','dsh-ops','dsh-free-search','@michengai/dsh-archive-manager','dsh-rewind-plugin']
const REGISTRY = 'https://registry.npmmirror.com'
const clone = value => structuredClone(value)
function deferred() { let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject} }
const turn = () => new Promise(resolve=>setImmediate(resolve))
function initial(overrides={}) { return {version:1,attempted:false,running:false,registry:REGISTRY,items:NAMES.map(name=>({name,label:RECOMMENDED_PLUGINS.find(row=>row.name===name).label,status:'pending'})),...overrides} }
function fixture(options={}) {
  let connected=options.connected ?? true, value=clone(options.saved), installs=[]
  const writes=[],changes=[],calls=[],preflights=[]
  const manager={
    async listBundles(){calls.push(['listBundles']);return clone(options.list?await options.list():options.bundles || [])},
    async inspect(name,settings){calls.push(['inspect',name,clone(settings)]);return options.inspect?options.inspect(name,settings):{status:'accepted',name,version:'1.2.3',bundle:true}},
    async installBundle(spec,settings){const call={spec,settings:clone(settings)};installs.push(call);calls.push(['install',spec,clone(settings)]);return options.install?options.install(spec,settings):{application:'applied',version:'1.2.3'}},
    async waitForInstall(id){calls.push(['waitForInstall',id]);return options.wait?options.wait(id):undefined},
    setVersionExemption(){throw Error('bootstrap must never grant version exemptions')},
    setPlugin(){throw Error('bootstrap must never force-enable existing plugins')},
    setBundle(){throw Error('bootstrap must never force-enable existing bundles')},
  }
  const store={get:()=>clone(value),set:async next=>{value=clone(next);writes.push(clone(next));await options.onWrite?.(next)}}
  const bootstrap=new PluginBootstrap({manager,store,isConnected:()=>connected,onChange:state=>changes.push(clone(state)),platform:options.platform || 'darwin',preflight:async input=>{preflights.push(clone(input));return options.preflight?options.preflight(input):{status:'managed-by-dsh'}}})
  return {bootstrap,manager,store,calls,writes,changes,preflights,get value(){return clone(value)},get installs(){return installs},setConnected:next=>{connected=next}}
}
async function idle(bootstrap) {
  // One immediate admits kick(); its managed promise owns all later work. No sleeps.
  await turn()
  if(bootstrap.work)await bootstrap.work
  await turn()
}
const item=(h,name)=>h.bootstrap.snapshot().items.find(row=>row.name===name)

test('only the exact five allowlisted package names are inspected and installed through the fixed mirror',async()=>{
  assert.deepEqual(RECOMMENDED_PLUGINS.map(row=>row.name),NAMES);assert.equal(PLUGIN_REGISTRY,REGISTRY)
  const h=fixture();h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.installs.length,5)
  assert.deepEqual(h.installs.map(call=>call.spec),NAMES.map(name=>name+'@1.2.3'))
  for(const [index,call]of h.installs.entries()){
    assert.equal(call.settings.registry,REGISTRY);assert.equal(call.settings.enabled,true);assert.equal(call.settings.saveExact,true)
    assert.deepEqual(call.settings.expected,{name:NAMES[index],version:'1.2.3'})
    assert.match(call.settings.requestId,/^novaflow-bootstrap-[0-9a-f-]+$/)
    assert.equal(Object.hasOwn(call.settings,'approvedBuilds'),false);assert.equal(Object.hasOwn(call.settings,'acceptRisk'),false)
  }
  assert.ok(h.calls.filter(call=>call[0]==='inspect').every(call=>call[2].registry===REGISTRY))
  assert.ok(h.bootstrap.snapshot().items.every(row=>row.status==='installed'))
  assert.equal(h.value.attempted,true);assert.equal(h.value.running,false)
  assert.ok(h.writes.length>0&&h.changes.length>0)
})

test('public bootstrap snapshots remain lossless JSON after optional status fields are cleared',async()=>{
  const h=fixture();h.bootstrap.kick();await idle(h.bootstrap)
  const snapshot=h.bootstrap.snapshot()
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)),snapshot)
  assert.equal(snapshot.items.every(row=>!Object.hasOwn(row,'pendingBuilds')&&!Object.hasOwn(row,'requestId')&&!Object.hasOwn(row,'code')),true)
})

test('no login means no inspection, installation, persistence or implicit account access',async()=>{
  const h=fixture({connected:false});assert.equal(h.bootstrap.kick().running,false);await idle(h.bootstrap)
  assert.equal(h.calls.length,0);assert.equal(h.writes.length,0)
  h.setConnected(true);h.bootstrap.kick();await idle(h.bootstrap);assert.equal(h.installs.length,5)
})

test('already installed packages are skipped and disabled entries remain disabled',async()=>{
  const h=fixture({bundles:NAMES.map((name,index)=>({name,installed:true,enabled:index%2===0,version:'9.0.'+index}))})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.installs.length,0);assert.equal(h.calls.filter(call=>call[0]==='inspect').length,0)
  for(const [index,name]of NAMES.entries())assert.equal(item(h,name).status,index%2===0?'already-installed':'present-disabled')
})

test('bootstrap awaits asynchronous initial and per-target inventories before any inspection or installation',async()=>{
  const first=deferred(),second=deferred();let listed=0
  const inventory=NAMES.map(name=>({name,installed:true,enabled:true,version:'1.2.3'}))
  const h=fixture({list:async()=>{listed++;if(listed===1)return first.promise;if(listed===2)return second.promise;return inventory}})
  h.bootstrap.kick();await turn()
  assert.equal(listed,1);assert.equal(h.installs.length,0);assert.equal(h.preflights.length,0)
  assert.equal(h.calls.filter(call=>call[0]==='inspect').length,0)
  first.resolve(inventory);await turn()
  assert.equal(listed,2);assert.equal(h.installs.length,0);assert.equal(h.bootstrap.snapshot().items[0].status,'pending')
  second.resolve(inventory);await idle(h.bootstrap)
  assert.equal(h.installs.length,0);assert.equal(h.preflights.length,0)
  assert.ok(h.bootstrap.snapshot().items.every(row=>row.status==='already-installed'))
})

test('automatic bootstrap runs once per persisted profile and a user-removed completed target stays removed',async()=>{
  const h=fixture();h.bootstrap.kick();await idle(h.bootstrap)
  h.bootstrap.kick();await idle(h.bootstrap);assert.equal(h.installs.length,5)
  const reloaded=fixture({saved:h.value});reloaded.bootstrap.kick();await idle(reloaded.bootstrap)
  assert.equal(reloaded.calls.length,0);assert.equal(reloaded.installs.length,0)
  assert.equal(reloaded.bootstrap.snapshot().attempted,true)
})

test('manual retry retries failed packages while installed neighbors are not upgraded',async()=>{
  let attempts=0
  const bundles=NAMES.slice(1).map(name=>({name,installed:true,enabled:true,version:'8.0.0'}))
  const h=fixture({bundles,inspect:async name=>{attempts++;if(attempts===1)throw Error('private registry response');return {status:'accepted',name,version:'1.2.3',bundle:true}}})
  h.bootstrap.kick();await idle(h.bootstrap);assert.equal(item(h,NAMES[0]).status,'failed');assert.equal(h.installs.length,0)
  h.bootstrap.kick();await idle(h.bootstrap);assert.equal(attempts,1)
  h.bootstrap.kick({retry:true});await idle(h.bootstrap)
  assert.equal(h.installs.length,1);assert.equal(item(h,NAMES[0]).status,'installed')
  assert.ok(h.bootstrap.snapshot().items.slice(1).every(row=>row.status==='already-installed'))
})

test('installed entries carrying official errors are not silently reported as successful',async()=>{
  const h=fixture({bundles:NAMES.map((name,index)=>({name,installed:true,enabled:true,version:'1.2.3',...(index===0?{error:{code:'incompatible-version',diagnostic:'private installed diagnostic'}}:{})}))})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.installs.length,0)
  assert.equal(item(h,NAMES[0]).status,'failed');assert.equal(item(h,NAMES[0]).code,'incompatible-version')
  assert.ok(h.bootstrap.snapshot().items.slice(1).every(row=>row.status==='already-installed'))
  assert.equal(JSON.stringify(h.value).includes('private installed diagnostic'),false)
})

test('retry retains restart-required until the installed package is actually active after restart',async()=>{
  const saved=initial({attempted:true});saved.items[0]={...saved.items[0],status:'restart-required',code:'host-module',version:'1.2.3'}
  const h=fixture({saved,bundles:NAMES.map(name=>({name,installed:true,enabled:true,version:'1.2.3'}))})
  h.bootstrap.kick({retry:true});await idle(h.bootstrap)
  assert.equal(h.installs.length,0);assert.equal(item(h,NAMES[0]).status,'restart-required')
  assert.equal(item(h,NAMES[0]).code,'host-module')
})

test('all installed packages bypass unavailable Windows pnpm and keep disabled packages disabled',async()=>{
  const h=fixture({platform:'win32',preflight:async()=>({status:'unavailable',code:'pnpm-missing'}),bundles:NAMES.map((name,index)=>({name,installed:true,enabled:index!==1,version:'1.2.3'}))})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.preflights.length,0);assert.equal(h.installs.length,0);assert.equal(h.bootstrap.snapshot().error,undefined)
  assert.equal(item(h,NAMES[1]).status,'present-disabled')
  assert.equal(item(h,NAMES[0]).status,'already-installed')
})

test('a pending or active run is single-flight even when kick and retry are called repeatedly',async()=>{
  const gate=deferred();let calls=0
  const h=fixture({install:async()=>{calls++;await gate.promise;return {application:'applied',version:'1.2.3'}}})
  h.bootstrap.kick();h.bootstrap.kick({retry:true});await turn()
  assert.equal(calls,1);h.bootstrap.kick({retry:true});assert.equal(calls,1)
  gate.resolve();await idle(h.bootstrap);assert.equal(calls,5)
})

test('mirror inspection refusal, mismatched package/version and non-bundles never reach install',async()=>{
  const responses=[{status:'refused',problem:'registry-denied'},{status:'accepted',name:'other-package',version:'1',bundle:true},{status:'accepted',version:'',bundle:true},{status:'accepted',version:'1',bundle:false},{status:'accepted',version:'1',bundle:true}]
  const h=fixture({inspect:async name=>({name,...responses[NAMES.indexOf(name)]})})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.deepEqual(h.installs.map(call=>call.spec),[NAMES[4]+'@1'])
  assert.ok(h.bootstrap.snapshot().items.slice(0,4).every(row=>row.status==='failed'))
})

test('official version incompatibility is recorded without exemption or automatic second attempt',async()=>{
  const h=fixture({install:async()=>({application:'failed',error:{code:'incompatible-version',diagnostic:'do-not-log-private-version-details'}})})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.installs.length,5);assert.ok(h.bootstrap.snapshot().items.every(row=>row.code==='incompatible-version'))
  h.bootstrap.kick();await idle(h.bootstrap);assert.equal(h.installs.length,5)
  assert.equal(JSON.stringify(h.value).includes('do-not-log-private-version-details'),false)
})

test('official pnpm-missing stops the remaining queue and takes precedence over a generic operation error',async()=>{
  const h=fixture({platform:'win32',install:async()=>({application:'failed',packageResult:{kind:'pnpm-missing'},error:{code:'operation-error',diagnostic:'private Windows PATH output'}})})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.installs.length,1)
  assert.equal(item(h,NAMES[0]).status,'failed');assert.equal(item(h,NAMES[0]).code,'pnpm-missing')
  assert.ok(h.bootstrap.snapshot().items.slice(1).every(row=>row.status==='pending'))
  assert.equal(h.bootstrap.snapshot().error,'pnpm-missing')
  assert.equal(h.bootstrap.snapshot().running,false)
  assert.equal(JSON.stringify(h.value).includes('private Windows PATH output'),false)
  assert.equal(Object.hasOwn(h.installs[0].settings,'approvedBuilds'),false)
  assert.deepEqual(Object.keys(h.installs[0].settings).sort(),['enabled','expected','registry','requestId','saveExact'])
})

test('blocked build scripts remain blocked and no build approval is passed to official installation',async()=>{
  const h=fixture({install:async()=>({application:'failed',pendingBuilds:['native-helper'],error:{code:'builds-not-approved',diagnostic:'private build output'}})})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.ok(h.bootstrap.snapshot().items.every(row=>row.status==='failed'&&row.code==='build-approval-required'))
  assert.ok(h.installs.every(call=>!Object.hasOwn(call.settings,'approvedBuilds')))
  assert.equal(JSON.stringify(h.value).includes('private build output'),false)
})

test('a successful manual retry removes obsolete build-blocking status from its prior attempt',async()=>{
  let first=true
  const h=fixture({bundles:NAMES.slice(1).map(name=>({name,installed:true,enabled:true,version:'1'})),install:async()=>first?{application:'failed',pendingBuilds:['native-helper']}:{application:'applied',version:'1.2.3'}})
  h.bootstrap.kick();await idle(h.bootstrap);assert.deepEqual(item(h,NAMES[0]).pendingBuilds,['native-helper'])
  first=false;h.bootstrap.kick({retry:true});await idle(h.bootstrap)
  const row=item(h,NAMES[0]);assert.equal(row.status,'installed');assert.equal(row.code,undefined);assert.equal(row.pendingBuilds,undefined)
})

test('restart-required and overridden are reported instead of being presented as applied',async()=>{
  const h=fixture({install:async spec=>spec.startsWith(NAMES[0]+'@')?{application:'restart-required',restartReason:'module-generation'}:{application:'overridden',error:{code:'config-overridden'}}})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(item(h,NAMES[0]).status,'restart-required')
  assert.ok(h.bootstrap.snapshot().items.slice(1).every(row=>row.status==='overridden'))
})

test('request id is durably saved before calling install and survives a dispose during HMR',async()=>{
  const gate=deferred();let h
  h=fixture({install:async(_spec,settings)=>{
    const saved=h.value.items.find(row=>row.name===NAMES[0])
    assert.equal(saved.status,'installing');assert.equal(saved.requestId,settings.requestId)
    await gate.promise;return {application:'applied',version:'1.2.3'}
  }})
  h.bootstrap.kick();await turn()
  const id=item(h,NAMES[0]).requestId;assert.ok(id)
  assert.equal(h.bootstrap.dispose(),undefined)
  assert.equal(h.bootstrap.disposed,true);assert.equal(h.installs.length,1)
  gate.resolve();await idle(h.bootstrap)
  assert.equal(h.installs.length,1);assert.equal(h.value.items[0].requestId,id);assert.equal(h.value.items[0].status,'installing')
})

test('reload recovers its saved request using waitForInstall before any duplicate installation',async()=>{
  const saved=initial({attempted:true,running:true});saved.items[0]={...saved.items[0],status:'installing',requestId:'novaflow-bootstrap-prior'}
  const h=fixture({saved,wait:async id=>{assert.equal(id,'novaflow-bootstrap-prior');return {application:'applied',version:'2.0.0'}},bundles:NAMES.slice(1).map(name=>({name,installed:true,enabled:true,version:'1'}))})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.calls.filter(call=>call[0]==='waitForInstall').length,1);assert.equal(h.installs.length,0)
  assert.equal(item(h,NAMES[0]).status,'installed');assert.equal(item(h,NAMES[0]).version,'2.0.0');assert.equal(item(h,NAMES[0]).requestId,undefined)
})

test('an unknown old request falls back to current installed facts rather than reinstallation',async()=>{
  const saved=initial({attempted:true,running:true});saved.items[0]={...saved.items[0],status:'installing',requestId:'old-request'}
  const h=fixture({saved,bundles:NAMES.map(name=>({name,installed:true,enabled:false,version:'3'}))})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.calls.filter(call=>call[0]==='waitForInstall').length,1);assert.equal(h.installs.length,0);assert.equal(item(h,NAMES[0]).status,'present-disabled')
})

test('dispose is immediate while waitForInstall or installBundle is pending and starts no next package',async()=>{
  for(const waiting of [false,true]){
    const gate=deferred(), saved=waiting?initial({attempted:true,running:true}):undefined
    if(saved)saved.items[0]={...saved.items[0],status:'installing',requestId:'old-request'}
    const h=fixture({saved,wait:async()=>gate.promise,install:async()=>gate.promise})
    h.bootstrap.kick();await turn();const before=h.calls.length
    assert.equal(h.bootstrap.dispose(),undefined)
    await turn();assert.equal(h.calls.length,before)
    gate.resolve({application:'applied',version:'1'});await idle(h.bootstrap)
    assert.equal(h.calls.length,before)
  }
})

test('sign-out lets an admitted install settle but prevents installing the next package',async()=>{
  const gate=deferred();const h=fixture({install:async()=>gate.promise})
  h.bootstrap.kick();await turn();h.setConnected(false);gate.resolve({application:'applied',version:'1'});await idle(h.bootstrap)
  assert.equal(h.installs.length,1);assert.equal(h.bootstrap.snapshot().running,false)
})

test('sign-out while inspection is pending prevents that package installation',async()=>{
  const gate=deferred();const h=fixture({inspect:async name=>{await gate.promise;return {status:'accepted',name,version:'1',bundle:true}}})
  h.bootstrap.kick();await turn();h.setConnected(false);gate.resolve();await idle(h.bootstrap)
  assert.equal(h.installs.length,0);assert.equal(h.calls.filter(call=>call[0]==='inspect').length,1)
})

test('snapshot and stored state are detached and the registry cannot be redirected by saved data',async()=>{
  const h=fixture({saved:initial({registry:'https://untrusted.invalid',items:[...initial().items,{name:'unexpected-package',status:'pending'}]})})
  const snapshot=h.bootstrap.snapshot();snapshot.items[0].status='tampered';snapshot.registry='tampered'
  assert.equal(h.bootstrap.snapshot().items[0].status,'pending');assert.equal(h.bootstrap.snapshot().registry,REGISTRY)
  assert.deepEqual(h.bootstrap.snapshot().items.map(row=>row.name),NAMES)
})

test('unsafe official error fields and thrown diagnostics cannot leak into persisted status',async()=>{
  const secret='nfds_SECRET_PRIVATE_DIAGNOSTIC'
  const h=fixture({inspect:async name=>name===NAMES[0]?{status:'refused',name,problem:'registry error '+secret}:{status:'accepted',name,version:'1',bundle:true},install:async spec=>spec.startsWith(NAMES[1]+'@')?{application:'failed',error:{code:'upstream '+secret,diagnostic:secret}}:spec.startsWith(NAMES[2]+'@')?{application:'restart-required',restartReason:'reason '+secret}:spec.startsWith(NAMES[3]+'@')?{application:'failed',pendingBuilds:['native-addon',secret]}:Promise.reject(Error(secret))})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(JSON.stringify(h.bootstrap.snapshot()).includes(secret),false)
  assert.equal(JSON.stringify(h.value).includes(secret),false)
  assert.equal(JSON.stringify(h.changes).includes(secret),false)
})

test('dispose before scheduled admission cancels work without touching the manager',async()=>{
  const h=fixture();h.bootstrap.kick();h.bootstrap.dispose();await idle(h.bootstrap)
  assert.equal(h.calls.length,0);assert.equal(h.installs.length,0);assert.equal(h.writes.length,0)
})

test('sign-out before scheduled admission clears the transient running indicator without installation',async()=>{
  const h=fixture();h.bootstrap.kick();h.setConnected(false);await idle(h.bootstrap)
  assert.equal(h.calls.length,0);assert.equal(h.installs.length,0)
  assert.equal(h.bootstrap.snapshot().running,false)
  assert.equal(h.bootstrap.snapshot().attempted,false)
})

test('a persistent state write failure prevents any installation and exposes only a stable bootstrap error',async()=>{
  const secret='private filesystem diagnostic'
  const h=fixture({onWrite:async()=>{throw Error(secret)}})
  h.bootstrap.kick();await idle(h.bootstrap)
  assert.equal(h.installs.length,0);assert.equal(h.calls.length,0)
  assert.equal(h.bootstrap.snapshot().error,'bootstrap-failed');assert.equal(h.bootstrap.snapshot().running,false)
  assert.equal(JSON.stringify(h.bootstrap.snapshot()).includes(secret),false)
})

test('openBootstrapState uses the actual z schema with only an in-memory storage-domain mock',async()=>{
  const {z}=await loadNativeLibraries();let opened,closed=0,dispose
  const ctx={storageDomain:{async open(spec){opened=defineDomain(spec);assert.ok(UNIT_NAME_RE.test(spec.name));const schema=spec.global.schema;let value=schema.parse(spec.global.initial);return {global:{get:()=>clone(value),set:async next=>{value=schema.parse(next)}},close:async()=>{closed++}}}},effect(fn){dispose=fn()}}
  const store=await openBootstrapState(ctx,z)
  assert.equal(opened.name,'novaflow_plugin_bootstrap');assert.equal(opened.version,1);assert.deepEqual(opened.tables,{})
  assert.deepEqual(store.get().items.map(row=>row.name),NAMES)
  const state=store.get();state.attempted=true;state.items[0].status='installing';state.items[0].requestId='test-request';await store.set(state)
  assert.equal(store.get().items[0].requestId,'test-request')
  await assert.rejects(store.set({...state,attempted:'invalid boolean'}))
  await assert.rejects(store.set({...state,items:[{name:1,label:'bad',status:'pending'}]}))
  await dispose();assert.equal(closed,1)
})
