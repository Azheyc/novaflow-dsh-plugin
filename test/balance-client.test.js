import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const locales = Object.fromEntries(await Promise.all(['en', 'zh'].map(async language => [language, JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8')).ui])))
const flush = () => new Promise(resolve => setImmediate(resolve))
const personal = (overrides = {}) => ({
  mode: 'personal', wallet: {balance:'12.3400', frozen:'2.0000', available:'10.3400', unit:'CNY'},
  limits: null, asOf:'2026-11-16T01:20:00.000Z', ...overrides,
})
const ready = data => ({status:'ready', data, error:null, refreshing:false})
const account = balance => ({connected:true, models:[], account:{displayName:'Test account'}, balance})

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate))
  if (!tree || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.children, predicate)]
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ')
  if (tree === null || tree === undefined || typeof tree === 'boolean') return ''
  if (typeof tree !== 'object') return String(tree)
  return text(tree.children)
}
async function mount(initialState, language = 'en', intl = Intl) {
  let currentState = initialState
  let dictionaries
  let plugin
  const slots = new Map()
  const events = new Map()
  const timers = new Map()
  const requests = []
  const queued = []
  const cleanup = []
  const required = []
  let nextTimer = 0
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      if (type === React.Fragment) return children
      if (typeof type === 'function') return type({...props, children})
      return {type, props:props || {}, children}
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useState: initial => [initial, () => {}],
    useEffect() {},
  }
  const eventTarget = {addEventListener(name, callback) {events.set(name, callback)}, removeEventListener(name) {events.delete(name)}}
  const sandbox = {
    window:{...eventTarget, open() {assert.fail('Balance must not open an authorization window')}, __ModuleLoader__:{load(module) {plugin = module.factory(name => {required.push(name); assert.equal(name, 'react'); return React})}}},
    document:{...eventTarget, hidden:false}, URL, AbortController, Date, Intl:intl,
    setTimeout(callback, delay) {const id = ++nextTimer; timers.set(id, {callback, delay}); return id},
    clearTimeout(id) {timers.delete(id)},
    async fetch(url, options) {
      requests.push({url, ...options, body:JSON.parse(options.body)})
      if (queued.length) return await queued.shift()()
      return {ok:true, json:async () => ({ok:true, value:currentState})}
    },
  }
  vm.runInNewContext(source, sandbox, {filename:'client.js'})
  plugin.apply({
    effect(effect) {cleanup.push(effect())},
    locale:{
      register(_namespace, value) {dictionaries = value},
      bind:() => key => dictionaries[language][key],
      subscribe:() => () => {}, getSnapshot:() => language,
    },
    slots:{inject(_name, effect) {effect()}, register(metadata, component) {slots.set(metadata.id || metadata.name, component)}},
  })
  await flush()
  const view = () => slots.get('account')()
  const card = () => nodes(view(), node => node.type === 'section' && node.props['aria-label'] === locales[language].balance)[0]
  return {
    card, view, requests, queued, timers, required, dictionaries,
    async setState(state) {currentState = state; events.get('focus')(); await flush()},
    async poll(state) {
      currentState = state
      const [id, timer] = [...timers].find(([_id, timer]) => timer.delay === 1800)
      timers.delete(id)
      timer.callback()
      await flush()
    },
    button() {return nodes(card(), node => node.type === 'button')[0]},
    dispose() {for (const fn of cleanup.reverse()) if (typeof fn === 'function') fn()},
  }
}

test('real account slot keeps the inline locale contract and only requires React', async () => {
  const client = await mount(account(ready(personal())))
  try {
    for (const language of ['en', 'zh']) assert.deepEqual(JSON.parse(JSON.stringify(client.dictionaries[language])), locales[language])
    assert.deepEqual(client.required, ['react'])
    assert.match(text(client.card()), /Available balance 10\.3400 CNY/)
    assert.match(text(client.card()), /Total balance 12\.3400 CNY/)
    assert.match(text(client.card()), /Frozen balance 2\.0000 CNY/)
    assert.match(text(client.card()), /Personal balance/)
  } finally {client.dispose()}
})

