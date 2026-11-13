import { promises as fs } from 'node:fs'
import { resolve, relative, dirname, extname, join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { ORIGIN, PREFIX, RECORD, NovaError, storedGrant } from './protocol.js'

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.6'
const IMAGE_LIMIT = 30*1024*1024, VIDEO_LIMIT=512*1024*1024
const bad = code => { throw new NovaError(code) }
const plain = value => value && typeof value==='object' && !Array.isArray(value)
function publicAddress(address) {
  if (address.includes(':')) return /^[23]/.test(address) && !/^2001:(?:db8|0:|10:|20:)/i.test(address) && !address.toLowerCase().includes('ffff:')
  const [a,b]=address.split('.').map(Number)
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168||b===0)) || (a===100&&b>=64&&b<=127) || a===198 || a===203)
}
export async function publicURL(value, lookupImpl=lookup) {
  let url;try{url=new URL(value)}catch{bad('MEDIA_URL_INVALID')}
  if(url.protocol!=='https:' || url.username || url.password || url.hash || (url.port && url.port!=='443') || ['localhost'].includes(url.hostname)) bad('MEDIA_URL_INVALID')
  const hostname=url.hostname.replace(/^\[|\]$/g,'')
  let addresses
  try { addresses=isIP(hostname)?[{address:hostname}]:await lookupImpl(hostname,{all:true}) } catch { bad('MEDIA_URL_INVALID') }
  if(!addresses.length || addresses.some(({address})=>!publicAddress(address))) bad('MEDIA_URL_INVALID')
  return url
}
async function bytes(response,limit) {
  if(Number(response.headers.get('content-length'))>limit) { await response.body?.cancel();bad('MEDIA_FILE_TOO_LARGE') }
  const reader=response.body?.getReader();if(!reader)bad('MEDIA_RESPONSE_INVALID')
  const chunks=[];let size=0
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>limit)bad('MEDIA_FILE_TOO_LARGE');chunks.push(r.value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
  return Buffer.concat(chunks)
}
const imageType=data=> data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : data[0]===255&&data[1]===216 ? 'image/jpeg' : data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP' ? 'image/webp' : /^GIF8[79]a/.test(data.toString('ascii',0,6))?'image/gif':null
const imageExt=type=>({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'}[type])

// Validate DNS and pin the exact validated address at socket creation. A second
// unguarded fetch resolution would permit DNS rebinding into the Host's LAN.
async function externalFetch(url,{signal},lookupImpl) {
  const target=await publicURL(url,lookupImpl), host=target.hostname.replace(/^\[|\]$/g,'')
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookupImpl(host,{all:true})
  if(!addresses.length || addresses.some(x=>!publicAddress(x.address)))bad('MEDIA_URL_INVALID')
  const chosen=addresses[0]
  return new Promise((resolve,reject)=>{
    const req=httpsRequest(target,{method:'GET',agent:false,signal,headers:{Accept:'image/*','Accept-Encoding':'identity'},lookup:(_hostname,options,callback)=>{
      const result={address:chosen.address,family:chosen.family || isIP(chosen.address)}
      if(options?.all)callback(null,[result]);else callback(null,result.address,result.family)
    }},res=>{
      try {
        const headers=new Headers();for(const [key,value]of Object.entries(res.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value)
        const noBody=[204,205,304].includes(res.statusCode)
        if(noBody)res.resume()
        resolve(new Response(noBody?null:Readable.toWeb(res),{status:res.statusCode,headers}))
      }catch{res.destroy();reject(new NovaError('MEDIA_DOWNLOAD_FAILED'))}
    })
    req.on('error',()=>reject(new NovaError('MEDIA_DOWNLOAD_FAILED')));req.end()
  })
}

/** Media execution independent of Magpie application preferences. Persisted job metadata
 * holds only device identity hash, model/group and result paths, never device tokens. */
export function createMediaService({account,credentials,api,workspace,fetchImpl=globalThis.fetch,externalFetchImpl,lookupImpl=lookup,waitMs=18000,timeoutMs=300000}) {
  const root=resolve(workspace), jobsDir=join(root,'.novaflow-media','jobs'), jobs=new Map(), running=new Set(), polling=new Map()
  let disposed=false
  const lifecycle=new AbortController()
  let accountLifetime=new AbortController()
  async function identity() {
    if(disposed)bad('MEDIA_UNAVAILABLE')
    const grant=storedGrant(await credentials.readRecord(RECORD));if(!grant)bad('AUTH_REQUIRED')
    return createHash('sha256').update(grant.sessionId).digest('hex')
  }
  async function ensureIdentity(owner) {if(await identity()!==owner)bad('MEDIA_ACCOUNT_CHANGED')}
  async function catalog(kind) {
    const token=await account.accessToken()
    const data=await api.request(PREFIX+'/creator/models',{token,signal:lifecycle.signal})
    if(!Array.isArray(data?.items))bad('INVALID_RESPONSE')
    return data.items.filter(item=>plain(item)&&typeof item.model_id==='string'&&typeof item.group_id==='string'&&Array.isArray(item.supported_endpoint_types) && (!kind||item.kind===kind))
  }
  async function listModels({kind}={}) {
    if(kind!==undefined&&!['image','video'].includes(kind))bad('INVALID_REQUEST')
    await identity()
    const rows=await catalog(kind)
    return {default_image_model:DEFAULT_IMAGE_MODEL,video_model_required:true,models:rows.filter(x=>x.kind==='image'||x.kind==='video').map(x=>({id:x.model_id,group:x.group_id,kind:x.kind,endpoints:x.supported_endpoint_types}))}
  }
  async function select(kind,model,group) {
    const rows=(await catalog(kind)).filter(row=>row.model_id===model && (!group || row.group_id===group) && row.supported_endpoint_types.includes(kind==='image'?'image-generation':'openai-video'))
    if(!rows.length)bad('MEDIA_MODEL_UNAVAILABLE')
    if(rows.length>1&&!group)bad('MEDIA_GROUP_REQUIRED')
    return rows[0]
  }
  async function safePath(value) {
    const path=resolve(root,value), rel=relative(root,path)
    if(!rel || rel.startsWith('..') || rel.startsWith('/') || rel.includes('\0'))bad('MEDIA_PATH_INVALID')
    // Reject an existing symlink in every path component, including the final file.
    let current=root
    const realRoot=await fs.realpath(root)
    if(realRoot!==root)bad('MEDIA_PATH_INVALID')
    for(const part of rel.split('/')) {
      current=join(current,part)
      try{if((await fs.lstat(current)).isSymbolicLink())bad('MEDIA_PATH_INVALID')}catch(error){if(error.code!=='ENOENT')throw error}
    }
    return path
  }
  async function download(value,limit,signal) {
    let url=await publicURL(value,lookupImpl)
    for(let count=0;count<4;count++){
      const response=await (externalFetchImpl ? externalFetchImpl(url.href,{redirect:'manual',signal}) : externalFetch(url.href,{signal},lookupImpl))
      if([301,302,303,307,308].includes(response.status)) {const to=response.headers.get('location');await response.body?.cancel();if(!to)bad('MEDIA_DOWNLOAD_FAILED');url=await publicURL(new URL(to,url).href,lookupImpl);continue}
      if(!response.ok){await response.body?.cancel();bad('MEDIA_DOWNLOAD_FAILED')}
      return {data:await bytes(response,limit),type:response.headers.get('content-type')||''}
    }
    bad('MEDIA_DOWNLOAD_FAILED')
  }
  async function reference(value,signal) {
    if(typeof value!=='string'||!value)bad('MEDIA_REFERENCE_INVALID')
    let data
    if(/^https:\/\//.test(value))data=(await download(value,IMAGE_LIMIT,signal)).data
    else{const path=await safePath(value),stat=await fs.stat(path);if(!stat.isFile()||stat.size>IMAGE_LIMIT)bad('MEDIA_FILE_TOO_LARGE');data=await fs.readFile(path)}
    if(data.length>IMAGE_LIMIT)bad('MEDIA_FILE_TOO_LARGE')
    const type=imageType(data);if(!type)bad('MEDIA_REFERENCE_INVALID')
    return {data,type}
  }
  async function platform(path,{method='GET',body,group,owner,signal,job}={}) {
    if(!/^\/v1\/(?:images\/(?:generations|edits)|videos(?:\/[A-Za-z0-9_-]+(?:\/content)?)?|tasks\/[A-Za-z0-9_-]+(?:\/artifacts(?:\/[A-Za-z0-9_-]+\/content)?)?)$/.test(path))bad('MEDIA_ROUTE_INVALID')
    await ensureIdentity(owner)
    const token=await account.accessToken(), headers={Authorization:`Bearer ${token}`,'X-NovaFlow-Group':encodeURIComponent(group),accept:'application/json'}
    let requestBody=body
    if(body!==undefined && !(body instanceof FormData)){headers['content-type']='application/json';requestBody=JSON.stringify(body)}
    if(method==='POST'&&job){job.submissionStarted=true;await persist(job)}
    let response
    try{response=await fetchImpl(ORIGIN+path,{method,headers,body:requestBody,redirect:'error',signal})}catch{bad('MEDIA_NETWORK_ERROR')}
    if(response.status===401){await response.body?.cancel();await account.rejectToken?.(token);bad('AUTH_REQUIRED')}
    if(!response.ok){await response.body?.cancel();bad(response.status===403?'MEDIA_MODEL_UNAVAILABLE':'MEDIA_PLATFORM_ERROR')}
    return response
  }
  async function json(response){try{return JSON.parse((await bytes(response,48*1024*1024)).toString('utf8'))}catch(error){if(error instanceof NovaError)throw error;bad('MEDIA_RESPONSE_INVALID')}}
  async function persist(job) {
    const target=await safePath(relative(root,join(jobsDir,job.id+'.json')))
    await fs.mkdir(jobsDir,{recursive:true,mode:0o700})
    const temporary=await safePath(relative(root,target+'.'+randomUUID()+'.tmp'))
    await fs.writeFile(temporary,JSON.stringify(job),{flag:'wx',mode:0o600})
    await fs.rename(temporary,target)
  }
  const view=job=>({id:job.id,status:job.status,model:job.model,group:job.group,...(job.files?{files:job.files}:{}),...(job.error?{error:job.error}:{}),...(job.status==='running'?{message:'Generation is running. Call generation_result with this id; do not submit the same request again.'}:job.status==='unknown'?{message:'The submission outcome is unknown and may already be billed. Do not submit it again. Check NovaFlow generation history before deciding what to do.'}:job.status==='failed'&&job.submissionStarted?{message:'The request was submitted but its output could not be completed. Do not retry automatically; check NovaFlow history first.'}:{})})
  async function save(job,data,type,index=0,total=1) {
    await ensureIdentity(job.owner)
    let target=job.path || (job.kind==='image'?'generated-images/':'generated-videos/')+job.id+(job.kind==='image'?imageExt(type):'.mp4')
    const extension=job.kind==='image'?imageExt(type):'.mp4'
    if(!extension)bad('MEDIA_RESPONSE_INVALID')
    if(!extname(target))target+=extension
    if(total>1)target=target.slice(0,-extname(target).length)+'-'+(index+1)+extname(target)
    const path=await safePath(target);await fs.mkdir(dirname(path),{recursive:true})
    const hash=createHash('sha256').update(data).digest('hex')
    const planned=job.outputPlan?.find(entry=>entry.path===path)
    try {
      const existing=await fs.readFile(path)
      if(planned?.sha256===hash && createHash('sha256').update(existing).digest('hex')===hash)return path
      bad('MEDIA_OUTPUT_EXISTS')
    } catch(error){if(error.code!=='ENOENT')throw error}
    job.outputPlan=[...(job.outputPlan || []).filter(entry=>entry.path!==path),{path,sha256:hash}]
    await persist(job)
    await fs.writeFile(path,data,{flag:'wx',mode:0o600})
    return path
  }
  async function imageResults(job,payload,signal) {
    const entries=Array.isArray(payload?.data) ? payload.data : plain(payload?.data) ? [payload.data] : null
    if(!Array.isArray(entries)||!entries.length||entries.length>4)bad('MEDIA_RESPONSE_INVALID')
    const files=[]
    job.expectedOutputCount=entries.length
    await persist(job)
    for(const [i,entry] of entries.entries()){
      let data,type
      if(typeof entry?.b64_json==='string') {if(entry.b64_json.length>IMAGE_LIMIT*1.4)bad('MEDIA_FILE_TOO_LARGE');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.b64_json))bad('MEDIA_RESPONSE_INVALID');data=Buffer.from(entry.b64_json,'base64');type=imageType(data)}
      else if(typeof entry?.url==='string'){({data}=await download(entry.url,IMAGE_LIMIT,signal));type=imageType(data)}
      else bad('MEDIA_RESPONSE_INVALID')
      if(!type || data.length>IMAGE_LIMIT)bad('MEDIA_RESPONSE_INVALID')
      files.push(await save(job,data,type,i,entries.length))
    }
    return files
  }
  async function runImage(job,args,signal) {
    const references=args.reference_images||[], body={model:job.model,prompt:args.prompt,stream:false}
    for(const field of ['size','quality','background','n']) if(args[field]!==undefined)body[field]=args[field]
    let payload
    if(references.length){const form=new FormData();for(const [key,value] of Object.entries(body))form.set(key,String(value));for(const value of references){const ref=await reference(value,signal);form.append('image[]',new Blob([ref.data],{type:ref.type}),'reference'+imageExt(ref.type))}payload=await json(await platform('/v1/images/edits',{method:'POST',body:form,group:job.group,owner:job.owner,signal,job}))}
    else payload=await json(await platform('/v1/images/generations',{method:'POST',body,group:job.group,owner:job.owner,signal,job}))
    job.files=await imageResults(job,payload,signal);job.status='completed'
  }
  async function runVideo(job,args,signal) {
    const body={model:job.model,prompt:args.prompt}
    if(args.seconds!==undefined)body.seconds=String(args.seconds)
    if(args.size!==undefined)body.size=args.size
    let requestBody=body
    const refs=[...(args.image?[args.image]:[]),...(args.reference_images||[])]
    if(refs.length){const form=new FormData();for(const [key,value]of Object.entries(body))form.set(key,String(value));for(const [index,value] of refs.entries()){const ref=await reference(value,signal);form.append(args.image&&index===0?'input_reference':'reference_images[]',new Blob([ref.data],{type:ref.type}),'reference'+imageExt(ref.type))}requestBody=form}
    const payload=await json(await platform('/v1/videos',{method:'POST',body:requestBody,group:job.group,owner:job.owner,signal,job}))
    const id=payload?.id || payload?.task_id || payload?.data?.id || payload?.data?.task_id
    if(typeof id!=='string'||!id||!/^[A-Za-z0-9_-]+$/.test(id))bad('MEDIA_RESPONSE_INVALID')
    job.remoteId=id;job.status='running'
  }
  async function execute(job,args) {
    const signal=AbortSignal.any([lifecycle.signal,accountLifetime.signal,AbortSignal.timeout(timeoutMs)])
    try{if(job.kind==='image')await runImage(job,args,signal);else await runVideo(job,args,signal)}catch(error){job.error=error instanceof NovaError?error.code:'MEDIA_GENERATION_FAILED';job.status=job.submissionStarted&&['MEDIA_NETWORK_ERROR','MEDIA_GENERATION_FAILED'].includes(job.error)?'unknown':'failed'}
    await persist(job)
  }
  async function begin(kind,args) {
    if(!plain(args)||typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>32000)bad('INVALID_REQUEST')
    if(kind==='video'&&(typeof args.model!=='string'||!args.model.trim()))bad('VIDEO_MODEL_REQUIRED')
    if(args.model!==undefined&&(typeof args.model!=='string'||!args.model.trim()))bad('MEDIA_MODEL_UNAVAILABLE')
    if(args.group!==undefined&&(typeof args.group!=='string'||!args.group))bad('INVALID_REQUEST')
    if(args.path!==undefined){
      if(typeof args.path!=='string'||!args.path)bad('MEDIA_PATH_INVALID')
      const total=kind==='image'?(args.n || 1):1
      for(let i=0;i<total;i++){
        let target=args.path
        if(!extname(target))target+=kind==='image'?'.png':'.mp4'
        if(total>1)target=target.slice(0,-extname(target).length)+'-'+(i+1)+extname(target)
        const path=await safePath(target)
        try{await fs.lstat(path);bad('MEDIA_OUTPUT_EXISTS')}catch(error){if(error.code!=='ENOENT')throw error}
      }
    }
    if(args.reference_images!==undefined&&(!Array.isArray(args.reference_images)||args.reference_images.length>8||args.reference_images.some(x=>typeof x!=='string')))bad('MEDIA_REFERENCE_INVALID')
    if(kind==='image'&&args.n!==undefined&&(!Number.isInteger(args.n)||args.n<1||args.n>4))bad('INVALID_REQUEST')
    if(kind==='video'&&args.seconds!==undefined&&(!Number.isInteger(args.seconds)||args.seconds<1||args.seconds>60))bad('INVALID_REQUEST')
    const owner=await identity(),model=args.model || DEFAULT_IMAGE_MODEL,route=await select(kind,model,args.group)
    const job={id:randomUUID(),kind,status:'running',model,group:route.group_id,owner,createdAt:Date.now(),...(args.path?{path:args.path}:{})}
    await persist(job);jobs.set(job.id,job)
    const work=execute(job,args);running.add(work);work.finally(()=>running.delete(work)).catch(()=>{})
    let timer;await Promise.race([work,new Promise(resolve=>{timer=setTimeout(resolve,waitMs)})]);clearTimeout(timer)
    return view(job)
  }
  async function generationResult({id}={}) {
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))bad('MEDIA_JOB_INVALID')
    let job=jobs.get(id)
    if(!job){try{job=JSON.parse(await fs.readFile(await safePath(relative(root,join(jobsDir,id+'.json'))),'utf8'))}catch{bad('MEDIA_JOB_NOT_FOUND')}
      await ensureIdentity(job.owner)
      if(job.status==='running'&&!job.remoteId){
        let recovered=job.outputPlan?.length===job.expectedOutputCount && job.expectedOutputCount>0
        if(recovered)for(const output of job.outputPlan){try{const data=await fs.readFile(await safePath(output.path));if(createHash('sha256').update(data).digest('hex')!==output.sha256)recovered=false}catch{recovered=false}}
        if(recovered){job.status='completed';job.files=job.outputPlan.map(output=>output.path)}
        else{job.status=job.submissionStarted?'unknown':'failed';job.error='MEDIA_JOB_INTERRUPTED'}
        await persist(job)
      }
    }
    await ensureIdentity(job.owner)
    if(job.status!=='running'||!job.remoteId)return view(job)
    const signal=AbortSignal.any([lifecycle.signal,accountLifetime.signal,AbortSignal.timeout(timeoutMs)])
    const payload=await json(await platform('/v1/videos/'+job.remoteId,{group:job.group,owner:job.owner,signal}))
    const state=payload.status || payload.data?.status
    if(['failed','error','cancelled','canceled'].includes(state)){job.status='failed';job.error='MEDIA_VIDEO_FAILED'}
    else if(['completed','succeeded','success'].includes(state)) {
      const response=await platform('/v1/videos/'+job.remoteId+'/content',{group:job.group,owner:job.owner,signal})
      const data=await bytes(response,VIDEO_LIMIT)
      if(!/^(?:video\/|application\/octet-stream)/i.test(response.headers.get('content-type')||'') || data.length<12 || data.toString('ascii',4,8)!=='ftyp'){job.status='failed';job.error='MEDIA_RESPONSE_INVALID';jobs.set(id,job);await persist(job);return view(job)}
      job.files=[await save(job,data,'video/mp4')];job.status='completed'
    }
    jobs.set(id,job);await persist(job);return view(job)
  }
  return {generateImage:args=>begin('image',args),generateVideo:args=>begin('video',args),generationResult: args => {
    const id=args?.id
    if(polling.has(id))return polling.get(id)
    const work=generationResult(args)
    polling.set(id,work);running.add(work)
    work.finally(()=>{polling.delete(id);running.delete(work)}).catch(()=>{})
    return work
  },listModels,clear(){accountLifetime.abort();accountLifetime=new AbortController()},async dispose(){disposed=true;lifecycle.abort();accountLifetime.abort();await Promise.allSettled([...running])}}
}
