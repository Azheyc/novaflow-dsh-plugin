import test from 'node:test'
import assert from 'node:assert/strict'
import {parseBalance} from '../src/balance.js'
import {NovaAccount} from '../src/account.js'
import {NovaApi,NovaError,ORIGIN,PREFIX,RECORD,tokenPair} from '../src/protocol.js'

const now=1800000000000
const token='nfds_'+'a'.repeat(43)
const pair={token_type:'Bearer',access_token:token,refresh_token:'nfdr_'+'r'.repeat(43),session_id:'nfdev_'+'s'.repeat(43),expires_in:900,refresh_expires_in:2592000}
const personal=(value='12.345678')=>({schema_version:1,account_mode:'personal',personal:{balance:value,frozen:'0',available:value,unit:'CNY'},limits:null,as_of:new Date(now).toISOString()})
const enterprise=()=>({schema_version:1,account_mode:'enterprise',company:{balance:'120.50',frozen:'20.25',available:'100.25',unit:'CNY'},limits:{daily_mode:'limited',daily_limit:20,daily_used:'20',daily_remaining:0,monthly_mode:'unlimited',monthly_limit:null,monthly_used:'25.125',monthly_remaining:null,can_use:false,block_reason:'insufficient_company_quota_or_limit'},as_of:new Date(now).toISOString()})
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}}
function fixture(t,{usage=()=>personal(),api:providedApi}={}) {
  let record={kind:'grant',payload:tokenPair(pair,now)}
  const calls=[]
  const credentials={readRecord:async key=>{assert.equal(key,RECORD);return structuredClone(record)},modifyRecord:async(key,mutate)=>{assert.equal(key,RECORD);const next=await mutate(structuredClone(record));if(next!==undefined)record=structuredClone(next);return structuredClone(record)},deleteRecord:async()=>{record=undefined}}
  const api=providedApi || {request:async(path,request={})=>{
    calls.push({path,...request})
    if(path===PREFIX+'/plugin/usage')return usage(request)
    if(path===PREFIX+'/desktop/auth/revoke')return {revoked:true}
    if(path===PREFIX+'/creator/bootstrap')return {user_id:7,display_name:'Fixture',identity_scope:'personal'}
    if(path===PREFIX+'/creator/models')return {items:[]}
    throw Error('Unexpected API path')
  }}
  const account=new NovaAccount({credentials,api,origin:'http://127.0.0.1:12345',now:()=>now})
  account.publish({connected:true,hasCredential:true,account:{displayName:'Fixture',role:'personal'}})
  t.after(()=>account.dispose(false))
  return {account,calls,credentials,setRecord:value=>{record=value}}
}

test('wallet amounts remain exact decimal CNY strings including zero and large values; extra fields are discarded',()=>{
  for(const value of ['0','0.000002','900719925474099312345.123456','-1.25']) {
    const raw=personal(value);raw.personal.token='do-not-return';raw.secret='do-not-return'
    const data=parseBalance(raw,'personal')
    assert.equal(data.wallet.available,value);assert.equal(data.wallet.balance,value);assert.equal(data.wallet.unit,'CNY')
    assert.equal(JSON.stringify(data).includes('do-not-return'),false)
  }
})

test('enterprise wallet and member limits are distinct; null unlimited and real zero are preserved',()=>{
  const data=parseBalance(enterprise(),'enterprise')
  assert.equal(data.wallet.available,'100.25');assert.equal(data.wallet.frozen,'20.25')
  assert.equal(data.limits.dailyRemaining,'0');assert.equal(data.limits.monthlyRemaining,null)
  assert.equal(data.limits.canUse,false);assert.equal(data.limits.monthlyUsed,'25.125')
  const raw=enterprise();raw.limits.daily_remaining=0.000002
  assert.equal(parseBalance(raw).limits.dailyRemaining,'0.000002')
  raw.limits.daily_remaining=1e-7
  assert.equal(parseBalance(raw).limits.dailyRemaining,'0.0000001')
})

test('malformed balances, unsupported currencies and cross-mode data cannot produce a zero or misleading wallet',()=>{
  const cases=[raw=>{raw.schema_version=2},raw=>{raw.personal.unit='USD'},raw=>{raw.personal.balance=0},raw=>{raw.personal.available='NaN'},raw=>{raw.personal.frozen='1e3'},raw=>{raw.as_of='yesterday'}]
  for(const alter of cases) {const raw=personal();alter(raw);assert.throws(()=>parseBalance(raw),error=>error.code==='INVALID_RESPONSE')}
  assert.throws(()=>parseBalance(personal(),'enterprise'),error=>error.code==='INVALID_RESPONSE')
  const absent=personal();delete absent.personal
  assert.throws(()=>parseBalance(absent),error=>error.code==='BALANCE_UNAVAILABLE')
  const raw=enterprise();raw.limits.monthly_remaining=Number.POSITIVE_INFINITY
  assert.throws(()=>parseBalance(raw),error=>error.code==='INVALID_RESPONSE')
})

test('balance fetch uses the existing device Bearer on the exact New API usage endpoint through NovaApi',async t=>{
  let requested
  const api=new NovaApi({fetchImpl:async(url,init)=>{
    requested=new Request(url,init)
    return Response.json({code:0,message:'',data:personal('0')})
  }})
  const h=fixture(t,{api})
  const state=await h.account.refreshBalance()
  assert.equal(requested.url,ORIGIN+PREFIX+'/plugin/usage');assert.equal(requested.method,'GET')
  assert.equal(requested.headers.get('authorization'),'Bearer '+token)
  assert.equal(requested.headers.get('cookie'),null)
  assert.equal(state.balance.status,'ready');assert.equal(state.balance.data.wallet.available,'0')
  assert.equal(JSON.stringify(state).includes(token),false)
})

