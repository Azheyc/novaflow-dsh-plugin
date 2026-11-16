# 测试与发布

适用：插件 2.5.0，DSH 0.2.2-rc.2／0.2.2-rc.3。架构与接口见[开发手册](DEVELOPMENT.md)，已执行的历史证据见[验证记录](../VERIFICATION.md)。下文命令均在本插件包根目录运行。

## 1. 准备开发环境

使用 Node.js 24 及以上版本。完整测试会解析当前 DSH 随附的官方 Config、adapter、SDK 和 MCP 库，需要对应 DSH 安装；部分测试依赖工具子进程注入的 `DSH_INSTALL_DIR`。仅安装本包依赖不等于准备好了完整测试环境。

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

如果当前终端使用的是 Electron 可执行程序，在 DSH 工具环境中可直接运行：

```bash
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" --test --test-reporter=dot test/*.test.js
```

先确认环境变量由当前 DSH 工具提供。普通终端用已经确认版本的 Node 24+，不要复制其他机器的应用绝对路径。Host 并不保证存在 `DSH_INSTALL_DIR`，这也是运行时库解析同时支持 Desktop resources 和启动入口的原因。

## 2. 按改动选择验证

| 改动范围 | 重点用例与检查 |
|---|---|
| 账户授权或 API 校验 | [账户测试](../test/account.test.js)、[协议测试](../test/protocol.test.js)、[Host 测试](../test/host.test.js)；取消、过期、跨代次与未知刷新结果 |
| 原生模型及桥接 | [原生模型测试](../test/native-models.test.js)、[桥接测试](../test/model-bridge.test.js)；Claude前缀识别／Messages、其他模型Responses、纯家族原地迁移、混合source确定性拆分、名称／容量／删除／overrides与默认选择保留、真实官方序列化、SSE和中止 |
| 一次策略与离线迁移 | 原生模型与[Host测试](../test/host.test.js)；家族协议策略仅一次、后续原生编辑保留、跨协议compat清理、Claude官方metadata与off:null／未知false、`migrate_protocols`不重置图片／思考、离线不发布cached桥权限、`configure_models`显式重新启用能力 |
| 媒体工具与文件 | [媒体服务测试](../test/media-service.test.js)、[MCP 测试](../test/media-mcp.test.js)；未知提交结果、恢复、冲突和访问边界 |
| 推荐安装 | [确认门槛测试](../test/plugin-install-flow.test.js)、[安装队列测试](../test/plugin-bootstrap.test.js)、[运行时测试](../test/package-runtime.test.js)、Host 测试 |
| Client 文案与分发 | [分发契约测试](../test/client-contract.test.js)；双语字典、禁止会话草稿路径、release 常量与真实资源地址 |
| DSH版本准入 | [兼容性测试](../test/runtime-compatibility.test.js)；允许已验证rc.2／rc.3，拒绝未验证版本，并核对当前运行时与锁文件 |
| 生命周期回归 | [回归测试](../test/regressions.test.js)，并重跑相关模块的卸载／取消用例 |

发布前执行全量测试和语法检查。构建脚本运行的是入口语法检查及分发契约／确认门槛两组测试，**不包含完整测试套件**。

测试使用 mock 上游、内存凭据、临时目录和回环服务器，不发生付费模型生成。经过真实官方 SDK 的隔离测试也不等于真实 NovaFlow 请求验收。Windows 实机、浏览器点击与视觉、外部 CDN 下载等验证须单独记录。

## 3. 同步版本与说明

- 同步[包清单](../package.json)的 `version` 与[分发诊断](../src/release.js)的 `RELEASE_VERSION`；有依赖锁时同时核对锁中的版本与依赖。
- 安装流程发生语义变化时检查 `INSTALL_FLOW`；仅文案整理不伪造新流程标识。
- 按实际验证结果维护[使用说明](../README.md)、[插件详情](DETAIL.md)、[开发手册](DEVELOPMENT.md)及验证记录。
- Client 字典与[中文资源](../locale/zh.json)、[英文资源](../locale/en.json)同步。
- DSH 版本改变时重新检查 `engines.dsh`、原生库解析、ConfigEditor、PluginManager、MCP、Slots 和 SDK 契约，不能只放宽版本限制。

当前 `private:true`。交付方式是可安装 tarball，不使用 `npm publish` 发布公共包。

## 4. 打包与审查

完成全量测试后运行：

```bash
bash build.sh
```

[构建脚本](../build.sh)依次执行两个入口语法检查、两组契约测试、`npm pack --ignore-scripts`。脚本要求 PATH 中的 node/npm 对应准备好的开发环境；它不自动配置 Electron 运行时、不安装到 profile、不重载当前 GUI。

