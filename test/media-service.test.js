import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createMediaService, DEFAULT_IMAGE_MODEL, publicURL } from '../src/media-service.js'
import { ORIGIN, PREFIX, RECORD, tokenPair, NovaError } from '../src/protocol.js'

const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=','base64')
const MP4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(12)])
const rows=[
  {model_id:'gpt-image-2.6',group_id:'研发 A',kind:'image',supported_endpoint_types:['image-generation']},
  {model_id:'gpt-image-2.6',group_id:'团队 B',kind:'image',supported_endpoint_types:['image-generation']},
  {model_id:'image-other',group_id:'团队 B',kind:'image',supported_endpoint_types:['openai']},
  {model_id:'video-test',group_id:'视频组',kind:'video',supported_endpoint_types:['openai-video']},
  {model_id:'text-only',group_id:'普通',kind:'text',supported_endpoint_types:['openai']},
]
const response=value=>Response.json(value)
const code=expected=>error=>error instanceof NovaError&&error.code===expected
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
function grant(letter='s') {return {kind:'grant',payload:tokenPair({token_type:'Bearer',access_token:'nfds_'+'a'.repeat(43),refresh_token:'nfdr_'+'r'.repeat(43),session_id:'nfdev_'+letter.repeat(43),expires_in:900,refresh_expires_in:2592000})}}
async function fixture(t,options={}) {
  const workspace=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'novaflow-media-test-')))
  let record=grant(),accessCalls=0
  const requests=[],apiCalls=[],rejected=[]
  const account={accessToken:async()=>{accessCalls++;return record?.payload.accessToken},rejectToken:async value=>rejected.push(value)}
  const credentials={readRecord:async key=>{assert.equal(key,RECORD);return structuredClone(record)}}
  const api={request:async(path,request)=>{apiCalls.push({path,...request});assert.equal(path,PREFIX+'/creator/models');return {items:options.rows||rows.filter(row=>!(row.model_id===DEFAULT_IMAGE_MODEL&&row.group_id==='团队 B'))}}}
  const fetchImpl=async(url,init={})=>{
    requests.push({url:String(url),...init})
    if(options.fetch)return options.fetch(String(url),init)
    if(String(url).endsWith('/images/generations')||String(url).endsWith('/images/edits'))return response({data:[{b64_json:PNG.toString('base64')}]})
    if(String(url).endsWith('/videos')&&init.method==='POST')return response({id:'video_123',status:'queued'})
    if(String(url).endsWith('/videos/video_123/content'))return new Response(MP4,{headers:{'content-type':'video/mp4'}})
    if(String(url).endsWith('/videos/video_123'))return response({id:'video_123',status:'completed'})
    throw Error('Unexpected fake fetch')
  }
  const service=createMediaService({account,credentials,api,workspace,fetchImpl,externalFetchImpl:fetchImpl,lookupImpl:options.lookupImpl||(async()=>[{address:'93.184.216.34'}]),waitMs:options.waitMs??100,timeoutMs:options.timeoutMs??1000})
  t.after(async()=>{await service.dispose();await fs.rm(workspace,{recursive:true,force:true})})
  return {service,workspace,requests,apiCalls,rejected,account,credentials,getRecord:()=>record,setRecord:value=>{record=value},accessCalls:()=>accessCalls}
}
async function final(service,job){for(let n=0;n<100&&job.status==='running';n++){await new Promise(resolve=>setImmediate(resolve));job=await service.generationResult({id:job.id})}return job}

 test('default image model is gpt-image-2.6 and generated PNG is saved with private metadata and no secrets',async t=>{
  const h=await fixture(t),job=await h.service.generateImage({prompt:'A small test'})
  assert.equal(DEFAULT_IMAGE_MODEL,'gpt-image-2.6');assert.equal(job.model,DEFAULT_IMAGE_MODEL);assert.equal(job.status,'completed')
  assert.equal(h.requests.length,1);const req=h.requests[0]
  assert.equal(req.url,ORIGIN+'/v1/images/generations');assert.equal(req.redirect,'error');assert.equal(req.headers.Authorization,'Bearer '+h.getRecord().payload.accessToken)
  assert.equal(req.headers['X-NovaFlow-Group'],encodeURIComponent(job.group));assert.equal(JSON.parse(req.body).model,DEFAULT_IMAGE_MODEL)
  assert.equal(job.files.length,1);assert.match(job.files[0],/\.png$/);assert.deepEqual(await fs.readFile(job.files[0]),PNG)
  const metadata=await fs.readFile(join(h.workspace,'.novaflow-media','jobs',job.id+'.json'),'utf8')
  for(const secret of [h.getRecord().payload.accessToken,h.getRecord().payload.refreshToken,h.getRecord().payload.sessionId])assert.equal(metadata.includes(secret),false)
  assert.equal((await fs.stat(job.files[0])).mode&0o777,0o600)
})

