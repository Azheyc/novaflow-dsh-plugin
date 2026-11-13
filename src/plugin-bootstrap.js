import { randomUUID } from 'node:crypto'
import { checkPackageRuntime } from './package-runtime.js'

export const PLUGIN_REGISTRY='https://registry.npmmirror.com'
export const RECOMMENDED_PLUGINS=Object.freeze([
  {name:'dshmarket',label:'dshmarket'},
  {name:'dsh-ops',label:'dsh-ops'},
  {name:'dsh-free-search',label:'dsh-free-search'},
  {name:'@michengai/dsh-archive-manager',label:'dsh-archive-manager'},
  {name:'dsh-rewind-plugin',label:'dsh-rewind'},
])
const SUCCESS=new Set(['installed','already-installed','present-disabled','restart-required'])
const SAFE_CODES=new Set(['build-approval-required','unknown-plugin','invalid-spec','already-installed','ambiguous-install','not-bundle','not-removable','stop-profile','bundle-in-use','stale-approval','incompatible-version','unsupported-platform','unexpected-package','operation-error','pnpm-missing','timeout','not-found','no-matching-version','network','disk-full','permission','build-blocked','integrity','unknown','not-a-package','not-a-bundle','install-failed','registry-unavailable','invalid-bundle','installation-error','restart-required','no-hmr','package-moved','host-module','unmanaged-plugin','module-comparison'])
const safeCode=(code,fallback='install-failed')=>SAFE_CODES.has(code)?code:fallback
const codeOf=result=>result?.pendingBuilds?.length?'build-approval-required':safeCode(result?.packageResult?.kind || result?.error?.code)
const safeBuilds=values=>Array.isArray(values)?values.filter(name=>typeof name==='string'&&/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)).slice(0,30):[]
const initial=()=>({version:1,attempted:false,running:false,registry:PLUGIN_REGISTRY,items:RECOMMENDED_PLUGINS.map(item=>({name:item.name,label:item.label,status:'pending'}))})

/** Installs once per profile using the official manager. No shell/npm profile writes,
 * build-script approvals, version exemptions, automatic upgrades or forced enablement. */
