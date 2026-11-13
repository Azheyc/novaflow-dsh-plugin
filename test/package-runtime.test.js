import test from 'node:test'
import assert from 'node:assert/strict'
import {checkPackageRuntime} from '../src/package-runtime.js'

test('Windows Desktop uses bundled pnpm with argument arrays even for paths containing spaces',async()=>{
  let accessPath,call
  const result=await checkPackageRuntime({platform:'win32',resourcesPath:'C:/Program Files/DeepSeek Harness/resources',executable:'C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe',environment:{PATH:'unchanged'},access:async path=>{accessPath=path},execute:async(...args)=>{call=args;return '11.28.5\n'}})
  assert.equal(result.status,'ready');assert.equal(result.version,'11.28.5')
  assert.match(accessPath,/runtime.*primary-runtime.*dependencies.*pnpm.*bin.*pnpm.mjs$/)
  assert.equal(call[0],'C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe');assert.deepEqual(call[1],[accessPath,'--version'])
  assert.equal(call[2].env.ELECTRON_RUN_AS_NODE,'1');assert.equal(call[2].env.PATH,'unchanged');assert.equal(call[2].windowsHide,true);assert.equal(call[2].shell,undefined)
})
test('missing bundled pnpm is diagnosed without installing or executing anything',async()=>{
  let runs=0
  const result=await checkPackageRuntime({platform:'win32',resourcesPath:'C:/app/resources',access:async()=>{throw Error('private error')},execute:async()=>{runs++}})
  assert.deepEqual(result,{status:'unavailable',code:'pnpm-missing'});assert.equal(runs,0)
})
test('runtime startup errors and invalid version output expose only safe codes',async()=>{
  for(const output of ['bad output nfds_secret',null]){
    const result=await checkPackageRuntime({platform:'win32',resourcesPath:'C:/app/resources',access:async()=>{},execute:async()=>{if(output===null)throw Error('private command failed');return output}})
    assert.deepEqual(result,{status:'unavailable',code:'pnpm-runtime-unavailable'})
  }
})
test('non Desktop and non Windows environments remain managed by the official installer',async()=>{
  for(const platform of ['darwin','linux','win32']){
    const result=await checkPackageRuntime({platform,resourcesPath:null,execute:async()=>{throw Error('must not run')}})
    assert.deepEqual(result,{status:'managed-by-dsh'})
  }
})