test('video model is mandatory and rejects before catalog, token or fetch calls',async t=>{
  const h=await fixture(t)
  await assert.rejects(h.service.generateVideo({prompt:'test'}),code('VIDEO_MODEL_REQUIRED'))
  await assert.rejects(h.service.generateVideo({prompt:'test',model:' '}),code('VIDEO_MODEL_REQUIRED'))
  assert.equal(h.requests.length,0);assert.equal(h.apiCalls.length,0);assert.equal(h.accessCalls(),0)
})

test('catalog lists only image/video rows and ambiguous paid groups require an explicit choice before generation',async t=>{
  const h=await fixture(t,{rows})
  const list=await h.service.listModels({kind:'image'});assert.ok(list.models.every(row=>row.kind==='image'));assert.equal(list.video_model_required,true)
  await assert.rejects(h.service.generateImage({prompt:'test'}),code('MEDIA_GROUP_REQUIRED'))
  assert.equal(h.requests.length,0,'ambiguous groups must never submit a paid generation')
  const job=await h.service.generateImage({prompt:'test',group:'团队 B'});assert.equal(job.group,'团队 B');assert.equal(job.model,DEFAULT_IMAGE_MODEL);assert.equal(h.requests.length,1)
  await assert.rejects(h.service.generateImage({prompt:'test',group:'missing'}),code('MEDIA_MODEL_UNAVAILABLE'))
  await assert.rejects(h.service.generateImage({prompt:'test',model:'image-other'}),code('MEDIA_MODEL_UNAVAILABLE'))
  await assert.rejects(h.service.generateVideo({prompt:'test',model:'text-only'}),code('MEDIA_MODEL_UNAVAILABLE'))
  await assert.rejects(h.service.listModels({kind:'text'}),code('INVALID_REQUEST'))
})

test('local image references use multipart edits and preserve reference magic and parameters',async t=>{
  const h=await fixture(t);await fs.writeFile(join(h.workspace,'reference.png'),PNG)
  const job=await h.service.generateImage({prompt:'edit',reference_images:['reference.png'],n:1,size:'1024x1024',quality:'high'})
  assert.equal(job.status,'completed');const req=h.requests[0]
  assert.equal(req.url,ORIGIN+'/v1/images/edits');assert.ok(req.body instanceof FormData)
  assert.equal(req.headers['content-type'],undefined);assert.equal(req.body.get('model'),DEFAULT_IMAGE_MODEL);assert.equal(req.body.get('quality'),'high')
  const ref=req.body.get('image[]');assert.equal(ref.type,'image/png');assert.deepEqual(Buffer.from(await ref.arrayBuffer()),PNG)
})

test('invalid image magic is rejected for a reference and for returned base64 data',async t=>{
  const h=await fixture(t,{fetch:async()=>response({data:[{b64_json:Buffer.from('not image').toString('base64')}]})})
  await fs.writeFile(join(h.workspace,'bad.png'),'not image')
  const reference=await h.service.generateImage({prompt:'test',reference_images:['bad.png']});assert.equal(reference.status,'failed');assert.equal(reference.error,'MEDIA_REFERENCE_INVALID');assert.equal(h.requests.length,0)
  const result=await h.service.generateImage({prompt:'test'});assert.equal(result.status,'failed');assert.equal(result.error,'MEDIA_RESPONSE_INVALID');assert.equal(result.files,undefined)
})

