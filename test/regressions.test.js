import test from 'node:test'
import assert from 'node:assert/strict'
import { NovaAccount } from '../src/account.js'
import { ORIGIN, tokenPair } from '../src/protocol.js'

function fixture(options={}) {
  let record, start, revokeCalls=0
  const pair={token_type:'Bearer',access_token:'nfds_'+'a'.repeat(43),refresh_token:'nfdr_'+'r'.repeat(43),session_id:'nfdev_'+'s'.repeat(43),expires_in:900,refresh_expires_in:2592000}
  const credentials={readRecord:async()=>record,modifyRecord:async(_key,fn)=>{const next=await fn(record);if(next!==undefined) record=next;return record},deleteRecord:async()=>{record=undefined}}
  const account=new NovaAccount({credentials,origin:'http://127.0.0.1:64661',onCatalog:options.onCatalog,onClear:options.onClear,api:{request:async(path,request)=>{
    if(path.endsWith('/start')){start=request.body;return {request_id:'request',authorize_url:ORIGIN+'/desktop/authorize?request=request',expires_in:600}}
    if(path.endsWith('/exchange'))return pair
    if(path.endsWith('/bootstrap'))return {user_id:1,display_name:'Synthetic',identity_scope:'personal'}
    if(path.endsWith('/models'))return {items:[]}
    if(path.endsWith('/revoke')){revokeCalls++;return {revoked:true}}
    throw Error('No real requests allowed')
  }}})
  return {account,credentials,setGrant:()=>{record={kind:'grant',payload:tokenPair(pair)}},getRecord:()=>record,getRevoke:()=>revokeCalls,url:()=>new URL(start.redirect_uri+'?'+new URLSearchParams({code:'nfdc_'+'c'.repeat(43),state:start.state,iss:ORIGIN}))}
}
test('login stays pending until the bound catalog is ready for the UI',async()=>{
  let finish,entered
  const gate=new Promise(resolve=>{finish=resolve}),started=new Promise(resolve=>{entered=resolve})
  const f=fixture({onCatalog:async()=>{entered();await gate;return [{id:'ready'}]}})
  await f.account.start();const callback=f.account.callback(f.url());await started
  assert.equal(f.account.snapshot().connected,false);assert.equal(f.account.snapshot().hasCredential,true);assert.equal(f.account.snapshot().attempt.phase,'exchanging')
  finish();await callback
  assert.equal(f.account.snapshot().connected,true);assert.deepEqual(f.account.snapshot().models,[{id:'ready'}]);await f.account.dispose()
})
test('local signout remains signed out and revokes even if default restoration fails',async()=>{
  let fail=true
  const f=fixture({onClear:async()=>{if(fail)throw Error('default editor failed')}});f.setGrant()
  f.account.publish({connected:true,hasCredential:true})
  const state=await f.account.signout()
  assert.equal(f.getRecord(),undefined);assert.equal(state.connected,false);assert.equal(state.hasCredential,false);assert.equal(state.warning,'MODEL_CLEANUP_FAILED');assert.equal(f.getRevoke(),1)
  fail=false;await f.account.dispose()
})