test('enterprise device identity reads the shared company wallet and member limits without treating them as personal funds',async t=>{
  const h=fixture(t,{usage:()=>enterprise()})
  h.account.publish({account:{displayName:'Member',role:'enterprise:42'}})
  const state=await h.account.refreshBalance()
  assert.equal(state.balance.status,'ready');assert.equal(state.balance.data.mode,'enterprise')
  assert.equal(state.balance.data.wallet.available,'100.25')
  assert.equal(state.balance.data.limits.dailyRemaining,'0');assert.equal(state.balance.data.limits.canUse,false)
})

test('simultaneous balance refreshes share one request and expose a loading state',async t=>{
  const gate=deferred(),entered=deferred(),h=fixture(t,{usage:()=>{entered.resolve();return gate.promise}})
  const first=h.account.refreshBalance();await entered.promise
  const second=h.account.refreshBalance(),third=h.account.refreshBalance()
  assert.equal(h.account.snapshot().balance.status,'loading');assert.equal(h.account.snapshot().balance.refreshing,true)
  gate.resolve(personal())
  const results=await Promise.all([first,second,third])
  assert.equal(h.calls.length,1);assert.ok(results.every(state=>state.balance.status==='ready'))
})

test('optional balance failure cannot fail model connection and old successful data stays explicitly stale',async t=>{
  let fail=false
  const h=fixture(t,{usage:()=>{if(fail)throw new NovaError('NETWORK_ERROR');return personal('23.45')}})
  await h.account.refreshBalance();fail=true
  const state=await h.account.refresh()
  assert.equal(state.connected,true);assert.equal(state.error,null)
  if(h.account.balanceRefreshing)await h.account.balanceRefreshing
  const balance=h.account.snapshot().balance
  assert.equal(balance.status,'error');assert.equal(balance.error,'NETWORK_ERROR');assert.equal(balance.data.wallet.available,'23.45')
  assert.equal(balance.refreshing,false)
})

test('a first failed or unavailable balance never fabricates an amount and never returns raw diagnostics',async t=>{
  const h=fixture(t,{usage:()=>{throw Error('nfds_private_stack_secret')}})
  const state=await h.account.refreshBalance()
  assert.equal(state.connected,true);assert.equal(state.balance.data,null);assert.equal(state.balance.status,'error')
  assert.equal(state.balance.error,'INTERNAL_ERROR');assert.equal(JSON.stringify(state).includes('private_stack'),false)
  h.account.api.request=async()=>{const raw=personal();delete raw.personal;return raw}
  const missing=await h.account.refreshBalance()
  assert.equal(missing.balance.status,'unavailable');assert.equal(missing.balance.data,null)
})

test('signout clears balance, aborts its request and late old-account completion cannot replace a new account balance',async t=>{
  const old=deferred(),entered=deferred();let count=0,oldSignal
  const h=fixture(t,{usage:request=>{if(count++===0){oldSignal=request.signal;entered.resolve();return old.promise}return personal('99')}})
  const first=h.account.refreshBalance();await entered.promise
  await h.account.signout()
  assert.equal(h.account.snapshot().balance,null);assert.equal(oldSignal.aborted,true)
  h.setRecord({kind:'grant',payload:tokenPair(pair,now)})
  h.account.publish({connected:true,hasCredential:true,account:{displayName:'Another account',role:'personal'}})
  await h.account.refreshBalance();old.resolve(personal('1'));await first
  assert.equal(h.account.snapshot().balance.data.wallet.available,'99')
  assert.equal(h.account.snapshot().account.displayName,'Another account')
})

test('signout immediately clears cached balance and blocks new refreshes while token rotation settles',async t=>{
  const h=fixture(t);await h.account.refreshBalance()
  const gate=deferred();h.account.rotation=gate.promise
  const pending=h.account.signout()
  assert.equal(h.account.snapshot().balance,null)
  const before=h.calls.filter(call=>call.path.endsWith('/plugin/usage')).length
  await assert.rejects(h.account.refreshBalance(),error=>error.code==='AUTH_REQUIRED')
  assert.equal(h.calls.filter(call=>call.path.endsWith('/plugin/usage')).length,before)
  gate.resolve();await pending;h.account.rotation=null
  assert.equal(h.account.snapshot().connected,false);assert.equal(h.account.snapshot().balance,null)
})

test('rejected credentials clear displayed balance before connection cleanup finishes',async t=>{
  const h=fixture(t);await h.account.refreshBalance()
  const gate=deferred(),entered=deferred()
  h.account.onClear=async()=>{entered.resolve();await gate.promise}
  const rejected=h.account.rejectToken(token);await entered.promise
  assert.equal(h.account.snapshot().connected,false);assert.equal(h.account.snapshot().balance,null)
  gate.resolve();await rejected
})

test('disposed or signed-out accounts cannot start balance requests and disposal prevents late publications',async t=>{
  const gate=deferred(),entered=deferred(),h=fixture(t,{usage:()=>{entered.resolve();return gate.promise}})
  const pending=h.account.refreshBalance();await entered.promise
  await h.account.dispose(false)
  const state=h.account.snapshot()
  gate.resolve(personal());await pending
  assert.deepEqual(h.account.snapshot(),state)
  await assert.rejects(h.account.refreshBalance(),error=>error.code==='CANCELLED')
  const other=fixture(t);await other.account.signout()
  await assert.rejects(other.account.refreshBalance(),error=>error.code==='AUTH_REQUIRED')
})