test('malformed base64 is rejected even when tolerant decoding would preserve valid image magic',async t=>{
  for(const [name,value] of [['illegal suffix',PNG.toString('base64')+'!!'],['embedded punctuation',PNG.toString('base64').slice(0,16)+'!'+PNG.toString('base64').slice(16)],['data URL','data:image/png;base64,'+PNG.toString('base64')]])await t.test(name,async t=>{
    const h=await fixture(t,{fetch:async()=>response({data:[{b64_json:value}]})})
    const result=await h.service.generateImage({prompt:'test'});assert.equal(result.status,'failed');assert.equal(result.error,'MEDIA_RESPONSE_INVALID');assert.equal(result.files,undefined)
    assert.equal((await fs.readdir(h.workspace)).includes('generated-images'),false)
  })
})

test('multiple images save distinct numbered files and never overwrite an existing output',async t=>{
  const h=await fixture(t,{fetch:async()=>response({data:[{b64_json:PNG.toString('base64')},{b64_json:PNG.toString('base64')}]})})
  const job=await h.service.generateImage({prompt:'test',n:2,path:'out/test.png'});assert.equal(job.status,'completed');assert.equal(job.files.length,2);assert.match(job.files[0],/test-1\.png$/);assert.match(job.files[1],/test-2\.png$/)
  const paidBefore=h.requests.length
  await assert.rejects(h.service.generateImage({prompt:'test',n:2,path:'out/test.png'}),code('MEDIA_OUTPUT_EXISTS'))
  assert.equal(h.requests.length,paidBefore,'existing numbered outputs are rejected before another paid request');assert.deepEqual(await fs.readFile(job.files[0]),PNG)
})

test('paths reject traversal and existing symlinks before inference, and do not overwrite an existing file',async t=>{
  const h=await fixture(t)
  for(const path of ['../escaped.png',h.workspace,'../../outside.png'])await assert.rejects(h.service.generateImage({prompt:'test',path}),code('MEDIA_PATH_INVALID'))
  await fs.symlink(tmpdir(),join(h.workspace,'linked'))
  await assert.rejects(h.service.generateImage({prompt:'test',path:'linked/escaped.png'}),code('MEDIA_PATH_INVALID'))
  await fs.writeFile(join(h.workspace,'exists.png'),'preserve')
  await assert.rejects(h.service.generateImage({prompt:'test',path:'exists.png'}),code('MEDIA_OUTPUT_EXISTS'));assert.equal(h.requests.length,0);assert.equal(await fs.readFile(join(h.workspace,'exists.png'),'utf8'),'preserve')
})

test('a persisted job can be read by a new service instance but another session cannot read it',async t=>{
  const h=await fixture(t);const job=await h.service.generateImage({prompt:'test'})
  const second=createMediaService({account:h.account,credentials:h.credentials,api:{request:async()=>{throw Error('no API expected')}},workspace:h.workspace,fetchImpl:async()=>{throw Error('no fetch expected')},waitMs:0})
  t.after(()=>second.dispose())
  assert.deepEqual(await second.generationResult({id:job.id}),job)
  h.setRecord(grant('z'));await assert.rejects(second.generationResult({id:job.id}),code('MEDIA_ACCOUNT_CHANGED'))
})

test('unknown and malformed job IDs are rejected safely without inference',async t=>{
  const h=await fixture(t)
  await assert.rejects(h.service.generationResult({id:'../../secret'}),code('MEDIA_JOB_INVALID'))
  await assert.rejects(h.service.generationResult({id:'12345678-1234-1234-1234-123456789abc'}),code('MEDIA_JOB_NOT_FOUND'))
  assert.equal(h.requests.length,0)
})

test('video creates, polls and saves content with selected model, group and dimensions',async t=>{
  const h=await fixture(t);const queued=await h.service.generateVideo({prompt:'test video',model:'video-test',seconds:5,size:'1280x720',path:'out/movie.mp4'})
  assert.equal(queued.status,'running');assert.equal(JSON.parse(h.requests[0].body).seconds,'5')
  const done=await h.service.generationResult({id:queued.id});assert.equal(done.status,'completed');assert.deepEqual(await fs.readFile(done.files[0]),MP4)
  assert.deepEqual(h.requests.map(x=>new URL(x.url).pathname),['/v1/videos','/v1/videos/video_123','/v1/videos/video_123/content'])
  assert.ok(h.requests.every(x=>x.headers['X-NovaFlow-Group']===encodeURIComponent('视频组')))
  assert.equal((await h.service.generationResult({id:queued.id})).status,'completed');assert.equal(h.requests.length,3)
})

