import { randomUUID } from 'node:crypto'
import { NovaError } from './protocol.js'

/** Login announces an install opportunity; only an interactive confirmation may
 * admit the official installer. Resuming Host state never resumes installation. */
export class PluginInstallFlow {
  constructor({bootstrap,isConnected,notifyOnLogin=true}) {
    Object.assign(this,{bootstrap,isConnected,notifyOnLogin})
    this.id=randomUUID();this.confirmed=false;this.wasConnected=false
  }
  snapshot() {
    const connected=this.isConnected()
    if(!connected&&this.wasConnected){this.id=randomUUID();this.confirmed=false}
    this.wasConnected=connected
    const setup=this.bootstrap.snapshot()
    return {...setup,confirmationRequired:connected&&this.notifyOnLogin&&!this.confirmed&&!setup.running,confirmationId:connected&&!setup.running?this.id:null}
  }
  confirm(id,{interactive=false}={}) {
    if(!interactive)throw new NovaError('USER_CONFIRMATION_REQUIRED')
    if(!this.isConnected())throw new NovaError('AUTH_REQUIRED')
    if(id!==this.id)throw new NovaError('INSTALL_CONFIRMATION_EXPIRED')
    if(this.bootstrap.snapshot().running)throw new NovaError('INSTALL_ALREADY_RUNNING')
    this.id=randomUUID();this.confirmed=true;this.wasConnected=true
    this.bootstrap.kick({retry:true})
    return this.snapshot()
  }
  requestConfirmation() {
    if(!this.isConnected())throw new NovaError('AUTH_REQUIRED')
    this.confirmed=false
    return this.snapshot()
  }
}