test('null, absent and unavailable balances never manufacture a zero', async () => {
  for (const state of [
    {connected:false, models:[], balance:null},
    {connected:false, models:[]},
    {connected:false, models:[], balance:ready(personal())},
    account(null),
    account({status:'unavailable',data:null,error:'BALANCE_UNAVAILABLE',refreshing:false}),
    account({status:'error',data:null,error:'NETWORK_ERROR',refreshing:false}),
  ]) {
    const client = await mount(state)
    try {
      const content = text(client.card())
      assert.doesNotMatch(content, /0 CNY|10\.3400|12\.3400/)
      if (!state.connected) {
        assert.match(content, /Sign in to NovaFlow to view your balance/)
        assert.equal(client.button(), undefined)
      } else if (state.balance?.status === 'error') assert.match(content, /Could not refresh the balance/)
      else assert.match(content, /Balance is currently unavailable/)
    } finally {client.dispose()}
  }
})

test('zero and huge decimal strings retain all digits without conversion', async () => {
  const value = '900719925474099312345678901234567890.00000000012345678900'
  const client = await mount(account(ready(personal({wallet:{balance:value, frozen:'0.0000', available:'0',unit:'CNY'}}))))
  try {
    assert.match(text(client.card()), /Available balance 0 CNY/)
    assert.ok(text(client.card()).includes(`${value} CNY`))
    assert.match(text(client.card()), /Frozen balance 0\.0000 CNY/)
  } finally {client.dispose()}
})

test('enterprise limits distinguish null, zero, unset and future modes; canUse false blocks positive balance', async () => {
  const limits = {dailyMode:'unlimited', dailyLimit:null, dailyUsed:'1', dailyRemaining:null, monthlyMode:'limited',monthlyLimit:'5',monthlyUsed:'5',monthlyRemaining:'0',canUse:false,blockReason:'insufficient_company_quota_or_limit'}
  const client = await mount(account(ready(personal({mode:'enterprise',limits}))))
  try {
    const content = text(client.card())
    assert.match(content, /Enterprise balance/)
    assert.match(content, /Available balance 10\.3400 CNY/)
    assert.match(content, /Remaining today Unlimited/)
    assert.match(content, /Remaining this month 0 CNY/)
    assert.match(content, /Usage is restricted by quota or spending limits/)
    assert.doesNotMatch(content, /insufficient_company_quota_or_limit/)
    for (const mode of ['inherit', 'limited', 'blocked', 'server_future_mode']) {
      await client.setState(account(ready(personal({mode:'enterprise',limits:{...limits,dailyMode:mode,canUse:true}}))))
      assert.match(text(client.card()), /Remaining today Not set/)
      assert.doesNotMatch(text(client.card()), /Usage is restricted|server_future_mode/)
    }
  } finally {client.dispose()}
})

test('an error with old data explicitly marks stale and does not expose server codes', async () => {
  const client = await mount(account({status:'error', data:personal(), error:'SAFE_UNKNOWN_CODE',refreshing:false}))
  try {
    assert.match(text(client.card()), /Last updated data/)
    assert.match(text(client.card()), /Could not refresh the balance/)
    assert.match(text(client.card()), /10\.3400 CNY/)
    assert.doesNotMatch(text(client.card()), /SAFE_UNKNOWN_CODE/)
    const time = nodes(client.card(), node => node.type === 'time')[0]
    assert.equal(time.props.dateTime, '2026-11-16T01:20:00.000Z')
  } finally {client.dispose()}
})

test('refresh uses the same-origin action, disables all action buttons, and failed transport marks data stale', async () => {
  const client = await mount(account(ready(personal())))
  try {
    let reject
    client.queued.push(() => new Promise((_resolve, rejectRequest) => {reject = rejectRequest}))
    client.button().props.onClick()
    assert.equal(client.card().props['aria-busy'], true)
    assert.match(text(client.card()), /Refreshing balance/)
    for (const button of nodes(client.view(), node => node.type === 'button')) assert.equal(button.props.disabled, true, text(button))
    const refresh = client.requests.at(-1)
    assert.equal(refresh.url, '/api/novaflow-account')
    assert.equal(refresh.credentials, 'same-origin')
    assert.equal(refresh.redirect, 'error')
    assert.deepEqual(refresh.body, {action:'refresh_balance'})
    reject(new Error('secret raw transport failure'))
    await flush()
    assert.match(text(client.card()), /Last updated data/)
    assert.match(text(client.card()), /10\.3400 CNY/)
    assert.doesNotMatch(text(client.card()), /secret raw transport failure/)
    assert.equal(client.button().props.disabled, false)
    assert.equal(client.card().props['aria-busy'], false)
  } finally {client.dispose()}
})