test('video references are uploaded as multipart and a remote task failure is persisted safely',async t=>{
  const h=await fixture(t,{fetch:async(url,init)=>url.endsWith('/videos')?response({task_id:'task_1'}):response({status:'failed',error:{message:'nfds_SECRET'}})})
  await fs.writeFile(join(h.workspace,'input.png'),PNG)
  const queued=await h.service.generateVideo({prompt:'test',model:'video-test',image:'input.png'})
  assert.ok(h.requests[0].body instanceof FormData);assert.equal(h.requests[0].body.get('input_reference').type,'image/png')
  const result=await h.service.generationResult({id:queued.id});assert.equal(result.error,'MEDIA_VIDEO_FAILED');assert.equal(JSON.stringify(result).includes('SECRET'),false)
  const saved=await fs.readFile(join(h.workspace,'.novaflow-media','jobs',queued.id+'.json'),'utf8');assert.equal(saved.includes('SECRET'),false)
})

test('account switching while an image response is pending prevents saving its result',async t=>{
  const gate=deferred(),entered=deferred()
  const h=await fixture(t,{waitMs:0,fetch:async()=>{entered.resolve();await gate.promise;return response({data:[{b64_json:PNG.toString('base64')}]})}})
  const initial=await h.service.generateImage({prompt:'test'});await entered.promise;assert.equal(initial.status,'running')
  h.setRecord(grant('z'));gate.resolve()
  for(let i=0;i<100;i++){const saved=JSON.parse(await fs.readFile(join(h.workspace,'.novaflow-media','jobs',initial.id+'.json'),'utf8'));if(saved.status!=='running')break;await new Promise(resolve=>setImmediate(resolve))}
  h.setRecord(grant())
  const result=await final(h.service,initial);assert.equal(result.status,'failed');assert.equal(result.error,'MEDIA_ACCOUNT_CHANGED');assert.equal(result.files,undefined)
})

test('public image URL downloads follow validated HTTPS redirects and do not forward platform credentials',async t=>{
  const h=await fixture(t,{fetch:async(url,init)=>{
    if(url===ORIGIN+'/v1/images/generations')return response({data:[{url:'https://cdn.example/image'}]})
    if(url==='https://cdn.example/image')return new Response(null,{status:302,headers:{location:'https://assets.example/final'}})
    return new Response(PNG,{headers:{'content-type':'image/png'}})
  }})
  const job=await h.service.generateImage({prompt:'test'});assert.equal(job.status,'completed')
  assert.equal(h.requests.length,3)
  for(const req of h.requests.slice(1)){assert.equal(req.redirect,'manual');assert.equal(req.headers,undefined)}
})

test('public URL policy rejects private addresses, credentials, HTTP, fragments, ports and DNS failures',async()=>{
  const publicLookup=async()=>[{address:'93.184.216.34'}]
  assert.equal((await publicURL('https://cdn.example/file',publicLookup)).href,'https://cdn.example/file')
  for(const url of ['http://cdn.example/a','https://user:pass@cdn.example/a','https://cdn.example:444/a','https://cdn.example/a#secret','https://127.0.0.1/a','https://10.0.0.1/a','https://localhost/a','https://[::1]/a'])await assert.rejects(publicURL(url,async()=>[{address:'127.0.0.1'}]),code('MEDIA_URL_INVALID'))
  await assert.rejects(publicURL('https://cdn.example/a',async()=>[{address:'93.184.216.34'},{address:'10.0.0.1'}]),code('MEDIA_URL_INVALID'))
  await assert.rejects(publicURL('https://missing.example/a',async()=>{throw Error('DNS secret detail')}),code('MEDIA_URL_INVALID'))
})

test('redirect to a private host is rejected and the generated image is not saved',async t=>{
  const h=await fixture(t,{fetch:async(url)=>url===ORIGIN+'/v1/images/generations'?response({data:[{url:'https://cdn.example/file'}]}):new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})})
  const result=await h.service.generateImage({prompt:'test'});assert.equal(result.status,'failed');assert.equal(result.error,'MEDIA_URL_INVALID');assert.equal(h.requests.length,2)
})

