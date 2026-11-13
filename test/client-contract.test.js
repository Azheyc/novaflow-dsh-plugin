import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {RELEASE_VERSION,INSTALL_FLOW,clientDelivery} from '../src/release.js'

const source=await readFile(new URL('../client.js',import.meta.url),'utf8')
const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
const host=await readFile(new URL('../index.js',import.meta.url),'utf8')

test('distributed client and both dictionaries declare confirmation, real installation and status instead of session drafts',async()=>{
  const begin=source.indexOf('    const dictionaries = ')+25
  const end=source.indexOf(';\n    const platform',begin)
  const embedded=JSON.parse(source.slice(begin,end))
  for(const language of ['en','zh']){
    const locale=JSON.parse(await readFile(new URL('../locale/'+language+'.json',import.meta.url),'utf8'))
    assert.deepEqual(embedded[language],locale.ui)
    for(const key of ['installConfirmTitle','installConfirmButton','installLater','setupInstalling','setupInstalled','setupFailed','setupRestart','setupRuntimeMissing']) assert.ok(locale.ui[key])
    assert.equal(Object.keys(locale.ui).some(key=>/recommendDraft|recommendNoInstall|recommendPrompt/.test(key)),false)
  }
  for(const forbidden of ['ctx.uiWorkspace','startSession','installationPrompt','recommendNoInstall','recommendAllDraft','synchronizeRecommendations'])assert.equal(source.includes(forbidden),false,forbidden)
  assert.match(source,/id:'novaflow-plugin-install-confirmation'/)
  assert.match(source,/act\('confirm_plugins'\)/)
  assert.match(source,/snapshot\.state\?\.pluginSetup\?\.running/)
  assert.match(source,/confirmationId:snapshot\.state\?\.pluginSetup\?\.confirmationId/)
  assert.doesNotMatch(host,/kickBootstrap/)
})
test('release diagnostics identify the exact advertised revisioned client resource',()=>{
  assert.equal(manifest.version,RELEASE_VERSION)
  const entry={id:manifest.name,url:'plugins/??@local/novaflow-dsh-plugin/client.js&rev=fixture',rev:'fixture'}
  const delivery=clientDelivery({get:name=>name==='clientModules'?{graph:()=>({entries:[entry]})}:undefined})
  assert.deepEqual(delivery,{version:manifest.version,installFlow:INSTALL_FLOW,clientRevision:'fixture',clientURL:entry.url})
  assert.equal(clientDelivery({get:()=>undefined}).clientURL,null)
})
