import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { loadNativeLibraries } from '../src/native-models.js'
import { createModelBridge } from '../src/model-bridge.js'

const KEY = 'bridge-test-key-' + 'k'.repeat(43)
const TOKEN = 'nfds_' + 't'.repeat(43)
const definitions = [
  {provider:'nova-chat',api:'openai-completions',path:'/v1/chat/completions'},
  {provider:'nova-responses',api:'openai-responses',path:'/v1/responses'},
  {provider:'nova-anthropic',api:'anthropic-messages',path:'/v1/messages'},
]
const routes = () => definitions.map(row=>({provider:row.provider,api:row.api,group:'企业 空间/A',key:KEY,models:[{id:'exact/model',name:'Model name',contextWindow:32768,maxTokens:4096}]}))
const routePath = (provider='nova-chat',path='/v1/chat/completions')=>'/novaflow/models/'+provider+path
const deferred = () => {let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
async function fixture(t, options={}) {
  let bridge
  const calls=[],rejections=[],backpressure=[]
  const account={accessToken:async()=>TOKEN,rejectToken:async token=>{rejections.push(token)},...options.account}
  const server=http.createServer((req,res)=>{
    const write=res.write.bind(res)
    res.write=(...args)=>{const ready=write(...args);if(!ready)backpressure.push(true);return ready}
    void bridge.handler(req,res)
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const origin='http://127.0.0.1:'+server.address().port
  bridge=createModelBridge({account,origin,timeoutMs:options.timeoutMs??5000,fetchImpl:async(url,init)=>{
    calls.push({url,init})
    if(options.fetchImpl)return options.fetchImpl(url,init)
    return new Response(JSON.stringify({id:'synthetic',choices:[]}),{headers:{'content-type':'application/json','set-cookie':'upstream-secret','www-authenticate':'secret','x-debug-token':TOKEN}})
  }})
  bridge.setRoutes(routes())
  t.after(async()=>{bridge.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  function request(path=routePath(),{method='POST',headers={},body,auth=true}={}) {
    if (body === undefined && method === 'POST') body = JSON.stringify({model:'exact/model',messages:[]})
    return new Promise((resolve,reject)=>{
      const req=http.request(origin,{method,path,headers:{...(auth?{authorization:'Bearer '+KEY}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...headers}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));res.on('error',reject)
      })
      req.on('error',reject);req.end(body)
    })
  }
  return {bridge,server,origin,calls,rejections,backpressure,request}
}

for(const protocol of definitions) test(`${protocol.api}: exact endpoint, dynamic Bearer, encoded group and unchanged JSON`,async t=>{
  let issued=0
  const f=await fixture(t,{account:{accessToken:async()=>TOKEN+(++issued)}})
  const payload='{ "model": "exact/model", "stream": true, "reasoning": {"effort":"high"}, "thinking":{"type":"enabled","budget_tokens":2048}, "future_extension": [1,2] }'
  for(let index=1;index<=2;index++){
    const r=await f.request(routePath(protocol.provider,protocol.path),{body:payload,auth:false,headers:{'x-api-key':KEY,cookie:'local-secret','x-client-secret':'local-secret'}})
    assert.equal(r.status,200)
    const call=f.calls[index-1]
    assert.equal(call.url,'https://www.ycnovaflow.vip'+protocol.path)
    assert.equal(call.init.redirect,'error');assert.equal(call.init.body.toString('utf8'),payload)
    assert.equal(call.init.headers.Authorization,'Bearer '+TOKEN+index)
    assert.equal(call.init.headers['X-NovaFlow-Group'],encodeURIComponent('企业 空间/A'))
    assert.deepEqual(Object.keys(call.init.headers).sort(),['Accept','Authorization','Content-Type','X-NovaFlow-Group'].sort())
    assert.equal(JSON.stringify(call.init.headers).includes(KEY),false)
    assert.equal(r.headers['set-cookie'],undefined);assert.equal(r.headers['www-authenticate'],undefined);assert.equal(r.headers['x-debug-token'],undefined)
  }
})

test('discovery supports both models paths without exposing group or device/local credentials',async t=>{
  const f=await fixture(t,{account:{accessToken:async()=>{throw Error('discovery must not refresh token')}}})
  for(const suffix of ['/models','/v1/models']) {
    const r=await f.request(routePath('nova-anthropic',suffix),{method:'GET',body:undefined})
    assert.equal(r.status,200)
    assert.deepEqual(JSON.parse(r.body),{object:'list',data:[{id:'exact/model',object:'model',name:'Model name',display_name:'Model name',contextWindow:32768,context_window:32768,maxTokens:4096,max_output_tokens:4096}]})
    for(const secret of [KEY,TOKEN,'企业 空间/A'])assert.equal(r.body.includes(secret),false)
  }
  assert.equal(f.calls.length,0)
})

test('native Anthropic discovery accepts only a unique optional limit from 1 through 1000',async t=>{
  const f=await fixture(t)
  f.bridge.setRoutes(routes().map(route=>({...route,models:[...route.models,{id:'second',name:'Second'}]})))
  for(const suffix of ['/v1/models','/models']) {
    const full=await f.request(routePath('nova-anthropic',suffix)+'?limit=1000',{method:'GET'})
    assert.equal(full.status,200);assert.equal(JSON.parse(full.body).data.length,2)
    const limited=await f.request(routePath('nova-anthropic',suffix)+'?limit=1',{method:'GET'})
    assert.equal(limited.status,200);assert.equal(JSON.parse(limited.body).data.length,1)
    for(const query of ['?','?limit=0','?limit=1001','?limit=-1','?limit=01','?limit=1.5','?limit=1&limit=2','?limit=1000&extra=1','?extra=1']) {
      const r=await f.request(routePath('nova-anthropic',suffix)+query,{method:'GET'})
      assert.equal(r.status,400,query)
    }
  }
  assert.equal((await f.request(routePath()+'?limit=1000')).status,404)
  assert.equal(f.calls.length,0)
})

test('rejects missing credentials, wrong authority/origin, arbitrary paths and models before upstream I/O',async t=>{
  const f=await fixture(t)
  const cases=[
    [routePath(),{auth:false},401],
    [routePath(),{headers:{authorization:'Bearer wrong'}},401],
    [routePath(),{headers:{host:'evil.invalid'}},403],
    [routePath(),{headers:{origin:'https://evil.invalid'}},403],
    [routePath(),{headers:{origin:'null'}},403],
    [routePath(),{headers:{'sec-fetch-site':'cross-site'}},403],
    [routePath()+'?upstream=https://evil.invalid',{},404],
    ['/novaflow/models/nova-chat/%2e%2e/v1/chat/completions',{},404],
    ['/novaflow/models/unknown/v1/chat/completions',{},404],
    [routePath('nova-chat','/v1/messages'),{},405],
    [routePath(),{method:'DELETE'},405],
    [routePath(),{body:'{"model":"not-authorized"}'},400],
    [routePath(),{body:'broken json'},400],
    [routePath(),{body:'[]'},400],
    [routePath(),{headers:{'content-type':'text/plain'}},415],
    [routePath(),{headers:{'content-encoding':'gzip'}},415],
    [routePath(),{headers:{'content-length':String(16*1024*1024+1)},body:'{}'},413],
  ]
  for(const [path,init,status] of cases){const r=await f.request(path,init);assert.equal(r.status,status,JSON.stringify([path,init]));assert.ok(JSON.parse(r.body).error.code)}
  assert.equal(f.calls.length,0)
  assert.equal((await f.request(routePath(),{headers:{origin:f.origin}})).status,200)
})

test('caps a chunked JSON upload at 16 MiB',async t=>{
  const f=await fixture(t)
  const r=await f.request(routePath(),{headers:{'transfer-encoding':'chunked'},body:' '.repeat(16*1024*1024+1)})
  assert.equal(r.status,413);assert.equal(f.calls.length,0)
})

test('HTTP errors are safe OpenAI envelopes; 401 rejects only the issued device token without retry',async t=>{
  let code=401
  const f=await fixture(t,{fetchImpl:async()=>new Response('upstream secret '+TOKEN+' '+KEY,{status:code,headers:{'content-type':'application/json','set-cookie':TOKEN}})})
  for(const status of [401,403,429,500]){
    code=status
    const r=await f.request()
    assert.equal(r.status,status);assert.equal(r.body.includes(TOKEN),false);assert.equal(r.body.includes(KEY),false);assert.equal(r.headers['set-cookie'],undefined)
    const error=JSON.parse(r.body).error
    assert.equal(error.type,'novaflow_bridge_error');assert.equal(error.code,status===401?'ACCOUNT_TOKEN_REJECTED':'UPSTREAM_ERROR')
  }
  assert.deepEqual(f.rejections,[TOKEN]);assert.equal(f.calls.length,4)
})

test('401 remains an authentication error when account rejection clears the bridge',async t=>{
  let f
  f=await fixture(t,{account:{rejectToken:async()=>f.bridge.clear()},fetchImpl:async()=>new Response('secret',{status:401})})
  const r=await f.request();assert.equal(r.status,401);assert.equal(JSON.parse(r.body).error.code,'ACCOUNT_TOKEN_REJECTED')
})

test('network and redirect failures are sanitized and invalid success types are rejected',async t=>{
  let outcome='throw'
  const f=await fixture(t,{fetchImpl:async()=>{
    if(outcome==='throw')throw Error('fetch error '+TOKEN)
    if(outcome==='redirect')return new Response(null,{status:302,headers:{location:'https://evil.invalid/'+TOKEN}})
    return new Response('<html>unexpected</html>',{headers:{'content-type':'text/html'}})
  }})
  for(const value of ['throw','redirect','html']) {outcome=value;const r=await f.request();assert.equal(r.status,502);assert.equal(r.body.includes(TOKEN),false)}
})

test('SSE streams unchanged with actual ServerResponse backpressure',async t=>{
  const chunk='data: '+JSON.stringify({text:'x'.repeat(256*1024)})+'\n\n'
  let count=0
  const f=await fixture(t,{fetchImpl:async()=>new Response(new ReadableStream({pull(controller){if(count++<4)controller.enqueue(new TextEncoder().encode(chunk));else controller.close()}}),{headers:{'content-type':'text/event-stream','set-cookie':'not-forwarded'}})})
  const r=await f.request(routePath(),{body:JSON.stringify({model:'exact/model',stream:true})})
  assert.equal(r.status,200);assert.equal(r.body,chunk.repeat(4));assert.ok(f.backpressure.length>0);assert.equal(r.headers['set-cookie'],undefined)
})

test('clear aborts an active upstream request and removes discovery access',async t=>{
  const entered=deferred();let signal
  const f=await fixture(t,{fetchImpl:async(_url,init)=>{signal=init.signal;entered.resolve();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('secret')), {once:true}))}})
  const work=f.request();await entered.promise;f.bridge.clear()
  const r=await work;assert.equal(r.status,503);assert.equal(signal.aborted,true)
  assert.equal((await f.request(routePath('nova-chat','/v1/models'),{method:'GET',body:undefined})).status,404)
})

test('route replacement cancels waiting token resolution and never forwards a late token',async t=>{
  const entered=deferred(),token=deferred()
  const f=await fixture(t,{account:{accessToken:async()=>{entered.resolve();return token.promise}}})
  const work=f.request();await entered.promise;f.bridge.setRoutes(routes().map(route=>({...route,key:KEY+'new'})))
  assert.equal((await work).status,503);token.resolve(TOKEN)
  assert.equal(f.calls.length,0)
  assert.equal((await f.request()).status,401)
  assert.equal((await f.request(routePath('nova-chat','/models'),{method:'GET',body:undefined,headers:{authorization:'Bearer '+KEY+'new'}})).status,200)
})

test('timeout aborts SDK fetch and reports a bounded safe failure',async t=>{
  let signal
  const f=await fixture(t,{timeoutMs:30,fetchImpl:async(_url,init)=>{signal=init.signal;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error(TOKEN)),{once:true}))}})
  const r=await f.request();assert.equal(r.status,504);assert.equal(JSON.parse(r.body).error.code,'BRIDGE_TIMEOUT');assert.equal(signal.aborted,true)
})