test('loading and background refreshing remain busy, poll Host state, and settle to ready', async () => {
  const client = await mount(account({status:'loading',data:null,error:null,refreshing:true}))
  try {
    assert.match(text(client.card()), /Fetching balance/)
    assert.doesNotMatch(text(client.card()), /0 CNY|currently unavailable/)
    assert.equal(client.card().props['aria-busy'], true)
    assert.equal(client.button().props.disabled, true)
    assert.ok([...client.timers.values()].some(timer => timer.delay === 1800))
    await client.poll(account({...ready(personal()),refreshing:true}))
    assert.deepEqual(client.requests.at(-1).body, {action:'state'})
    assert.match(text(client.card()), /Refreshing balance/)
    assert.match(text(client.card()), /10\.3400 CNY/)
    assert.equal(client.button().props.disabled, true)
    await client.poll(account(ready(personal())))
    assert.equal(client.card().props['aria-busy'], false)
    assert.equal(client.button().props.disabled, false)
    assert.equal(client.timers.size, 0)
  } finally {client.dispose()}
})

test('successful refresh accepts Host loading state and renders the polled balance', async () => {
  const client = await mount(account(ready(personal())))
  try {
    client.queued.push(async () => ({ok:true,json:async () => ({ok:true,value:account({status:'loading',data:personal(),error:null,refreshing:true})})}))
    client.button().props.onClick()
    await flush()
    assert.deepEqual(client.requests.at(-1).body, {action:'refresh_balance'})
    assert.match(text(client.card()), /Refreshing balance/)
    assert.equal(client.button().props.disabled, true)
    await client.poll(account(ready(personal({wallet:{balance:'20',frozen:'0',available:'20',unit:'CNY'}}))))
    assert.match(text(client.card()), /Available balance 20 CNY/)
    assert.doesNotMatch(text(client.card()), /Last updated data|Refreshing balance/)
    assert.equal(client.button().props.disabled, false)
  } finally {client.dispose()}
})

test('another account action disables balance refresh without changing its loading state', async () => {
  const client = await mount(account(ready(personal())))
  try {
    let resolve
    client.queued.push(() => new Promise(resolveRequest => {resolve = resolveRequest}))
    const refreshAccount = nodes(client.view(), node => node.type === 'button' && text(node) === 'Refresh account and models')[0]
    refreshAccount.props.onClick()
    assert.equal(client.button().props.disabled, true)
    assert.equal(client.card().props['aria-busy'], false)
    assert.doesNotMatch(text(client.card()), /Refreshing balance/)
    resolve({ok:true,json:async()=>({ok:true,value:account(ready(personal()))})})
    await flush()
    assert.equal(client.button().props.disabled, false)
  } finally {client.dispose()}
})

test('Chinese copy and safe Intl formatting handle invalid dates and unsupported Intl', async () => {
  const client = await mount(account(ready(personal())), 'zh')
  try {
    assert.match(text(client.card()), /个人余额/)
    assert.match(text(client.card()), /10\.3400 人民币（CNY）/)
    const expected = new Intl.DateTimeFormat('zh-CN', {dateStyle:'medium',timeStyle:'short'}).format(new Date(personal().asOf))
    assert.ok(text(client.card()).includes(expected))
    await client.setState(account(ready(personal({asOf:'invalid-date'}))))
    assert.match(text(client.card()), /更新时间暂不可用/)
  } finally {client.dispose()}
  const unsupported = await mount(account(ready(personal())), 'en', {DateTimeFormat() {throw new RangeError('unsupported')}})
  try {assert.match(text(unsupported.card()), /Update time unavailable/)} finally {unsupported.dispose()}
})
