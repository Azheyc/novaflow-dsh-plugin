import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire, findPackageJSON } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createMediaMcp, MEDIA_MCP_INSTRUCTIONS } from '../src/media-mcp.js'

async function installedSdk() {
  const require=createRequire(import.meta.url)
  const anchors=[process.env.DSH_INSTALL_DIR,process.argv[1],process.resourcesPath && resolve(process.resourcesPath,'app.asar/dsh')].filter(Boolean)
  let anchor
  for(const candidate of anchors)try{anchor=require.resolve('@deepseek-ai/dsh-mcp-client',{paths:[candidate]});break}catch{}
  assert.ok(anchor,'test requires the current installed DSH MCP client')
  const manifestPath=findPackageJSON('@modelcontextprotocol/client',pathToFileURL(anchor))
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
  const target=manifest.exports['.'].import.default
  return import(pathToFileURL(resolve(dirname(manifestPath),target)).href)
}
const {Client,StreamableHTTPClientTransport}=await installedSdk()
const key='nfm_'+'k'.repeat(43)
const path='/novaflow/magpie-image/mcp'
function deferred(){let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve}}
async function fixture(t,overrides={}) {
  const calls=[]
  const service={
    generateImage:async args=>{calls.push(['image',args]);return {status:'completed',files:['/synthetic/image.webp']}},
    generateVideo:async args=>{calls.push(['video',args]);return {status:'running',id:'job-video'}},
    generationResult:async args=>{calls.push(['result',args]);return {status:'completed',files:['/synthetic/video.mp4']}},
    listModels:async args=>{calls.push(['models',args]);return {models:[{id:args.kind==='video'?'video-original-id':'gpt-image-2.6',group:'authorized group'}]}},
    ...overrides,
  }
  let mcp
  const server=http.createServer((req,res)=>{void mcp.handler(req,res)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin=`http://127.0.0.1:${server.address().port}`
  mcp=createMediaMcp({service,origin,key})
  const clients=[]
  t.after(async()=>{mcp.dispose();for(const client of clients)await client.close().catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  async function connect() {
    const client=new Client({name:'novaflow-mcp-real-sdk-test',version:'1.0.0'})
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(origin+path),{requestInit:{headers:{Authorization:'Bearer '+key}}}))
    return client
  }
  const post=(message,headers={})=>fetch(origin+path,{method:'POST',headers:{Authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json, text/event-stream',...headers},body:typeof message==='string'?message:JSON.stringify(message)})
  return {service,calls,mcp,server,origin,connect,post}
}
const text=result=>JSON.parse(result.content.find(item=>item.type==='text').text)

test('actual installed MCP SDK initializes stateless HTTP, receives instructions and lists exact tools/schemas',async t=>{
  const f=await fixture(t),client=await f.connect()
  assert.equal(client.getInstructions(),MEDIA_MCP_INSTRUCTIONS)
  assert.match(client.getInstructions(),/gpt-image-2\.6/)
  assert.match(client.getInstructions(),/explicitly select/)
  assert.match(client.getInstructions(),/Never use a default/)
  assert.equal(client.getServerVersion().name,'novaflow-magpie-image')
  const result=await client.listTools()
  assert.deepEqual(result.tools.map(tool=>tool.name),['generate_image','generate_video','generation_result','list_models'])
  const image=result.tools.find(tool=>tool.name==='generate_image'),video=result.tools.find(tool=>tool.name==='generate_video')
  assert.deepEqual(image.inputSchema.required,['prompt'])
  assert.deepEqual(video.inputSchema.required,['prompt','model'])
  assert.deepEqual(image.inputSchema.properties.n,{type:'integer',minimum:1,maximum:4})
  assert.equal(video.inputSchema.additionalProperties,false)
  assert.equal((await client.ping()).constructor,Object)
  assert.equal(f.calls.length,0)
})
test('SDK image call defaults to NovaFlow gpt-image-2.6 without provider configuration',async t=>{
  const f=await fixture(t),client=await f.connect()
  const result=await client.callTool({name:'generate_image',arguments:{prompt:'synthetic illustration',n:2,reference_images:['/synthetic/reference.png']}})
  assert.deepEqual(text(result),{status:'completed',files:['/synthetic/image.webp']})
  assert.deepEqual(f.calls,[['image',{prompt:'synthetic illustration',n:2,reference_images:['/synthetic/reference.png'],model:'gpt-image-2.6'}]])
  await client.callTool({name:'generate_image',arguments:{prompt:'explicit model',model:'image-original-id',group:'chosen group',quality:'high'}})
  assert.equal(f.calls[1][1].model,'image-original-id');assert.equal(f.calls[1][1].group,'chosen group')
})
test('SDK video without a model never reaches service; list then explicit original model works',async t=>{
  const f=await fixture(t),client=await f.connect()
  const denied=await client.callTool({name:'generate_video',arguments:{prompt:'model unspecified'}})
  assert.equal(denied.isError,true);assert.equal(text(denied).code,'VIDEO_MODEL_REQUIRED');assert.equal(f.calls.length,0)
  const listed=await client.callTool({name:'list_models',arguments:{kind:'video'}})
  assert.equal(text(listed).models[0].id,'video-original-id')
  const result=await client.callTool({name:'generate_video',arguments:{prompt:'user selected model',model:'video-original-id',group:'chosen group',seconds:8,image:'/synthetic/start.png'}})
  assert.deepEqual(text(result),{status:'running',id:'job-video'})
  assert.equal(f.calls[1][0],'video');assert.equal(f.calls[1][1].model,'video-original-id')
  const completed=await client.callTool({name:'generation_result',arguments:{id:'job-video'}})
  assert.deepEqual(text(completed),{status:'completed',files:['/synthetic/video.mp4']})
})
test('notifications use 202, stateless GET/DELETE use 405, and malformed RPC is bounded',async t=>{
  const f=await fixture(t)
  const notified=await f.post({jsonrpc:'2.0',method:'notifications/initialized'})
  assert.equal(notified.status,202);assert.equal(await notified.text(),'');assert.equal(notified.headers.get('mcp-session-id'),null)
  for(const method of ['GET','DELETE']){const r=await fetch(f.origin+path,{method,headers:{Authorization:'Bearer '+key}});assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');await r.body.cancel()}
  const malformed=await f.post('{')
  assert.equal(malformed.status,400);assert.equal((await malformed.json()).error.code,-32700)
  const batch=await f.post([{jsonrpc:'2.0',id:1,method:'ping'}]);assert.equal(batch.status,400);await batch.body.cancel()
  const unsupported=await f.post({jsonrpc:'2.0',id:1,method:'ping'},{'mcp-protocol-version':'unsupported'})
  assert.equal(unsupported.status,400);assert.equal((await unsupported.json()).error.message,'UNSUPPORTED_PROTOCOL_VERSION')
  const tooLarge=await f.post(' '.repeat(512*1024+1));assert.equal(tooLarge.status,413);assert.equal((await tooLarge.json()).error.message,'BODY_TOO_LARGE')
  assert.equal(f.calls.length,0)
})
test('authority, remote IP, origin, authorization and body format checks prevent any service work',async t=>{
  const f=await fixture(t)
  for(const [headers,status] of [[{Authorization:'Bearer bad'},401],[{origin:'https://evil.example'},403],[{'sec-fetch-site':'cross-site'},403],[{'content-type':'text/plain'},415]]) {
    const response=await f.post({jsonrpc:'2.0',id:1,method:'tools/list'},headers)
    assert.equal(response.status,status,Object.keys(headers).join(','));const result=await response.json();assert.equal(JSON.stringify(result).includes(key),false)
  }
  const wrongHost=await new Promise((resolve,reject)=>{
    const request=http.request(f.origin+path,{method:'POST',headers:{Host:'evil.example',Authorization:'Bearer '+key,'content-type':'application/json'}},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,body}))})
    request.on('error',reject);request.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}))
  })
  assert.equal(wrongHost.status,403);assert.equal(JSON.parse(wrongHost.body).error.message,'FORBIDDEN')
  let status,body
  const res={destroyed:false,writableEnded:false,writeHead:(value)=>{status=value},end:value=>{body=value},removeListener:()=>{}}
  await f.mcp.handler({headers:{host:new URL(f.origin).host,authorization:'Bearer '+key},socket:{remoteAddress:'203.0.113.2'},method:'POST',url:path},res)
  assert.equal(status,403);assert.equal(JSON.parse(body).error.message,'FORBIDDEN')
  const query=await fetch(f.origin+path+'?token=forbidden',{method:'POST',headers:{Authorization:'Bearer '+key,'content-type':'application/json'},body:'{}'})
  assert.equal(query.status,404);await query.body.cancel();assert.equal(f.calls.length,0)
})
test('schemas enforce argument shape and service exceptions never reveal raw diagnostics',async t=>{
  const f=await fixture(t,{generateImage:async()=>{throw Error('nfds_private_stack_secret')}}),client=await f.connect()
  for(const args of [{prompt:'x',n:5},{prompt:'x',model:''},{prompt:'x',reference_images:[8]},{prompt:'x',unrecognized:'no'}]) {
    await assert.rejects(client.callTool({name:'generate_image',arguments:args}),/INVALID_PARAMS/)
  }
  const result=await client.callTool({name:'generate_image',arguments:{prompt:'synthetic error'}})
  assert.equal(result.isError,true);assert.equal(text(result).code,'MEDIA_OPERATION_FAILED');assert.equal(JSON.stringify(result).includes('private'),false)
  await assert.rejects(client.callTool({name:'unknown_tool',arguments:{}}),/UNKNOWN_TOOL/)
})
test('dispose rejects new requests and finishes in-flight replies without waiting for service work',async t=>{
  const entered=deferred(),finished=deferred()
  const f=await fixture(t,{generateImage:async()=>{entered.resolve();await finished.promise;return {status:'completed',files:[]}}})
  const request=f.post({jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'generate_image',arguments:{prompt:'blocked synthetic job'}}})
  await entered.promise;f.mcp.dispose()
  const response=await request;assert.equal(response.status,503);assert.equal((await response.json()).error.message,'MEDIA_MCP_DISPOSED')
  const next=await f.post({jsonrpc:'2.0',id:9,method:'tools/list'});assert.equal(next.status,503);await next.body.cancel()
  finished.resolve()
})