输出文件名由包名和实际版本决定，例如 `local-novaflow-dsh-plugin-2.5.0.tgz`。分发清单由包清单中的 `files` 控制：源码、补丁、locale、docs、测试、验证记录和构建脚本均被纳入；README 由 npm 自动纳入。根目录的其他说明不应被默认视为已经进入包。

交付前检查打包文件列表和包内版本、Client 内容、双语资源、文档链接。可先使用以下只读预览：

```bash
npm pack --ignore-scripts --dry-run --json
```

需要跨机器分发时，文档中的维护者本机外部链接只作来源线索；本包内部核心文档通过相对链接互相访问。记录包大小和 SHA256 后，交付该次实际生成的文件。修改文档不会更新之前生成的 tarball，不能用旧文件名冒充新内容。

## 5. 官方安装与当前页面核验

在 DSH 中使用官方插件管理能力安装包、启用或重载，不用 shell npm 写入 profile，也不手工改写 profile 清单。工作目录链接适合本机开发，tarball 适合分发；两者的字节内容必须分别核对。

安装或重载后按以下顺序收集证据：

1. 检查官方管理结果的 `application`、warnings、errors。`restart-required` 和 `overridden` 不能写成已经实时生效。
2. 只读调用 `novaflow_account` 的 `state`，核对 `delivery.version` 与 `delivery.installFlow`；核对 `pluginSetup.running`，不要为验证界面代用户确认安装。
3. 使用 `delivery.clientURL` 的真实地址读取当前提供的 Client，核对 revision 和关键行为；地址可能为空，此时先检查客户端模块图，不猜未带 revision 的路径。
4. 用 Client Inspect 的 `Slots.listSubTree` 核对 `shell.overlay` 中的 `novaflow-plugin-install-confirmation`，以及模型页的指引注册。
5. 刷新现有 GUI；如有浏览器控制或人工验收，再核对登录、关闭／稍后、确认、运行状态、键盘焦点与浅深主题。没有执行就写“未验收”。

当前 GUI 地址是会话运行信息，不能写死为跨机器地址。不要启动替代服务器来证明现有 GUI 已更新。Client 插件无刷新更新依赖同一 checkout 正在运行的 `pnpm run dev:web`；未核实 watcher 时按刷新后核验处理。DSH shell 或普通 packages 的修改则需重建对应 Web 产物，并刷新既有 URL 检查。

## 6. 回退与验证记录

回退使用保留的已验证安装包，经官方插件管理器执行，之后重新核对实际版本与页面资源。退出、停用和回退不是同一操作；停用本插件不会卸载已安装的推荐插件，也不应被当成远端设备已经撤销的证明。

每次发布至少记录：插件／DSH／Node 版本、执行的测试和结果、安装应用状态、实际 Client revision／Slot、是否操作真实授权／付费调用、是否做 Windows 实机和视觉检查，以及未解决问题。不得把历史通过数写成本轮重新执行结果。

## 2.5.0本轮核验

2026-11-16：执行最终完整套件，**190项全部通过**。通过官方disable／enable应用，返回 `application=applied`、无warnings；`migrate_protocols`完成离线迁移，返回版本2.5.0、`capabilitiesReset=false`、1个提供商／7个模型，当前7个本地受管Claude模型均为 `anthropic-messages`，`imageModelCount=7`。实际Client资源revision为 `c51462e91d9b`，GET200、36380bytes，含中英新协议说明。完整实现、测试和现场边界见[验证记录](../VERIFICATION.md)。

账户仍为 `connected=false`、`hasCredential=true`、`error=AUTH_REQUIRED`，需用户先退出旧凭据再重新登录，才能重新获取授权目录和调用；本轮未自动退出。媒体MCP旧同名冲突仍在，未执行付费请求或视觉实机验收。离线迁移只证明已保存配置完成转换，不表示账户已连接或缓存权限可请求；已有会话引用被拆走模型时需重新选模型。

## 2.4.0历史文档整理核验

2026-11-13：本次未改运行代码、未安装、未重载、未重打包。主代理重新执行分发契约、Windows 包运行时和安装确认三组测试，**11 项通过，0 失败、0 跳过**。2.4.0 完整套件的167项通过属于此前发布验证，详见验证记录，本次未重复全量执行。另外检查11份新增／更新文档的88处本地链接及章节锚点，全部通过；`npm pack --ignore-scripts --dry-run --json` 确认本包预览39个文件，6份使用／开发文档入口及其包内链接目标均在分发清单中。该预览未生成新tarball。
