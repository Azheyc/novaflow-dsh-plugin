import { access as fsAccess } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'

/** Read-only Windows Desktop preflight: use the same bundled pnpm entry the
 * official Desktop passes to PluginManager; never install global tools or edit PATH. */
export async function checkPackageRuntime({platform=process.platform,resourcesPath=process.resourcesPath,executable=process.execPath,environment=process.env,access=fsAccess,execute}={}) {
  if(platform!=='win32'||!resourcesPath)return {status:'managed-by-dsh'}
  const pnpm=join(resourcesPath,'runtime','primary-runtime','dependencies','pnpm','bin','pnpm.mjs')
  try{await access(pnpm)}catch{return {status:'unavailable',code:'pnpm-missing'}}
  const run=execute || ((command,args,options)=>new Promise((resolve,reject)=>{
    execFile(command,args,options,(error,stdout)=>error?reject(error):resolve(stdout))
  }))
  try {
    const version=String(await run(executable,[pnpm,'--version'],{env:{...environment,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,timeout:15000,maxBuffer:32768})).trim()
    if(!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))return {status:'unavailable',code:'pnpm-runtime-unavailable'}
    return {status:'ready',version}
  } catch(error) {return {status:'unavailable',code:error?.code==='ENOENT'?'pnpm-missing':'pnpm-runtime-unavailable'}}
}
