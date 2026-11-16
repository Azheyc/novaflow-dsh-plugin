window.__ModuleLoader__.load({
  id: '@local/novaflow-dsh-plugin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    // The dictionaries below are kept identical to locale/{en,zh}.json ui.
    const dictionaries = {
  "en": {
    "nav": "Account and balance",
    "title": "NovaFlow account",
    "intro": "Sign in to NovaFlow to save the connection in Settings → Models. No API key copying is needed.",
    "signin": "Sign in to NovaFlow",
    "retry": "Try again",
    "loading": "Loading account…",
    "working": "Working…",
    "connected": "Connected",
    "signedout": "Not connected",
    "accountFallback": "NovaFlow account",
    "pending": "Waiting for authorization",
    "pendingHelp": "Complete sign-in and confirm authorization on NovaFlow. This page updates automatically when authorization finishes.",
    "openAuthorization": "Open authorization page",
    "popupHelp": "If no browser page opened, use the authorization link below.",
    "cancel": "Cancel authorization",
    "cancelled": "Authorization cancelled. You can sign in again when ready.",
    "expired": "Authorization expired. Start sign-in again.",
    "failed": "Authorization did not finish. Please try again.",
    "refresh": "Refresh account and models",
    "models": "Model configuration",
    "modelsHelp": "Your connection is saved in Settings → Models. Fetch, add, or edit models in the NovaFlow provider.",
    "balance": "Account balance",
    "balanceUnknown": "Balance is not provided by this connection. Check your current balance on NovaFlow.",
    "platform": "Open NovaFlow",
    "signout": "Sign out",
    "signoutConfirm": "Sign out of NovaFlow and clear the local sign-in credentials? Native provider and model configuration will remain for your next sign-in. Running requests may be interrupted.",
    "signoutYes": "Confirm sign out",
    "keepConnected": "Stay connected",
    "warning": "Account synchronization needs attention. Refresh to retry or check your permissions on NovaFlow.",
    "networkError": "Could not reach the account service or NovaFlow. Check your network connection and try again.",
    "genericError": "The operation could not be completed. Please try again.",
    "authorizationError": "NovaFlow authorization was rejected or expired. Please sign in again.",
    "conflictError": "A managed model connection has changed. Review the connection settings before syncing again.",
    "unavailableError": "NovaFlow is temporarily unavailable. Please try again later.",
    "protocolError": "The account service returned an unexpected response. Please refresh or restart Harness.",
    "reconnectHelp": "Earlier device credentials are still saved locally. Sign out to clear them, then sign in again. Provider and model configuration will remain.",
    "revokeFailed": "You are signed out locally, but remote device revocation failed. Revoke this device in NovaFlow Security and access.",
    "dismissSignout": "Not now",
    "syncRetryHelp": "Your connection is saved, but account synchronization has not finished. Refresh to retry without signing in again.",
    "cleanupFailed": "Sign-in credentials were cleared or have expired, but local connection cleanup did not finish. Native provider and model configuration will remain. Sign in again or restart Harness and retry.",
    "cleanupAndRevokeFailed": "You are signed out locally, but connection cleanup and remote device revocation did not finish. Native provider and model configuration will remain. Restart Harness and revoke this device in NovaFlow Security and access.",
    "modelThinkingHelp": "In each model’s Advanced settings, configure the reasoning levels it supports. Then choose the reasoning depth for the current conversation in its model picker.",
    "modelConnectionHelp": "Claude models use Anthropic Messages; other models use OpenAI Responses. Keep the local connection address supplied by the plugin. Manage sign-in and refresh in Account and balance; no API key copying is needed.",
    "modelFooterTitle": "NovaFlow connection",
    "modelFooterHelp": "Signing in to NovaFlow saves native provider configuration here. Use the editors above to fetch, add, or edit models. Signing out keeps this configuration, but model requests require you to sign in again.",
    "setupTitle": "Automatic plugin installation",
    "setupIntro": "NovaFlow offers these five plugins after sign-in. The official DSH installer runs only after you confirm.",
    "setupRegistry": "Mainland China mirror: https://registry.npmmirror.com",
    "setupPolicy": "Installed packages are skipped, disabled packages stay disabled, and existing versions are not upgraded.",
    "setupRetry": "Check or retry installation",
    "setupRunning": "Installing plugins automatically…",
    "setupIdle": "Waiting for your confirmation",
    "setupFinished": "Plugin check and installation finished",
    "setupWaiting": "Pending",
    "setupChecking": "Checking",
    "setupInstalling": "Installing",
    "setupInstalled": "Installed",
    "setupAlready": "Already installed; skipped",
    "setupDisabled": "Installed; kept disabled",
    "setupRestart": "Restart required",
    "setupFailed": "Installation failed",
    "setupOverridden": "Overridden by another configuration",
    "setupUnsupported": "Platform unsupported",
    "setupRestartHelp": "Some changes require restarting DeepSeek Harness. Save your work and restart the app when ready.",
    "setupRuntimeMissing": "The bundled DSH package runtime is missing or cannot start. Repair or reinstall the complete official DSH desktop app, restart, then retry. Changing the registry cannot restore missing runtime files.",
    "setupNetwork": "The registry could not be reached or the request timed out. Check the network and retry.",
    "setupPermission": "The install directory is inaccessible or a file is locked. Check permissions, security software, and other DSH processes.",
    "setupIncompatible": "This plugin version is incompatible with DSH. Choose a compatible version in the official plugin manager.",
    "setupBuildBlocked": "The official installer blocked build scripts. Review them in the official plugin manager; they are not approved automatically.",
    "setupDiskFull": "There is not enough free disk space. Free space and retry.",
    "setupGenericFailure": "Installation did not finish. Check the official plugin manager error or logs, then retry.",
    "setupStatusUnavailable": "Automatic installation status is not available yet. Refresh the account and retry.",
    "installConfirmTitle": "Confirm recommended plugin installation",
    "installConfirmHelp": "After confirmation, the official DSH installer checks and installs these five packages using registry.npmmirror.com. Installed packages are skipped and disabled choices are preserved.",
    "installConfirmButton": "Confirm and start installation",
    "installLater": "Later",
    "installClose": "Close",
    "installRunningHelp": "Installation is running in the background. Per-plugin status updates below. Closing this window does not cancel an admitted installation.",
    "installResultHelp": "Results are shown below. To retry, confirm installation again.",
    "installExpired": "The confirmation expired. Refresh the account and open the installation dialog again."
  },
  "zh": {
    "nav": "账户与余额",
    "title": "NovaFlow 账户",
    "intro": "登录 NovaFlow 后，连接会保存到「设置 → 模型」，无需复制 API Key。",
    "signin": "登录 NovaFlow",
    "retry": "重试",
    "loading": "正在读取账户…",
    "working": "正在处理…",
    "connected": "已连接",
    "signedout": "未连接",
    "accountFallback": "NovaFlow 账户",
    "pending": "等待网页授权",
    "pendingHelp": "请在 NovaFlow 网页完成登录并确认授权。授权完成后，此页面会自动更新。",
    "openAuthorization": "打开授权页面",
    "popupHelp": "如果浏览器页面没有打开，请点击下方授权链接。",
    "cancel": "取消授权",
    "cancelled": "授权已取消。需要时可重新登录。",
    "expired": "授权已过期，请重新发起登录。",
    "failed": "授权未完成，请重新尝试。",
    "refresh": "刷新账户与模型",
    "models": "模型配置",
    "modelsHelp": "连接已保存到「设置 → 模型」。在 NovaFlow 提供商中获取、新增或编辑模型。",
    "balance": "账户余额",
    "balanceUnknown": "当前连接接口不提供余额，请前往 NovaFlow 查看实时余额。",
    "platform": "打开 NovaFlow",
    "signout": "退出登录",
    "signoutConfirm": "退出 NovaFlow 并清除本机登录凭据？原生提供商和模型配置会保留，重新登录后可继续使用。正在进行的请求可能中断。",
    "signoutYes": "确认退出",
    "keepConnected": "保持登录",
    "warning": "账户同步需要处理，请刷新重试或前往 NovaFlow 检查权限。",
    "networkError": "无法连接账户服务或 NovaFlow，请检查网络连接后重试。",
    "genericError": "操作未能完成，请重试。",
    "authorizationError": "NovaFlow 授权被拒绝或已过期，请重新登录。",
    "conflictError": "受管模型连接已被修改，请检查连接设置后再同步。",
    "unavailableError": "NovaFlow 暂时不可用，请稍后重试。",
    "protocolError": "账户服务返回了异常响应，请刷新页面或重启 Harness。",
    "reconnectHelp": "本机仍保存旧的设备凭据，请先退出清除，再重新登录。提供商和模型配置会保留。",
    "revokeFailed": "本机已退出，但远端设备撤销失败。请前往 NovaFlow「安全与访问」撤销该设备。",
    "dismissSignout": "暂不退出",
    "syncRetryHelp": "连接信息已保留，账户同步尚未完成。请刷新重试，无需重新登录。",
    "cleanupFailed": "登录凭据已清除或失效，但本机连接清理未完成。原生提供商和模型配置会保留；请重新登录或重启 Harness 后重试。",
    "cleanupAndRevokeFailed": "本机已退出，但连接清理和远端设备撤销未完成。原生提供商和模型配置会保留；请重启 Harness，并到 NovaFlow「安全与访问」撤销该设备。",
    "modelThinkingHelp": "在每个模型的「高级」设置中配置它支持的思考档位，再在对话的模型选择器中选择本次使用的思考深度。",
    "modelConnectionHelp": "Claude 系列使用 Anthropic Messages，其他模型使用 OpenAI Responses。请保留插件填入的本机连接地址；登录与刷新在「账户与余额」管理，无需复制 API Key。",
    "modelFooterTitle": "NovaFlow 连接",
    "modelFooterHelp": "NovaFlow 登录后会在此保存原生提供商配置。可直接使用上方编辑器获取、新增或编辑模型；退出登录会保留这些配置，但需重新登录后才能调用。",
    "setupTitle": "推荐插件自动安装",
    "setupIntro": "NovaFlow 登录后会提醒安装以下五个插件。点击确认后，由 DSH 官方安装器直接执行。",
    "setupRegistry": "中国大陆镜像：https://registry.npmmirror.com",
    "setupPolicy": "已安装项跳过，已禁用的插件保持禁用；不会自动升级。",
    "setupRetry": "检查或重试安装",
    "setupRunning": "正在自动安装，请稍候…",
    "setupIdle": "等待你确认安装",
    "setupFinished": "检查与安装已完成",
    "setupWaiting": "等待检查",
    "setupChecking": "正在检查",
    "setupInstalling": "正在安装",
    "setupInstalled": "安装成功",
    "setupAlready": "已安装，已跳过",
    "setupDisabled": "已安装，保持禁用",
    "setupRestart": "需要重启应用",
    "setupFailed": "安装失败",
    "setupOverridden": "被其他配置覆盖",
    "setupUnsupported": "当前平台不支持",
    "setupRestartHelp": "部分插件需要重启 DeepSeek Harness 后生效，请保存工作后自行重启。",
    "setupRuntimeMissing": "DSH 内置包管理运行时缺失或未能启动。请修复或重新安装完整官方 DSH 桌面版，重启后再重试；镜像不能补齐运行时。",
    "setupNetwork": "无法连接镜像或网络超时，请检查网络后重试。",
    "setupPermission": "安装目录无权限或文件被占用，请检查权限、杀毒软件和其他 DSH 进程。",
    "setupIncompatible": "插件版本与当前 DSH 不兼容，请在官方插件管理中选择兼容版本。",
    "setupBuildBlocked": "构建脚本被官方安装器阻止。请在官方插件管理中审阅处理，不会自动批准。",
    "setupDiskFull": "可用磁盘空间不足，请清理后重试。",
    "setupGenericFailure": "安装未完成，请查看官方插件管理的错误或日志，然后重试。",
    "setupStatusUnavailable": "尚未获取自动安装状态，请刷新账户后重试。",
    "installConfirmTitle": "确认安装推荐插件",
    "installConfirmHelp": "确认后将使用 registry.npmmirror.com，通过 DSH 官方安装器检查并安装这五个插件。已安装项会跳过，禁用选择保留。",
    "installConfirmButton": "确认并开始安装",
    "installLater": "稍后再说",
    "installClose": "关闭",
    "installRunningHelp": "安装正在后台进行，下面会更新逐项状态。关闭此窗口不会取消已开始的安装。",
    "installResultHelp": "本次操作状态如下。需要重试时，请再次确认开始安装。",
    "installExpired": "确认信息已失效，请刷新账户后重新打开安装窗口。"
  }
};
    const platform = 'https://www.ycnovaflow.vip';
    const pendingPhases = new Set(['starting', 'waiting', 'exchanging']);
    const css = `
      .nf-account {display:flex;flex-direction:column;gap:16px;padding:8px 0;font-size:13px;line-height:22px;color:var(--dsw-alias-label-primary)}
      .nf-account * {box-sizing:border-box}
      .nf-account h2,.nf-account h3,.nf-account p {margin:0}
      .nf-account h2 {font-size:18px;line-height:28px;font-weight:600}
      .nf-account h3 {font-size:14px;font-weight:500}
      .nf-card {padding:16px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px}
      .nf-muted {color:var(--dsw-alias-label-secondary)}
      .nf-actions {display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      .nf-button {display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:5px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-decoration:none;cursor:pointer;line-height:22px}
      .nf-button:hover {text-decoration:underline}
      .nf-button:focus-visible,.nf-launcher:focus-visible {outline:2px solid var(--dsw-alias-label-primary);outline-offset:3px}
      .nf-button:disabled {opacity:.5;cursor:default;text-decoration:none}
      .nf-primary {font-weight:600}
      .nf-launcher {display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;text-align:left}
      .nf-launcher[data-narrow=true] {justify-content:center;padding:6px}
      .nf-avatar {display:flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
      .nf-launcher-label {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nf-notice {padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;overflow-wrap:anywhere}
      .nf-guidance {display:flex;flex-direction:column;gap:8px}
      .nf-install-backdrop {position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto;background:color-mix(in srgb,var(--dsw-alias-bg-base) 72%,transparent);backdrop-filter:blur(4px)}
      .nf-install-dialog {width:min(700px,100%);max-height:calc(100dvh - 48px);overflow:auto;padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}
      @media(max-width:540px){.nf-install-backdrop{padding:12px}.nf-install-dialog{padding:16px;max-height:calc(100dvh - 24px)}}
    `;
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('novaflow.account', dictionaries));
        const translate = ctx.locale.bind('novaflow.account');
        let disposed = false;
        let pollTimer;
        let readPromise;
        let actionPromise;
        let generation = 0;
        let snapshot = { state: null, busy: null, error: null, loaded: false, installDialogOpen: false };
        let installDismissed = false;
        const listeners = new Set();
        const controllers = new Set();
        const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
        const getSnapshot = () => snapshot;
        const isPending = state => !state?.connected && pendingPhases.has(state?.attempt?.phase);
        const safeAuthorization = state => {
          try {
            const url = new URL(state?.attempt?.authorizeUrl);
            return url.origin === platform && !url.username && !url.password ? url.href : null;
          } catch { return null; }
        };
        function publish(patch) {
          if (disposed) return;
          snapshot = { ...snapshot, ...patch };
          if (!snapshot.state?.connected) { installDismissed = false; snapshot.installDialogOpen = false; }
          else if (snapshot.state?.pluginSetup?.confirmationRequired && !installDismissed) snapshot.installDialogOpen = true;
          for (const listener of listeners) listener();
          clearTimeout(pollTimer);
          pollTimer = undefined;
          if (isPending(snapshot.state) || snapshot.state?.pluginSetup?.running) pollTimer = setTimeout(() => { void readState(); }, 1800);
        }
        async function request(action, attemptId) {
          const controller = new AbortController();
          controllers.add(controller);
          const timer = setTimeout(() => controller.abort(), 30000);
          try {
            const response = await fetch('/api/novaflow-account', {
              method: 'POST', credentials: 'same-origin', redirect: 'error',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ action, ...(attemptId ? { attemptId } : {}), ...(action === 'confirm_plugins' ? {confirmationId:snapshot.state?.pluginSetup?.confirmationId} : {}) }),
              signal: controller.signal,
            });
            const result = await response.json().catch(() => null);
            if (result?.ok !== true) {
              const error = new Error('NovaFlow operation failed');
              error.code = typeof result?.error?.code === 'string' ? result.error.code : 'PROTOCOL';
              throw error;
            }
            const state = result.value;
            if (!response.ok || !state || typeof state.connected !== 'boolean' || !Array.isArray(state.models)) {
              const error = new Error('Invalid account response'); error.code = 'PROTOCOL'; throw error;
            }
            return state;
          } finally { clearTimeout(timer); controllers.delete(controller); }
        }
        async function readState() {
          if (disposed || actionPromise) return;
          if (readPromise) return readPromise;
          const current = generation;
          const work = (async () => {
            try {
              const state = await request('state');
              if (current === generation) publish({ state, loaded: true, error: null });
            } catch (error) {
              if (current === generation) publish({ loaded: true, error: error.code || 'NETWORK' });
            }
          })();
          readPromise = work;
          try { await work; } finally { if (readPromise === work) readPromise = undefined; }
        }
        async function act(action) {
          if (disposed || actionPromise) return;
          generation++;
          clearTimeout(pollTimer);
          publish({ busy: action, error: null });
          const work = (async () => {
            try {
              const state = await request(action, action === 'cancel' ? snapshot.state?.attempt?.id : undefined);
              publish({ state, loaded: true });
              if (action === 'start' && !disposed) {
                const url = safeAuthorization(state);
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
              }
            } catch (error) { publish({ error: error.code || 'NETWORK' }); }
          })();
          actionPromise = work;
          try { await work; } finally {
            if (actionPromise === work) actionPromise = undefined;
            publish({ busy: null });
          }
        }
        function errorText(t, code) {
          if (!code) return null;
          const key = code === 'INSTALL_CONFIRMATION_EXPIRED' ? 'installExpired'
            : code === 'REVOKE_FAILED' ? 'revokeFailed'
            : code === 'SIGNOUT_REQUIRED' ? 'reconnectHelp'
            : /NETWORK|TIMEOUT/.test(code) ? 'networkError'
            : /AUTH|EXPIRED|UNAUTHORIZED|DENIED/.test(code) ? 'authorizationError'
            : /CONFLICT/.test(code) ? 'conflictError'
            : /PLATFORM_ERROR|UNAVAILABLE|HTTP_5/.test(code) ? 'unavailableError'
            : ['PROTOCOL', 'INVALID_RESPONSE'].includes(code) ? 'protocolError' : 'genericError';
          return t(key);
        }
        function useView() {
          const value = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
          React.useSyncExternalStore(callback => ctx.locale.subscribe(callback), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot());
          return { ...value, t: translate };
        }
        function button(text, onClick, disabled, primary) {
          return h('button', { type: 'button', className: `nf-button${primary ? ' nf-primary' : ''}`, disabled, onClick }, text);
        }
        function external(text, href = platform) {
          return h('a', { className: 'nf-button', href, target: '_blank', rel: 'noopener noreferrer' }, text);
        }
        const setupPackages = [
          {name:'dshmarket',label:'dshmarket'},
          {name:'dsh-ops',label:'dsh-ops'},
          {name:'dsh-free-search',label:'dsh-free-search'},
          {name:'@michengai/dsh-archive-manager',label:'dsh-archive-manager'},
          {name:'dsh-rewind-plugin',label:'dsh-rewind'},
        ];
        function setupFailureText(t, code) {
          if (!code) return null;
          const key = ['pnpm-missing','pnpm-runtime-unavailable'].includes(code) ? 'setupRuntimeMissing'
            : ['network','timeout','registry-unavailable'].includes(code) ? 'setupNetwork'
            : code === 'permission' ? 'setupPermission'
            : code === 'incompatible-version' ? 'setupIncompatible'
            : ['build-approval-required','build-blocked'].includes(code) ? 'setupBuildBlocked'
            : code === 'disk-full' ? 'setupDiskFull' : 'setupGenericFailure';
          return t(key);
        }
        function PluginSetup({ state, busy, t, showAction = true }) {
          const setup = state?.pluginSetup;
          const statuses = {pending:'setupWaiting',checking:'setupChecking',installing:'setupInstalling',installed:'setupInstalled','already-installed':'setupAlready','present-disabled':'setupDisabled','restart-required':'setupRestart',failed:'setupFailed',overridden:'setupOverridden','unsupported-platform':'setupUnsupported'};
          const restart = setup?.items?.some(item => item.status === 'restart-required');
          return h('section', {className:'nf-card', 'aria-label':t('setupTitle'), 'aria-busy':!!setup?.running},
            h('h3', null, t('setupTitle')),
            h('p', {className:'nf-muted'}, t('setupIntro')),
            h('p', {className:'nf-muted'}, t('setupRegistry')),
            h('p', {role:'status'}, !setup ? t('setupStatusUnavailable') : setup.running ? t('setupRunning') : setup.attempted ? t('setupFinished') : t('setupIdle')),
            h('ul', {style:{listStyle:'none',margin:0,padding:0}}, setupPackages.map(plugin => {
              const item = setup?.items?.find(row => row.name === plugin.name);
              const message = item && ['failed','overridden','unsupported-platform'].includes(item.status) ? setupFailureText(t,item.code || 'install-failed') : null;
              const version = typeof item?.version === 'string' && /^[0-9A-Za-z.+-]{1,64}$/.test(item.version) ? ' · '+item.version : '';
              return h('li', {key:plugin.name,style:{padding:'10px 0',borderTop:'1px solid var(--dsw-alias-border-l1)',overflowWrap:'anywhere'}},
                h('div', null, h('strong', null, plugin.label), version),
                h('div', {className:'nf-muted'}, t(statuses[item?.status] || 'setupWaiting')),
                message && h('p', {className:'nf-notice'}, message)
              );
            })),
            setup?.error && h('p', {className:'nf-notice',role:'alert'}, setupFailureText(t,setup.error)),
            restart && h('p', {className:'nf-notice',role:'status'}, t('setupRestartHelp')),
            h('p', {className:'nf-muted'}, t('setupPolicy')),
            showAction && h('div', {className:'nf-actions'}, button(t('setupRetry'), openInstallDialog, !!busy || !state?.connected))
          );
        }
        function openInstallDialog() { installDismissed = false; publish({installDialogOpen:true}); }
        function closeInstallDialog() { installDismissed = true; publish({installDialogOpen:false}); }
        function InstallDialog() {
          const {state,busy,error,installDialogOpen,t} = useView();
          const panel=React.useRef(null);
          const firstButton=React.useRef(null);
          React.useEffect(() => {
            if (!installDialogOpen || !state?.connected) return;
            const previous=document.activeElement;
            firstButton.current?.focus();
            const onKey=event => {
              if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeInstallDialog();return;}
              if(event.key!=='Tab')return;
              const elements=Array.from(panel.current?.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]') || []);
              if(!elements.length){event.preventDefault();panel.current?.focus();return;}
              const first=elements[0],last=elements[elements.length-1];
              if(event.shiftKey&&(document.activeElement===first || !panel.current?.contains(document.activeElement))){event.preventDefault();last.focus();}
              else if(!event.shiftKey&&(document.activeElement===last || !panel.current?.contains(document.activeElement))){event.preventDefault();first.focus();}
            };
            const onFocus=event=>{if(panel.current&&!panel.current.contains(event.target))firstButton.current?.focus();};
            document.addEventListener('keydown',onKey,true);document.addEventListener('focusin',onFocus,true);
            return ()=>{document.removeEventListener('keydown',onKey,true);document.removeEventListener('focusin',onFocus,true);if(previous?.isConnected)previous.focus?.();};
          },[installDialogOpen,state?.connected]);
          if(!installDialogOpen || !state?.connected)return null;
          const running=!!state.pluginSetup?.running;
          return h('div',{className:'nf-install-backdrop',onMouseDown:event=>{if(event.target===event.currentTarget)closeInstallDialog();}},
            h('style',null,css),
            h('section',{ref:panel,className:'nf-account nf-install-dialog',role:'dialog','aria-modal':true,'aria-labelledby':'nf-install-title','aria-describedby':'nf-install-help',tabIndex:-1},
              h('header',{className:'nf-actions',style:{justifyContent:'space-between'}},
                h('h2',{id:'nf-install-title'},t('installConfirmTitle')),
                h('button',{ref:firstButton,type:'button',className:'nf-button','aria-label':t('installClose'),onClick:closeInstallDialog},'×')),
              h('p',{id:'nf-install-help'},t(running?'installRunningHelp':'installConfirmHelp')),
              h(PluginSetup,{state,busy,t,showAction:false}),
              error && h('p',{className:'nf-notice',role:'alert'},errorText(t,error)),
              h('footer',{className:'nf-actions',style:{justifyContent:'flex-end'}},
                button(t(running?'installClose':'installLater'),closeInstallDialog,false),
                !running && button(t('installConfirmButton'),()=>{void act('confirm_plugins');},!!busy || !state.pluginSetup?.confirmationId,true))
            ));
        }
        function Account({ compact = false } = {}) {
          const { state, loaded, busy, error, t } = useView();
          const [confirmSignout, setConfirmSignout] = React.useState(false);
          React.useEffect(() => { setConfirmSignout(false); }, [state?.connected, state?.hasCredential]);
          const canSignout = !!(state?.connected || state?.hasCredential);
          const recovery = !state?.connected && !!state?.hasCredential;
          const credentialRejected = recovery && [error, state?.error].some(code => code === 'AUTH_REQUIRED' || code === 'SIGNOUT_REQUIRED');
          const waiting = isPending(state);
          const authorization = waiting ? safeAuthorization(state) : null;
          const phase = state?.attempt?.phase;
          const terminal = !state?.connected && ['cancelled', 'canceled', 'expired', 'failed'].includes(phase);
          return h('section', { className: 'nf-account', 'aria-busy': !!busy, 'aria-label': t('title') },
            h('style', null, css),
            !compact && h('header', null, h('h2', null, t('title')), h('p', { className: 'nf-muted' }, t('intro'))),
            !loaded ? h('p', { role: 'status' }, t('loading')) : h('div', { className: 'nf-card' },
              h('h3', null, state?.connected ? state.account?.displayName || t('accountFallback') : waiting ? t('pending') : t('signedout')),
              state?.connected && h('p', { className: 'nf-muted', role: 'status' }, t('connected')),
              waiting && h('div', { role: 'status' }, h('p', null, t('pendingHelp')), h('p', { className: 'nf-muted' }, t('popupHelp'))),
              recovery && !waiting && h('p', { role: 'status' }, t(credentialRejected ? 'reconnectHelp' : 'syncRetryHelp')),
              terminal && h('p', { role: 'status' }, t(phase === 'expired' ? 'expired' : phase === 'failed' ? 'failed' : 'cancelled')),
              h('div', { className: 'nf-actions' },
                !canSignout && !waiting && button(busy ? t('working') : t('signin'), () => { void act('start'); }, !!busy, true),
                authorization && external(t('openAuthorization'), authorization),
                waiting && button(t('cancel'), () => { void act('cancel'); }, !!busy),
                canSignout && !waiting && !credentialRejected && button(busy ? t('working') : t('refresh'), () => { void act('refresh'); }, !!busy),
                external(t('platform')),
                canSignout && !confirmSignout && button(t('signout'), () => setConfirmSignout(true), !!busy)
              ),
              canSignout && confirmSignout && h('div', { className: 'nf-notice', role: 'group', 'aria-label': t('signout') },
                h('p', null, t('signoutConfirm')),
                h('div', { className: 'nf-actions' },
                  button(t(recovery ? 'dismissSignout' : 'keepConnected'), () => setConfirmSignout(false), !!busy),
                  button(busy ? t('working') : t('signoutYes'), () => { void act('signout'); }, !!busy, true)
                )
              )
            ),
            (error || state?.error) && h('div', { className: 'nf-notice', role: 'alert' },
              h('p', null, errorText(t, error || state.error)),
              !credentialRejected && button(t('retry'), () => { if (canSignout && !waiting) void act('refresh'); else void readState(); }, !!busy)
            ),
            state?.warning && h('p', { className: 'nf-notice', role: 'status' }, t(({ REVOKE_FAILED: 'revokeFailed', MODEL_CLEANUP_FAILED: 'cleanupFailed', CLEANUP_AND_REVOKE_FAILED: 'cleanupAndRevokeFailed' })[state.warning] || 'warning')),
            !compact && (state?.connected || state?.pluginSetup?.attempted) && h(PluginSetup, {state,busy,t}),
            !compact && h('div', { className: 'nf-card' }, h('h3', null, t('balance')), h('p', { className: 'nf-muted' }, t('balanceUnknown')), h('div', { className: 'nf-actions' }, external(t('platform')))),
            state?.connected && !compact && h('div', { className: 'nf-card' },
              h('h3', null, t('models')),
              h('p', null, t('modelsHelp')),
              h('p', { className: 'nf-muted' }, t('modelThinkingHelp')),
              h('p', { className: 'nf-muted' }, t('modelConnectionHelp'))
            )
          );
        }
        function Launcher({ wide, openSettings }) {
          const { state, t } = useView();
          const label = state?.connected ? state.account?.displayName || t('accountFallback') : t('title');
          return h(React.Fragment, null, h('style', null, css),
            h('button', { type: 'button', className: 'nf-launcher', 'data-narrow': wide === false, title: label, 'aria-label': t('nav'), onClick: () => openSettings('account') },
              h('span', { className: 'nf-avatar', 'aria-hidden': true }, 'N'),
              wide !== false && h('span', { className: 'nf-launcher-label' }, label)
            )
          );
        }
        function SignIn() { return h(Account, { compact: true }); }
        function ModelsFooter() {
          const { t } = useView();
          return h('aside', { className: 'nf-account', 'aria-label': t('modelFooterTitle') },
            h('style', null, css),
            h('div', { className: 'nf-notice nf-guidance' },
              h('h3', null, t('modelFooterTitle')),
              h('p', null, t('modelFooterHelp')),
              h('p', { className: 'nf-muted' }, t('modelThinkingHelp')),
              h('p', { className: 'nf-muted' }, t('modelConnectionHelp'))
            )
          );
        }
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({name:'shell.overlay',id:'novaflow-plugin-install-confirmation',order:60}, InstallDialog));
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'account', order: -10, priority: 100, label: () => translate('nav'),
        }, Account));
        ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher', priority: 100 }, Launcher));
        ctx.slots.inject('settings.models.sign-in', () => ctx.slots.register({ name: 'settings.models.sign-in', priority: 100 }, SignIn));
        // The installed Models footer contract intentionally has no owner props.
        // Keep this guidance global rather than guessing a provider-card row shape.
        ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
          name: 'settings.models.footer', id: 'novaflow-native-model-guidance', order: 20,
        }, ModelsFooter));
        ctx.effect(() => {
          const focus = () => { if (!document.hidden) void readState(); };
          window.addEventListener('focus', focus);
          document.addEventListener('visibilitychange', focus);
          void readState();
          return () => {
            disposed = true;
            generation++;
            clearTimeout(pollTimer);
            for (const controller of controllers) controller.abort();
            controllers.clear();
            listeners.clear();
            window.removeEventListener('focus', focus);
            document.removeEventListener('visibilitychange', focus);
          };
        });
      },
    };
  },
});
