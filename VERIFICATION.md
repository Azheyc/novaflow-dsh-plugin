# NovaFlow 插件验证记录

## 2.6.0：New API余额与现场验收边界

2026-11-16。版本2.6.0，保留DSH `0.2.2-rc.2 || 0.2.2-rc.3`兼容。以下2.5.0及更早验证原文保留；历史余额限制只描述对应版本，不代表2.6.0现状。

本版调用NovaFlow New API既有 `GET /api/novaflow/v1/plugin/usage`，使用 `nfds_` 设备access；不使用Cookie、PAT或后台模型Key，无需改后端。标准 `/v1/dashboard/billing/subscription`／`usage` 不接受creator令牌且不适用于企业钱包，本版采用的是平台插件用量路由，不是标准billing端点。

契约为 `schema_version=1`、`account_mode=personal|enterprise`，对应 `personal`／`company` 对象的 `balance`、`frozen`、`available` 均为CNY decimal字符串，金额已由服务端换算。主显available，另列总额、冻结和 `as_of`；成员日／月限额、used、remaining、canUse独立于公司总余额，null／不限额不当0，canUse=false提示额度限制。

新增HTTP与Agent动作 `refresh_balance`，既有state包含余额且只读Host状态。登录、账户刷新、默认每10分钟后台刷新后非阻塞读余额；按钮可单独刷新，UI约1.8秒轮询不重复调用平台。失败不影响模型登录，error／unavailable明确展示；已成功数据保留并标旧，无数据不显示假0。退出／拒绝／切换身份清余额并中止或忽略旧请求。

最终完整测试**212项全部通过**：原190项，加Client VM 10项和Host／parser／生命周期12项。覆盖钱包与限额解析、金额单位、余额刷新动作、界面状态及旧请求生命周期保护；隔离测试不代表真实平台金额验收。

通过官方disable／enable两次重新应用，两次均返回 `application=applied`、无warnings。实际 `state` 返回版本2.6.0，`connected=false`、`hasCredential=true`、`error=AUTH_REQUIRED`、`balance=null`；实际调用 `refresh_balance` 返回 `AUTH_REQUIRED`，未伪造线上数值，也未为验收自动登录或退出。

在既有GUI `http://127.0.0.1:51785` 读取真实 `clientURL`，revision为 `f92ee7b36197`，GET200、42840bytes，响应含BalanceCard、“刷新余额”、“今日剩额”及stale组件。该证据证明当前GUI提供了新客户端资源，不代表已实际点击、截图或完成主题视觉检查。

**真实金额待验收：**当前账户仍为 `AUTH_REQUIRED`，没有真实在线余额结果。必须用户自行重新授权后，对照当前个人／公司钱包金额、成员限额与更新时间现场核验；不自动登录或退出。隔离测试、资源检查和Slot注册不代表真实在线金额已验收，也不表示付费模型／媒体调用或Windows／主题视觉检查已完成。

## 2.5.0：家族协议与离线迁移

2026-11-16。保留DSH `0.2.2-rc.2 || 0.2.2-rc.3`兼容，不创建版本豁免。下方2.4.1及更早验证原文保留。

实现按原始模型ID家族选择协议：Claude使用Anthropic Messages，其他文本模型使用OpenAI Responses；Claude识别支持原始ID开头及常见vendor前缀／斜杠／冒号／点，大小写不敏感。历史source提供商标识保留；纯家族source原地更新协议与本机URL，混合source拆为确定性家族child。原生名称、容量、删除及modelOverrides按家族保留，模型显示原始ID，计费路由继续使用授权group。默认选择跟随同一模型迁至新提供商；已有会话引用被拆走的模型时需重新选择。

`protocolPolicy=claude-messages-v2`标记一次迁移，后续普通刷新保留原生编辑。跨协议清理不适用compat。Claude思考按官方metadata规范：off为null，未知Claude保守false，不额外宣称adaptive；不直接套用Responses的none/xhigh，部分Claude的官方metadata确实支持xhigh。迁移保留已知Claude官方允许的自定义档位子集，也保留非Claude有效自定义档位子集，不自动扩展；off的none／null按目标协议转换。