export class PluginBootstrap {
  constructor({manager,store,isConnected,platform=process.platform,preflight=checkPackageRuntime,onChange=()=>{}}) {
    Object.assign(this,{manager,store,isConnected,platform,preflight,onChange})
    const saved=store.get()
    this.state=saved?.version===1?structuredClone(saved):initial()
    // Persisted in-flight ids are resumable only after a new UI confirmation.
    // A saved running flag does not represent work owned by this plugin generation.
    this.state.running=false
    this.state.registry=PLUGIN_REGISTRY
    this.state.items=RECOMMENDED_PLUGINS.map(item=>({...item,...this.state.items?.find(row=>row.name===item.name)}))
    this.disposed=false;this.work=null;this.timer=null
  }
  snapshot(){return JSON.parse(JSON.stringify(this.state))}
  async save(){if(this.disposed)return;await this.store.set(this.snapshot());if(!this.disposed)this.onChange(this.snapshot())}
  async setItem(name,patch){if(this.disposed)return;this.state.items=this.state.items.map(item=>item.name===name?{...item,pendingBuilds:undefined,...patch}:item);await this.save()}
  kick({retry=false}={}) {
    if(this.disposed||!this.isConnected()||this.work||this.timer)return this.snapshot()
    if(this.state.attempted&&!this.state.running&&!retry&&!this.state.items.some(item=>['pending','checking','installing'].includes(item.status)))return this.snapshot()
    if(this.state.error&&!retry)return this.snapshot()
    // Never install under apply, callback exchange or a ConfigEditor's HMR lock.
    this.state.running=true
    this.timer=setImmediate(()=>{
      this.timer=null
      if(this.disposed)return
      if(!this.isConnected()){this.state.running=false;void this.save().catch(()=>{});return}
      const work=this.run(retry)
      this.work=work
      work.catch(async()=>{if(!this.disposed){this.state.running=false;this.state.error='bootstrap-failed';await this.save().catch(()=>{})}}).finally(()=>{if(this.work===work)this.work=null})
    })
    return this.snapshot()
  }
  async run(retry) {
    if(this.disposed||!this.isConnected())return
    this.state.attempted=true;this.state.running=true;delete this.state.error;await this.save()
    const inventory=await this.manager.listBundles()
    const needsInstall=RECOMMENDED_PLUGINS.some(target=>!inventory.some(bundle=>bundle.name===target.name&&bundle.installed))
    const environment=needsInstall?await this.preflight({platform:this.platform}):{status:'managed-by-dsh'}
    if(environment.status==='unavailable'){
      this.state.running=false;this.state.error=environment.code==='pnpm-missing'?'pnpm-missing':'pnpm-runtime-unavailable';await this.save();return
    }
    for(const target of RECOMMENDED_PLUGINS) {
      if(this.disposed||!this.isConnected())break
      const row=this.state.items.find(item=>item.name===target.name)
      // Recover only an install explicitly started by this bootstrap before reload.
      if(row.status==='installing'&&row.requestId) {
        const result=await this.manager.waitForInstall(row.requestId)
        if(this.disposed)return
        if(result){await this.record(target.name,result);continue}
      }
      const existing=(await this.manager.listBundles()).find(bundle=>bundle.name===target.name&&bundle.installed)
      if(existing){
        if(existing.error){await this.setItem(target.name,{status:'failed',code:safeCode(existing.error.code),version:existing.version,requestId:undefined});continue}
        const plugins=existing.enabled&&typeof this.manager.listPlugins==='function'?await this.manager.listPlugins():[]
        if(existing.rows?.some(bundleRow=>plugins.some(plugin=>plugin.entryId===bundleRow.entryId&&plugin.fiberPhase==='failed'))){await this.setItem(target.name,{status:'failed',code:'activation-failed',version:existing.version,requestId:undefined});continue}
        if(row.status==='restart-required'){
          const active=existing.rows?.length>0&&existing.rows.every(bundleRow=>plugins.some(plugin=>plugin.entryId===bundleRow.entryId&&plugin.fiberPhase==='active'))
          if(!active)continue
        }
        await this.setItem(target.name,{status:existing.enabled?'already-installed':'present-disabled',version:existing.version,code:undefined,requestId:undefined})
        continue
      }
      if(target.platform&&target.platform!==this.platform){await this.setItem(target.name,{status:'unsupported-platform',code:'windows-only',requestId:undefined});continue}
      if(!retry&&row.status!=='pending'&&row.status!=='checking'&&row.status!=='installing'&&!SUCCESS.has(row.status))continue
      // A previously completed target removed by the user stays removed until Retry.
      if(!retry&&SUCCESS.has(row.status))continue
      await this.setItem(target.name,{status:'checking',code:undefined,requestId:undefined})
      let inspected
      try{inspected=await this.manager.inspect(target.name,{registry:PLUGIN_REGISTRY})}catch{await this.setItem(target.name,{status:'failed',code:'registry-unavailable'});continue}
      if(this.disposed||!this.isConnected())break
      if(inspected.status!=='accepted'||inspected.name!==target.name||!inspected.version||inspected.bundle!==true){await this.setItem(target.name,{status:'failed',code:safeCode(inspected.problem,'invalid-bundle')});continue}
      const requestId='novaflow-bootstrap-'+randomUUID()
      await this.setItem(target.name,{status:'installing',requestId,version:inspected.version})
      if(this.disposed||!this.isConnected())break
      try{
        const result=await this.manager.installBundle(target.name+'@'+inspected.version,{registry:PLUGIN_REGISTRY,enabled:true,saveExact:true,requestId,expected:{name:target.name,version:inspected.version}})
        if(this.disposed)return
        await this.record(target.name,result)
        if(codeOf(result)==='pnpm-missing'){this.state.error='pnpm-missing';break}
      }catch{await this.setItem(target.name,{status:'failed',code:'installation-error',requestId:undefined})}
    }
    if(!this.disposed){this.state.running=false;await this.save()}
  }
  async record(name,result) {
    const application=result?.application
    if(application==='applied'&&!result.error&&!result.pendingBuilds?.length){await this.setItem(name,{status:'installed',version:result.version || this.state.items.find(item=>item.name===name).version,code:undefined,requestId:undefined});return}
    if(application==='restart-required'&&!result.error&&!result.pendingBuilds?.length){await this.setItem(name,{status:'restart-required',code:safeCode(result.restartReason,'restart-required'),requestId:undefined});return}
    await this.setItem(name,{status:application==='overridden'?'overridden':'failed',code:codeOf(result),requestId:undefined,...(result.pendingBuilds?.length?{pendingBuilds:safeBuilds(result.pendingBuilds)}:{} )})
  }
  dispose(){this.disposed=true;if(this.timer)clearImmediate(this.timer);this.timer=null;/* Never await/cancel a manager HMR operation from inside plugin disposal. */}
}

export async function openBootstrapState(ctx,z) {
  const item=z.object({name:z.string(),label:z.string(),status:z.string(),version:z.string().optional(),code:z.string().optional(),requestId:z.string().optional(),platform:z.string().optional(),pendingBuilds:z.array(z.string()).optional()})
  const domain=await ctx.storageDomain.open({name:'novaflow_plugin_bootstrap',version:1,tables:{},global:{schema:z.object({version:z.literal(1),attempted:z.boolean(),running:z.boolean(),registry:z.string(),items:z.array(item),error:z.string().optional()}),initial:initial()}})
  ctx.effect(()=>()=>domain.close())
  return domain.global
}
