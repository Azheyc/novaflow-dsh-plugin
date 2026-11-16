import {NovaError} from './protocol.js'

// /plugin/usage already converts quota units into CNY. Keep wallet decimals as
// strings; neither quota conversion nor floating-point money arithmetic belongs here.
function amount(value) {
  if (typeof value!=='string' || value.length>128 || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,32})?$/.test(value)) throw new NovaError('INVALID_RESPONSE')
  return value
}
function limitAmount(value) {
  if (value===null) return null
  if (typeof value!=='number' || !Number.isFinite(value) || Math.abs(value)>Number.MAX_SAFE_INTEGER) throw new NovaError('INVALID_RESPONSE')
  const text=String(value)
  if (!/[eE]/.test(text)) return amount(text)
  const [coefficient,exponent]=text.toLowerCase().split('e')
  const negative=coefficient.startsWith('-'),unsigned=negative ? coefficient.slice(1) : coefficient
  const [integer,fraction='']=unsigned.split('.'),digits=integer+fraction,point=integer.length+Number(exponent)
  const expanded=point<=0 ? '0.'+'0'.repeat(-point)+digits : point>=digits.length ? digits+'0'.repeat(point-digits.length) : digits.slice(0,point)+'.'+digits.slice(point)
  return amount((negative?'-':'')+expanded)
}

export function parseBalance(data, expectedMode) {
  if (!data || data.schema_version!==1 || !['personal','enterprise'].includes(data.account_mode)) throw new NovaError('INVALID_RESPONSE')
  const mode=data.account_mode
  if (expectedMode && mode!==expectedMode) throw new NovaError('INVALID_RESPONSE')
  const raw=mode==='enterprise' ? data.company : data.personal
  if (!raw) throw new NovaError('BALANCE_UNAVAILABLE')
  if (raw.unit!=='CNY') throw new NovaError('INVALID_RESPONSE')
  const wallet={balance:amount(raw.balance),frozen:amount(raw.frozen),available:amount(raw.available),unit:'CNY'}
  if (typeof data.as_of!=='string' || data.as_of.length>64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(data.as_of) || !Number.isFinite(Date.parse(data.as_of))) throw new NovaError('INVALID_RESPONSE')
  let limits=null
  if (mode==='enterprise') {
    const rawLimits=data.limits
    if (!rawLimits || !['limited','unlimited','blocked'].includes(rawLimits.daily_mode) || !['limited','unlimited','blocked'].includes(rawLimits.monthly_mode) || typeof rawLimits.can_use!=='boolean' || typeof rawLimits.block_reason!=='string') throw new NovaError('INVALID_RESPONSE')
    limits={
      dailyMode:rawLimits.daily_mode,dailyLimit:limitAmount(rawLimits.daily_limit),dailyUsed:amount(rawLimits.daily_used),dailyRemaining:limitAmount(rawLimits.daily_remaining),
      monthlyMode:rawLimits.monthly_mode,monthlyLimit:limitAmount(rawLimits.monthly_limit),monthlyUsed:amount(rawLimits.monthly_used),monthlyRemaining:limitAmount(rawLimits.monthly_remaining),
      canUse:rawLimits.can_use,blockReason:['','insufficient_company_quota_or_limit'].includes(rawLimits.block_reason) ? rawLimits.block_reason : 'quota_or_limit',
    }
  } else if (data.limits!==null && data.limits!==undefined) throw new NovaError('INVALID_RESPONSE')
  return {mode,wallet,limits,asOf:data.as_of}
}