新增HTTP与Agent动作 `migrate_protocols`仅迁移旧协议，保留已有图片／思考设置语义，并标记能力初始化已处理，避免后续联网刷新重置既有input／reasoning。可离线编辑已保存受管配置；离线绝不发布cached bridge permissions。首次能力启用沿用开关语义；`configure_models`则显式重新启用图片输入及协议原生档位。

最终完整测试，**190项全部通过**（原169项加新增21项）。覆盖家族识别与协议、纯家族迁移／混合拆分、原生设置与删除／overrides保留、默认模型迁移、一次策略及后续编辑、官方metadata和档位有效子集、离线能力保留与桥权限隔离、HTTP／Agent动作等。隔离测试不代表真实平台逐模型能力验收。

通过官方disable／enable重新应用，返回 `application=applied`、无warnings。随后实际调用 `novaflow_account` 的 `migrate_protocols` 成功：版本2.5.0、策略 `claude-messages-v2`、`capabilitiesReset=false`、`providerCount=1`、`modelCount=7`。当前7个本地受管Claude模型均为 `api=anthropic-messages`，`imageModelCount=7`。此结果只验证当前已保存本地模型的离线迁移，不把历史24模型目录当作本轮授权现状。

既有GUI为 `http://127.0.0.1:51785`；读取实际Client资源，revision为 `c51462e91d9b`，GET200、36380bytes，包含中英新协议说明。资源检查证明提供了对应内容，不代替按钮点击、截图或主题视觉验收。

账户仍返回 `connected=false`、`hasCredential=true`、`error=AUTH_REQUIRED`。用户需先退出旧凭据再重新登录，才能重新获取授权目录或发起调用；本轮未自动退出。离线迁移成功不等于账户连接恢复，也不开放缓存权限。媒体MCP旧同名冲突仍在，未声称媒体服务健康。本轮未执行真实付费对话／图片／视频请求、视觉实机或Windows实机验收。

## 2.4.1：DSH 0.2.2-rc.3 兼容

2026-11-16。当前官方Desktop的DSH为0.2.2-rc.3，自带Node24.21.0。修改前官方库存将2.4.0列为 `incompatible-version`，原因是 `engines.dsh=0.2.2-rc.2`。原167项测试已先在rc.3完整通过，覆盖真实随附Config、catalog、adapter、SDK、MCP客户端及回环HTTP。

通过当前Host Inspect核对connection、tools、webServer、configEditor、pluginManager、mcpManager、storageDomain、clientModules等契约，没有发现必须改写的业务调用。插件升级为2.4.1，清单及锁文件声明 `0.2.2-rc.2 || 0.2.2-rc.3`，保留已有rc.2支持且不放行rc.4、正式0.2.2或其他未验证版本。未创建版本豁免，未关闭官方兼容校验。新增2项版本准入与运行时／锁文件一致性测试，使用当前安装随附semver。Host测试的旧版本硬编码改为发布常量。

最终**169项测试通过，0失败、0跳过**，`npm run check` 与 `git diff --check` 通过。运行逻辑、登录、原生模型和用户确认安装门槛保持原有规则；没有代用户确认推荐插件或执行真实模型／媒体付费调用。

通过官方 `set_bundle enabled=true` 重新评估已安装的本地链接，返回 `application=applied`、无warnings。随后的官方库存确认版本2.4.1，无兼容错误；`include:novaflow-account` 为enabled且fiberPhase=active。初次Client Inspect未响应，应用后再次查询成功：`shell.overlay` 中 `novaflow-plugin-install-confirmation` active，`settings.models.footer` 中 `novaflow-native-model-guidance` active，`settings.launcher` 已注册且rc.3仍提供wide／openSettings。没有启动替代GUI服务器。