test('platform errors, network exceptions and rejected tokens never persist upstream secret bodies',async t=>{
  for(const [name,fetch,error] of [
    ['http',async()=>new Response('nfds_SECRET',{status:500}),'MEDIA_PLATFORM_ERROR'],
    ['network',async()=>{throw Error('nfdr_SECRET')},'MEDIA_NETWORK_ERROR'],
    ['auth',async()=>new Response('nfds_SECRET',{status:401}),'AUTH_REQUIRED'],
  ])await t.test(name,async t=>{
    const h=await fixture(t,{fetch});const result=await h.service.generateImage({prompt:'test'});assert.equal(result.status,name==='network'?'unknown':'failed');assert.equal(result.error,error)
    assert.equal(JSON.stringify(result).includes('SECRET'),false);const saved=await fs.readFile(join(h.workspace,'.novaflow-media','jobs',result.id+'.json'),'utf8');assert.equal(saved.includes('SECRET'),false)
    if(name==='auth')assert.equal(h.rejected.length,1)
  })
})

test('two concurrent result reads share one video poll and one content write',async t=>{
  const gate=deferred();let pollCount=0
  const h=await fixture(t,{fetch:async(url,init)=>{
    if(url.endsWith('/videos'))return response({id:'video_123'})
    if(url.endsWith('/content'))return new Response(MP4,{headers:{'content-type':'video/mp4'}})
    pollCount++;await gate.promise;return response({status:'completed'})
  }})
  const job=await h.service.generateVideo({prompt:'test',model:'video-test'})
  const a=h.service.generationResult({id:job.id}),b=h.service.generationResult({id:job.id});await new Promise(resolve=>setImmediate(resolve));gate.resolve()
  const values=await Promise.all([a,b]);assert.equal(pollCount,1);assert.deepEqual(values[0],values[1]);assert.equal(values[0].status,'completed')
})

test('video content must be valid MP4 media and not an HTML success response',async t=>{
  const h=await fixture(t,{fetch:async(url)=>url.endsWith('/videos')?response({id:'video_123'}):url.endsWith('/content')?new Response('<html>upstream secret</html>',{headers:{'content-type':'text/html'}}):response({status:'completed'})})
  const job=await h.service.generateVideo({prompt:'test',model:'video-test'})
  const result=await h.service.generationResult({id:job.id});assert.equal(result.status,'failed');assert.equal(result.error,'MEDIA_RESPONSE_INVALID')
  const saved=JSON.parse(await fs.readFile(join(h.workspace,'.novaflow-media','jobs',job.id+'.json'),'utf8'));assert.equal(saved.status,'failed');assert.equal(saved.error,'MEDIA_RESPONSE_INVALID')
  assert.equal((await fs.readdir(h.workspace)).includes('generated-videos'),false)
})

test('a running image job loaded after restart becomes interrupted instead of waiting forever',async t=>{
  const h=await fixture(t),id='12345678-1234-1234-1234-123456789abc'
  const {createHash}=await import('node:crypto')
  await fs.mkdir(join(h.workspace,'.novaflow-media','jobs'),{recursive:true})
  const saved={id,kind:'image',status:'running',model:DEFAULT_IMAGE_MODEL,group:'研发 A',owner:createHash('sha256').update(h.getRecord().payload.sessionId).digest('hex'),createdAt:Date.now()}
  await fs.writeFile(join(h.workspace,'.novaflow-media','jobs',id+'.json'),JSON.stringify(saved))
  const result=await h.service.generationResult({id});assert.equal(result.status,'failed');assert.equal(result.error,'MEDIA_JOB_INTERRUPTED');assert.equal(h.requests.length,0)
  assert.equal(JSON.parse(await fs.readFile(join(h.workspace,'.novaflow-media','jobs',id+'.json'),'utf8')).status,'failed')
})

test('preflight checks every numbered output before any generation submission',async t=>{
  const h=await fixture(t);await fs.mkdir(join(h.workspace,'out'));await fs.writeFile(join(h.workspace,'out','multi-2.png'),'original second')
  await assert.rejects(h.service.generateImage({prompt:'test',path:'out/multi.png',n:3}),code('MEDIA_OUTPUT_EXISTS'))
  assert.equal(h.requests.length,0);assert.equal(h.apiCalls.length,0);assert.equal(await fs.readFile(join(h.workspace,'out','multi-2.png'),'utf8'),'original second')
  assert.deepEqual(await fs.readdir(join(h.workspace,'out')),['multi-2.png'])
})