test('client close cancels the upstream SSE reader and fetch lifetime',async t=>{
  const cancelled=deferred();let signal
  const f=await fixture(t,{fetchImpl:async(_url,init)=>{
    signal=init.signal
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"first":true}\n\n'))},cancel(){cancelled.resolve()}}),{headers:{'content-type':'text/event-stream'}})
  }})
  await new Promise((resolve,reject)=>{
    const req=http.request(f.origin+routePath(),{method:'POST',headers:{authorization:'Bearer '+KEY,'content-type':'application/json'}},res=>{res.once('data',()=>{res.destroy();resolve()})})
    req.on('error',reject);req.end(JSON.stringify({model:'exact/model',stream:true}))
  })
  await cancelled.promise;assert.equal(signal.aborted,true)
})

test('Anthropic beta query and protocol headers are tightly allowlisted',async t=>{
  const f=await fixture(t)
  const path=routePath('nova-anthropic','/v1/messages')
  const valid=await f.request(path+'?beta=true',{headers:{'anthropic-beta':'interleaved-thinking-2025-05-14','anthropic-version':'2023-06-01',cookie:'never-forward'}})
  assert.equal(valid.status,200)
  assert.equal(f.calls[0].url,'https://www.ycnovaflow.vip/v1/messages?beta=true')
  assert.equal(f.calls[0].init.headers['anthropic-beta'],'interleaved-thinking-2025-05-14')
  assert.equal(f.calls[0].init.headers['anthropic-version'],'2023-06-01')
  assert.equal(f.calls[0].init.headers.cookie,undefined)
  for(const query of ['?beta=false','?beta=true&beta=true','?beta=true&extra=1','?beta=1'])assert.equal((await f.request(path+query)).status,404)
  assert.equal((await f.request(routePath()+'?beta=true')).status,404)
  assert.equal((await f.request(path,{headers:{'anthropic-beta':'x'.repeat(2049)}})).status,400)
  assert.equal(f.calls.length,1)
})

