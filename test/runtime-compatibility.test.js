import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {RELEASE_VERSION} from '../src/release.js'

const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
// npm excludes package-lock.json from tarballs; source checkouts verify it when present.
const lock=await readFile(new URL('../package-lock.json',import.meta.url),'utf8').then(JSON.parse).catch(error=>{
  if(error.code==='ENOENT')return null
  throw error
})
const runtimeRequire=createRequire(join(process.env.DSH_INSTALL_DIR,'package.json'))
const semver=runtimeRequire('semver')
const runtime=JSON.parse(await readFile(join(process.env.DSH_INSTALL_DIR,'package.json'),'utf8'))

test('DSH compatibility admits verified rc.2 and rc.3 without admitting unverified releases',()=>{
  for(const version of ['0.2.2-rc.2','0.2.2-rc.3'])assert.equal(semver.satisfies(version,manifest.engines.dsh),true,version)
  for(const version of ['0.2.2-rc.1','0.2.2-rc.4','0.2.2','0.2.3','0.3.0'])assert.equal(semver.satisfies(version,manifest.engines.dsh),false,version)
})

test('the installed DSH and Node satisfy requirements and source lock metadata matches when present',()=>{
  assert.equal(semver.satisfies(runtime.version,manifest.engines.dsh),true,runtime.version)
  assert.equal(semver.satisfies(process.version,manifest.engines.node),true,process.version)
  assert.equal(manifest.version,RELEASE_VERSION)
  if(lock){
    assert.equal(lock.version,manifest.version)
    assert.equal(lock.packages[''].version,manifest.version)
    assert.deepEqual(lock.packages[''].engines,manifest.engines)
  }
})