test('a submitted image without an exchange result recovers as unknown and never resubmits',async t=>{
  const h=await fixture(t),id='12345678-1234-1234-1234-123456789abc'
  const {createHash}=await import('node:crypto');await fs.mkdir(join(h.workspace,'.novaflow-media','jobs'),{recursive:true})
  const saved={id,kind:'image',status:'running',submissionStarted:true,model:DEFAULT_IMAGE_MODEL,group:'研发 A',owner:createHash('sha256').update(h.getRecord().payload.sessionId).digest('hex')}
  await fs.writeFile(join(h.workspace,'.novaflow-media','jobs',id+'.json'),JSON.stringify(saved))
  const result=await h.service.generationResult({id});assert.equal(result.status,'unknown');assert.equal(result.error,'MEDIA_JOB_INTERRUPTED');assert.match(result.message,/may already be billed/)
  assert.equal((await h.service.generationResult({id})).status,'unknown');assert.equal(h.requests.length,0)
})

test('a completed image file and matching persisted output plan recover without another generation',async t=>{
  const h=await fixture(t),id='12345678-1234-1234-1234-123456789abc'
  const {createHash}=await import('node:crypto');await fs.mkdir(join(h.workspace,'.novaflow-media','jobs'),{recursive:true});await fs.mkdir(join(h.workspace,'out'))
  const path=join(h.workspace,'out','recovered.png');await fs.writeFile(path,PNG)
  const saved={id,kind:'image',status:'running',submissionStarted:true,expectedOutputCount:1,outputPlan:[{path,sha256:createHash('sha256').update(PNG).digest('hex')}],model:DEFAULT_IMAGE_MODEL,group:'研发 A',owner:createHash('sha256').update(h.getRecord().payload.sessionId).digest('hex')}
  await fs.writeFile(join(h.workspace,'.novaflow-media','jobs',id+'.json'),JSON.stringify(saved))
  const result=await h.service.generationResult({id});assert.equal(result.status,'completed');assert.deepEqual(result.files,[path]);assert.equal(h.requests.length,0);assert.deepEqual(await fs.readFile(path),PNG)
})

test('video result recovery accepts only its own hash-matched existing output without overwriting it',async t=>{
  const h=await fixture(t),id='12345678-1234-1234-1234-123456789abc'
  const {createHash}=await import('node:crypto');await fs.mkdir(join(h.workspace,'.novaflow-media','jobs'),{recursive:true});await fs.mkdir(join(h.workspace,'out'))
  const path=join(h.workspace,'out','movie.mp4');await fs.writeFile(path,MP4)
  const saved={id,kind:'video',status:'running',submissionStarted:true,remoteId:'video_123',path:'out/movie.mp4',outputPlan:[{path,sha256:createHash('sha256').update(MP4).digest('hex')}],model:'video-test',group:'视频组',owner:createHash('sha256').update(h.getRecord().payload.sessionId).digest('hex')}
  await fs.writeFile(join(h.workspace,'.novaflow-media','jobs',id+'.json'),JSON.stringify(saved))
  const result=await h.service.generationResult({id});assert.equal(result.status,'completed');assert.deepEqual(result.files,[path]);assert.equal(h.requests.length,2);assert.ok(h.requests.every(req=>req.method==='GET'));assert.deepEqual(await fs.readFile(path),MP4)
})

test('a mismatching persisted output hash cannot mark an interrupted image complete',async t=>{
  const h=await fixture(t),id='12345678-1234-1234-1234-123456789abc'
  const {createHash}=await import('node:crypto');await fs.mkdir(join(h.workspace,'.novaflow-media','jobs'),{recursive:true})
  const path=join(h.workspace,'wrong.png');await fs.writeFile(path,'different bytes')
  const saved={id,kind:'image',status:'running',submissionStarted:true,expectedOutputCount:1,outputPlan:[{path,sha256:createHash('sha256').update(PNG).digest('hex')}],model:DEFAULT_IMAGE_MODEL,group:'研发 A',owner:createHash('sha256').update(h.getRecord().payload.sessionId).digest('hex')}
  await fs.writeFile(join(h.workspace,'.novaflow-media','jobs',id+'.json'),JSON.stringify(saved))
  const result=await h.service.generationResult({id});assert.equal(result.status,'unknown');assert.equal(result.files,undefined);assert.equal(h.requests.length,0);assert.equal(await fs.readFile(path,'utf8'),'different bytes')
})