test('actual installed Anthropic SDK traverses the real loopback bridge with beta and thinking',async t=>{
  const libs=await loadNativeLibraries()
  const sse = [
    ['message_start',{type:'message_start',message:{id:'synthetic',type:'message',role:'assistant',model:'exact/model',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}}],
    ['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],
    ['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'bridge-ok'}}],
    ['content_block_stop',{type:'content_block_stop',index:0}],
    ['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}}],
    ['message_stop',{type:'message_stop'}],
  ].map(([event,data])=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n').join('')
  const f=await fixture(t,{fetchImpl:async()=>new Response(sse,{headers:{'content-type':'text/event-stream'}})})
  const model={id:'exact/model',name:'Test',provider:'nova-anthropic',api:'anthropic-messages',baseUrl:f.origin+'/novaflow/models/nova-anthropic',input:['text'],reasoning:true,contextWindow:32768,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}
  const stream=libs.protocols['anthropic-messages'].streamSimple(model,{messages:[{role:'user',content:'hello',timestamp:Date.now()}]}, {apiKey:KEY,maxTokens:4096,reasoning:'low',headers:{'anthropic-beta':'interleaved-thinking-2025-05-14'},maxRetries:0})
  const events=[]
  for await(const event of stream)events.push(event)
  assert.equal(f.calls.length,1,JSON.stringify(events))
  assert.equal(f.calls[0].url,'https://www.ycnovaflow.vip/v1/messages?beta=true')
  assert.equal(f.calls[0].init.headers.Authorization,'Bearer '+TOKEN)
  assert.equal(f.calls[0].init.headers['X-NovaFlow-Group'],encodeURIComponent('企业 空间/A'))
  assert.equal(f.calls[0].init.headers['anthropic-version'],'2023-06-01')
  assert.ok(f.calls[0].init.headers['anthropic-beta'].includes('interleaved-thinking-2025-05-14'))
  const body=JSON.parse(f.calls[0].init.body.toString())
  assert.equal(body.model,'exact/model');assert.equal(body.thinking.type,'enabled');assert.ok(body.thinking.budget_tokens>0)
  assert.equal(events.some(event=>event.type==='text_delta'&&event.delta==='bridge-ok'),true,JSON.stringify(events))
  assert.equal(events.at(-1).type,'done')
})

test('route updates validate transactionally and dispose refuses further use',async t=>{
  const f=await fixture(t)
  assert.throws(()=>f.bridge.setRoutes([{...routes()[0],key:'short'}]),/Invalid/)
  assert.equal((await f.request()).status,200)
  f.bridge.dispose()
  assert.equal((await f.request()).status,503)
  assert.throws(()=>f.bridge.setRoutes(routes()),/disposed/)
})