本轮没有重新执行浏览器点击、截图、主题视觉、Windows实机或外部CDN完整链路验收。媒体MCP同名配置冲突的条件性风险仍按排查手册处理；Host active不等于每个媒体工具已连接健康。本轮不把旧会话的账户连接、余额或工具目录当作rc.3现场数据。rc.2支持以此前完整验证与本轮未改业务接口为依据，当前机器仅安装rc.3，未重新启动一套rc.2实机环境。

以下为2.4.0及更早版本历史证据。

## GitHub 首次发布前核验

2026-11-13。公开源码仓库目标为 [Azheyc/novaflow-dsh-plugin](https://github.com/Azheyc/novaflow-dsh-plugin)。此次使用同一2.4.0运行逻辑，补充GitHub元数据、公开下载说明和完整开发文档，移除本机私有目录链接。重新打包交付最新文档，不上传此前缺少新文档的旧附件。

发布前在当前DSH工具环境使用自带运行时重跑完整测试，**167项通过，0失败**；另以Node26.11.1执行 `npm run check` 通过。只读源码审阅未发现真实令牌、私钥或个人绝对路径；测试凭据为合成夹具。Git忽略依赖、旧安装包、环境文件与媒体输出，实际提交和包清单在发布步骤中复核。

该发布不重载本机插件，不修改账户、原生模型或推荐插件安装状态，不执行真实模型／媒体付费调用。此前浏览器视觉、Windows实机和MCP同名冲突边界仍适用，不能因GitHub发布被视为已解决。远端提交、安装包与校验文件的结果以GitHub Release为准。

## 2.4.0 本轮结果

2026-11-13。用户截图证实旧前端仍存在推荐弹窗/新会话填草稿，而后端已有PluginBootstrap；此前仅凭后端状态称界面已恢复的结论不充分。此次直接移除startSession、installationPrompt、uiWorkspace依赖及recommendDraft/recommendNoInstall语言资源，改为真正安装确认弹窗和逐项状态。

按用户最新要求：登录后提醒，只有本人在弹窗点击“确认并开始安装”才发起官方安装。initialize、状态读取、账户刷新和授权callback均不会启动安装；AI工具retry_plugins仅请求确认，不启动。confirm_plugins未进入Agent工具schema，并在Host验证interactive调用、当前登录和一次性confirmationId。旧确认、未登录或AI直接调用被拒。关闭窗口不安装，正在安装时关闭不取消已接纳操作。保存中的旧running记录不会在新插件生命周期自动恢复，需重新确认。

版本2.4.0已在当前GUI http://127.0.0.1:49461通过官方管理器重载，application=applied，无warnings。实际账户状态返回connected=true、error=null、pluginSetup.running=false、confirmationRequired=true。没有代替用户确认，没有为此次界面验证执行安装。

新增delivery诊断从当前clientModules.graph读真实资源而非猜测路径：version=2.4.0、installFlow=user-confirmed-official-installer-v1、clientRevision=630b759f78aa。实际GET `/plugins/??@local/novaflow-dsh-plugin/client.js&rev=630b759f78aa` HTTP200，检查响应体含novaflow-plugin-install-confirmation、confirm_plugins、PluginSetup和确认安装文案；不含ctx.uiWorkspace.startSession、recommendNoInstall、为全部五个填入安装请求或打开新会话填词。Client Slots.listSubTree(shell.overlay)确认新id active，旧novaflow-plugin-recommendations已不在树中。

最终**167项测试通过，0失败、0跳过**，语法检查通过。增加5项确认门槛与2项分发契约测试，Host集成测试增强为验证登录/读取/重试不触发安装、工具不能代确认、交互HTTP确认后才接纳、旧确认重放拒绝。构建脚本打包前运行纯确认与前端契约测试，确保中英locale与内嵌字典一致、禁止草稿路径、发布版本与delivery一致。

独立UI/UX与权限审阅未发现阻断问题；已核对确认按钮、busy禁用、关闭/Escape、焦点循环及运行状态轮询。当前没有浏览器控制工具，**没有声称完成实际截图、按钮点击或浅深色视觉检查**；本轮验证的是实际提供的资源、实时Slot及隔离权限/安装逻辑。

下面为历史记录，2.3的无弹窗自动启动行为已由2.4用户确认门槛取代。

## 2.3.0 历史结果

2026-11-13，当前DSH 0.2.2-rc.2。插件已应用，官方管理器返回applied无warnings。保持NovaFlow登录，状态connected=true、error=null。

登录恢复成功后通过官方PluginManager的installBundle安装了缺少的 **dsh-ops 0.5.4**，指定首选registry=https://registry.npmmirror.com、saveExact和expected name/version。官方listBundles随后确认installed=true、enabled=true。其余四包已存在，跳过且未升级：dshmarket1.73.19、dsh-free-search0.9.46、@michengai/dsh-archive-manager1.3.5、dsh-rewind-plugin0.22.1。状态持久化后重载仍可读取：dsh-ops=installed，其余=already-installed，running=false。

实际激活中发现并修复三处隔离测试遗漏：storage unit名称必须符合官方UNIT_NAME_RE（改用novaflow_plugin_bootstrap）；Inspect所列listBundles同步签名与实际Promise返回不符（改为await）；状态中的undefined字段不能作为lossless JSON返回（snapshot去除可选undefined字段）。均补充真实官方类型或异步回归。

最终**160项测试通过，0失败、0跳过**：在2.2的127项上增加29项推荐插件安装与4项Windows运行时预检。覆盖固定五包与镜像、已有禁用保留、每profile一次、失败重试、构建脚本不代批准、版本豁免不授予、异步库存、重启结果、requestId恢复、HMR不等待自身安装、退出停后续任务、真实domain schema/name检查和无秘密的lossless JSON状态。

Windows路径含空格、自带pnpm缺失、版本启动异常均用fake filesystem/execute隔离测试；核对当前桌面版实际main.js的runtimeResources与Host启动代码，确认随应用提供pnpm而非依赖全局命令。**没有Windows实机，未声称已解决所有用户的Windows安装故障。** 镜像解决下载源，运行时缺失时提示修复/重装完整官方桌面版并停止队列，未安装全局Node/pnpm、修改PATH或要求管理员权限。

独立UI/UX与生命周期审阅后修复：已有dependency但bundle/activation错误不能假报已安装；restart-required在同进程重试不被覆盖；五包全已安装无需pnpm预检。账户页有状态卡、重试与本地化错误说明，无自动重启或代批准按钮。未进行浏览器截图/视觉验收。

本轮同时观测到当前agent预设覆盖旧magpie-image客户端停用设置，导致既有MCP同名冲突；set_plugin返回overridden，未修改该预设。本轮自动安装功能不依赖媒体MCP，也未将其失败误报为插件安装失败。下面媒体与24模型记录为**2.2历史验证**，不等于本轮平台目录现状。

## 2.2.0 历史：内置媒体 MCP 与原生模型配置

日期：2026-11-13。当前 DSH 0.2.2-rc.2，Electron44.7.0，Node24.21.0。

## 当前已应用结果

已通过 plugin_manager 重载并启用，结果 application=applied，无warnings。保留现有 NovaFlow 登录，调用账户状态工具确认connected=true、error=null。

实际读取原生配置的脱敏摘要：**7个受管提供商、24个已配置模型**；全部api=openai-responses，imageModelCount合计24；每个模型均配置off、low、medium、high、xhigh、max。模型显示原始ID，无分组后缀。

官方llm-pi-ai持有原生提供商、模型编辑、目录发现、能力解析及推理SDK；插件通过ConfigEditor保存，不手工重写profile文件。平台设备token未写入模型配置，仅本机独立连接凭据以引用方式进入官方凭据服务。

首次运行批量迁移曾返回MODEL_SETTINGS_WRITE_FAILED；保留了原生配置及登录，经相同工具刷新重试后完成并核对上述结果，不将首次失败当成成功。未使用真实模型请求来验收。

## 内置媒体 MCP 实际验证

已停用当前配置中的旧 `magpie-mcp-magpie-image` 静态客户端，避免同名工具冲突；新插件通过mcpManager注册同名真正Streamable HTTP MCP服务，无需Magpie进程。

实际Tool Inspect确认四个 `mcp__magpie-image__*` 工具已经加载，generate_image说明默认gpt-image-2.6、不需Magpie选模型；generate_video的schema要求model且说明必须由用户明确选择。MCP服务器instructions会由DSH官方客户端注入系统提示，包含视频不得默认/旧配置/自动首选、unknown结果不得重提等规则。

使用真实MCP工具只读查询NovaFlow授权目录，确认当前账户gpt-image-2.6在“gpt-image生图分组”可用；视频列出doubao-seedance-2.0/fast/mini/2.5。没有生成图片或视频，没有计费调用。

输出目录和作业恢复采用默认工作目录；媒体网络请求复用当前设备登录。独立审阅后修复输出冲突先收费、未知提交结果诱发重试、元数据截断、崩溃后既有输出无法恢复、外链下载DNS重绑定和无body响应构造异常；媒体测试覆盖相应可隔离的流程，外部真实CDN下载仍未端到端实测。

## 回归测试

执行：

```bash
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" --test test/*.test.js
```

最终127项通过，0失败、0跳过；语法检查通过。新增36项媒体执行测试和7项真实MCP客户端协议测试。

- 账户22项、协议11项：PKCE、回调校验、取消并发、串行轮换、未知刷新响应禁止重放、退出/卸载及秘密隔离。
- 原生配置30项：官方ConfigEditor保存、原生编辑与删除保留、名称无分组、端口更新、用户替换连接/密钥保留、默认模型恢复、队列锁卸载不死锁、初次配置失败重试、一次迁移及新连接偏好。
- 桥接18项：三协议鉴权与分组、真实回环HTTP路由、官方模型发现、请求大小及权限限制、SSE背压、中止、超时、安全错误、Anthropic beta参数与必要header。
- Host1项与审阅回归2项。

思考测试经过实际安装的官方 **Config → apply → catalog → adapter → SDK**，检查Claude、GPT、DeepSeek各协议的low/high/max等字段，并拒绝未声明的档位；统一模式验证Responses `input_image` 与 `reasoning.effort=max`。Anthropic SDK另通过真实临时HTTP回环服务器进入bridge，再由mock上游返回SSE，覆盖实际`?beta=true`行为。

全部测试使用内存凭据、假图片/令牌及mock上游，不发生付费调用。临时回环服务器均清理，不启动替代GUI服务器。

## 界面与审阅

账户页移除独立模型列表，改为官方“设置 → 模型”的操作指引；说明每模型高级思考档位和对话选择器中的实际深度。双语文本与嵌入字典已核对一致，JavaScript语法检查通过。

独立审阅发现并修复：HMR配置写入锁与卸载互等、晚到配置写入复活、用户替换密钥被清除、目录更新失败保留旧bridge、Anthropic beta查询被拒、原协议compat残留使Responses无法解析。修复项有对应回归。

当前没有可用浏览器控制。最终实时Client Inspect确认settings.models.footer中的novaflow-native-model-guidance注册active。该注册和Host原生配置摘要均已验证，但不代表实际页面点击、截图或浅/深色视觉验收已通过；渲染仍需刷新页面后查看。

## 实际能力边界

统一启用是用户指定的客户端配置，并非已经逐模型确认平台支持图片、Responses和所有档位。未发送真实付费模型请求。平台设备接口仍未提供余额，账户页链接平台查看。
