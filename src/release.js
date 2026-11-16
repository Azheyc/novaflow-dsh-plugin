export const RELEASE_VERSION = '2.4.1'
export const INSTALL_FLOW = 'user-confirmed-official-installer-v1'

/** Client graph facts identify the actual revisioned resource this Host serves. */
export function clientDelivery(ctx) {
  const entry=ctx.get('clientModules')?.graph().entries.find(item=>item.id==='@local/novaflow-dsh-plugin')
  return {version:RELEASE_VERSION,installFlow:INSTALL_FLOW,clientRevision:entry?.rev || null,clientURL:entry?.url || null}
}