test('job storage refuses a symlinked metadata directory before requesting a generation',async t=>{
  const h=await fixture(t),outside=await fs.realpath(await fs.mkdtemp(join(tmpdir(),'novaflow-media-outside-')))
  t.after(()=>fs.rm(outside,{recursive:true,force:true}))
  await fs.symlink(outside,join(h.workspace,'.novaflow-media'))
  await assert.rejects(h.service.generateImage({prompt:'test'}),code('MEDIA_PATH_INVALID'))
  assert.equal(h.requests.length,0);assert.deepEqual(await fs.readdir(outside),[])
})

test('clear aborts the current account work and a subsequent call can use the new lifetime',async t=>{
  const entered=deferred();let calls=0
  const h=await fixture(t,{waitMs:0,fetch:async(_url,init)=>{
    if(++calls>1)return response({data:[{b64_json:PNG.toString('base64')}]})
    entered.resolve();return new Promise((resolve,reject)=>{const abort=()=>reject(Error('aborted'));init.signal.addEventListener('abort',abort,{once:true});if(init.signal.aborted)abort()})
  }})
  const pending=await h.service.generateImage({prompt:'test'});await entered.promise;h.service.clear()
  const failed=await final(h.service,pending);assert.equal(failed.status,'unknown');assert.match(failed.message,/may already be billed/);assert.match(failed.message,/Do not submit it again/)
  const next=await final(h.service,await h.service.generateImage({prompt:'new'}));assert.equal(next.status,'completed')
})

test('generation deadlines abort the fake request and persist a safe failure',async t=>{
  const h=await fixture(t,{timeoutMs:20,waitMs:100,fetch:async(_url,init)=>new Promise((resolve,reject)=>{const abort=()=>reject(Error('nfds_SECRET timeout'));init.signal.addEventListener('abort',abort,{once:true});if(init.signal.aborted)abort()})})
  const result=await h.service.generateImage({prompt:'test'});assert.equal(result.status,'unknown');assert.equal(result.error,'MEDIA_NETWORK_ERROR');assert.equal(JSON.stringify(result).includes('SECRET'),false)
  const saved=JSON.parse(await fs.readFile(join(h.workspace,'.novaflow-media','jobs',result.id+'.json'),'utf8'));assert.equal(saved.status,'unknown');assert.equal(saved.submissionStarted,true)
  const count=h.requests.length;const again=await h.service.generationResult({id:result.id});assert.equal(again.status,'unknown');assert.equal(h.requests.length,count,'unknown submission is never automatically resubmitted')
})

test('another session cannot change a persisted interrupted job before rejecting access',async t=>{
  const h=await fixture(t),id='12345678-1234-1234-1234-123456789abc'
  const {createHash}=await import('node:crypto');await fs.mkdir(join(h.workspace,'.novaflow-media','jobs'),{recursive:true})
  const original=JSON.stringify({id,kind:'image',status:'running',model:DEFAULT_IMAGE_MODEL,group:'研发 A',owner:createHash('sha256').update(h.getRecord().payload.sessionId).digest('hex')})
  const path=join(h.workspace,'.novaflow-media','jobs',id+'.json');await fs.writeFile(path,original);h.setRecord(grant('z'))
  await assert.rejects(h.service.generationResult({id}),code('MEDIA_ACCOUNT_CHANGED'));assert.equal(await fs.readFile(path,'utf8'),original)
})

test('dispose aborts running generation, persists failure and disallows new work',async t=>{
  const entered=deferred()
  const h=await fixture(t,{waitMs:0,fetch:async(_url,init)=>{entered.resolve();return new Promise((resolve,reject)=>{const abort=()=>reject(Error('aborted'));init.signal.addEventListener('abort',abort,{once:true});if(init.signal.aborted)abort()})}})
  const job=await h.service.generateImage({prompt:'test'});await entered.promise;await h.service.dispose()
  const persisted=JSON.parse(await fs.readFile(join(h.workspace,'.novaflow-media','jobs',job.id+'.json'),'utf8'));assert.equal(persisted.status,'unknown');assert.equal(persisted.submissionStarted,true)
  await assert.rejects(h.service.listModels(),code('MEDIA_UNAVAILABLE'))
})
