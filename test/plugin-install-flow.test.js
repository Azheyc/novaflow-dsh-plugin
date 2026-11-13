import test from 'node:test'
import assert from 'node:assert/strict'
import { PluginInstallFlow } from '../src/plugin-install-flow.js'

function fixture({connected=true,notifyOnLogin=true,saved={attempted:false,running:false,items:[]}}={}) {
  let online=connected,state=structuredClone(saved),starts=0
  const bootstrap={snapshot:()=>structuredClone(state),kick:options=>{assert.deepEqual(options,{retry:true});starts++;state.running=true}}
  return {flow:new PluginInstallFlow({bootstrap,isConnected:()=>online,notifyOnLogin}),setConnected:value=>{online=value},setState:value=>{state={...state,...value}},starts:()=>starts}
}
test('login and saved interrupted work only announce a confirmation, never admit installation',()=>{
  for(const saved of [{attempted:false,running:false,items:[]},{attempted:true,running:true,items:[{status:'installing',requestId:'saved'}]}]){
    const h=fixture({saved});for(let i=0;i<5;i++)h.flow.snapshot();assert.equal(h.starts(),0)
  }
})
test('interactive user confirmation admits one install and consumes its confirmation id',()=>{
  const h=fixture();const state=h.flow.snapshot();assert.equal(state.confirmationRequired,true)
  h.flow.confirm(state.confirmationId,{interactive:true});assert.equal(h.starts(),1)
  assert.throws(()=>h.flow.confirm(state.confirmationId,{interactive:true}),/INSTALL_CONFIRMATION_EXPIRED/)
  assert.equal(h.starts(),1)
})
test('tools, absent confirmation ids, signed-out requests and stale login confirmations cannot install',()=>{
  const h=fixture();const id=h.flow.snapshot().confirmationId
  assert.throws(()=>h.flow.confirm(id),/USER_CONFIRMATION_REQUIRED/)
  assert.throws(()=>h.flow.confirm(undefined,{interactive:true}),/INSTALL_CONFIRMATION_EXPIRED/)
  h.setConnected(false);assert.equal(h.flow.snapshot().confirmationId,null)
  assert.throws(()=>h.flow.confirm(id,{interactive:true}),/AUTH_REQUIRED/)
  h.setConnected(true);assert.notEqual(h.flow.snapshot().confirmationId,id)
  assert.throws(()=>h.flow.confirm(id,{interactive:true}),/INSTALL_CONFIRMATION_EXPIRED/)
  assert.equal(h.starts(),0)
})
test('retry asks for confirmation and never directly starts installation',()=>{
  const h=fixture({saved:{attempted:true,running:false,items:[{status:'failed'}]}})
  h.flow.requestConfirmation();assert.equal(h.starts(),0)
  h.flow.confirm(h.flow.snapshot().confirmationId,{interactive:true});assert.equal(h.starts(),1)
  h.setState({running:false});assert.equal(h.flow.snapshot().confirmationRequired,false)
  h.flow.requestConfirmation();assert.equal(h.flow.snapshot().confirmationRequired,true);assert.equal(h.starts(),1)
})
test('disabled login notification still permits manual confirmation while running work cannot start twice',()=>{
  const h=fixture({notifyOnLogin:false});const state=h.flow.snapshot();assert.equal(state.confirmationRequired,false)
  h.flow.confirm(state.confirmationId,{interactive:true});assert.equal(h.starts(),1)
  assert.throws(()=>h.flow.confirm('wrong',{interactive:true}),/INSTALL_CONFIRMATION_EXPIRED/)
  assert.equal(h.flow.snapshot().confirmationId,null)
})
