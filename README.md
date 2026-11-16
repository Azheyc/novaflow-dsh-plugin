# NovaFlow for DeepSeek Harness

版本 **2.4.1**，兼容 DeepSeek Harness **0.2.2-rc.2 和 0.2.2-rc.3**。通过 NovaFlow 浏览器设备授权登录，使用 DSH 官方模型配置管理连接与思考深度，无需复制平台 API Key。

## 获取与安装

源码仓库：[Azheyc/novaflow-dsh-plugin](https://github.com/Azheyc/novaflow-dsh-plugin)。

从 [GitHub Releases](https://github.com/Azheyc/novaflow-dsh-plugin/releases) 下载与当前DSH版本匹配的 `.tgz` 安装包，通过DSH官方插件管理能力安装并启用。Release同时提供 `SHA256SUMS`，用于核对下载文件。2.4.1明确适配DSH **0.2.2-rc.2、0.2.2-rc.3**，不自动放行后续未验证版本；详细步骤见[安装与快速开始](docs/GETTING_STARTED.md)。

这是独立插件包，无需替换DSH应用。仓库保留 `private:true`，不通过npm公共仓库发布；GitHub源码仓库和Release安装包公开提供。

## 文档入口

- [文档索引](docs/README.md)：按任务选择阅读路径与当前行为基线。
- [安装与快速开始](docs/GETTING_STARTED.md)：安装、升级、登录、首次使用和退出。
- [开发手册](docs/DEVELOPMENT.md)：架构、源码地图、配置、接口、凭据和生命周期。
- [测试与发布](docs/RELEASE.md)：环境、测试矩阵、打包及实际客户端资源核验。
- [故障排查](docs/TROUBLESHOOTING.md)：登录、原生模型、确认安装、Windows运行时和MCP冲突。
- [验证记录](VERIFICATION.md)：各版本实际执行的检查与未验收范围。

## 登录与模型配置

1. 打开 **账户与余额 → 登录 NovaFlow**，在网页登录并由本人确认授权。
2. 插件将授权连接保存到官方 **设置 → 模型** 的提供商配置中。已登录的2.0用户升级后会自动迁移。
3. 在 **设置 → 模型** 中展开 NovaFlow 提供商，可使用原生的获取模型、添加、编辑、删除和保存流程。
4. 模型名称默认使用原始模型 ID，不追加分组名称。相同模型在不同分组中的路由仍然独立，分组只由提供商归属区分。
5. 已有会话显式选择保持原样。新的首次登录会选择首个可用模型作为新会话默认模型。

账户页只负责登录与同步，不再维护独立的模型编辑/选择列表。

后台每10分钟刷新账户授权目录。已有原生模型名称、容量、思考档位及兼容设置不会被后台覆盖；删除的模型或提供商不会因普通刷新被重新添加。需要重新添加模型时使用官方“获取模型”或手动添加；删除整个提供商后可以重新登录来重新配置。

## 登录后确认并安装推荐插件

登录成功后（包括已保存登录在启动时恢复成功），插件显示推荐插件确认弹窗。**只有用户点击“确认并开始安装”后**，才通过 **DSH官方PluginManager** 自动完成以下五个固定插件的检查与安装，首选镜像 `https://registry.npmmirror.com`：

| 名称 | 实际npm包名 |
|---|---|
| 插件市场 | `dshmarket` |
| dsh-ops | `dsh-ops` |
| dsh-free-search | `dsh-free-search` |
| dsh-archive-manager | `@michengai/dsh-archive-manager` |
| dsh-rewind | `dsh-rewind-plugin` |

关闭或选择“稍后再说”不启动安装，可在账户页重新打开确认弹窗。不会新建会话、预填安装提示词或替用户发送消息。登录、账户刷新、读取状态以及AI工具请求重试均不会绕过确认门槛。已有安装记录保留，已安装项跳过、已禁用的选择保持禁用，不自动升级。首次成功安装按镜像检查到的具体版本保存，兼容性与平台限制由官方安装器执行。

弹窗及账户页的“推荐插件自动安装”卡显示逐项检查、正在安装、成功、已存在、失败、被配置覆盖或需要重启。安装中关闭弹窗不取消已经开始的操作。失败后可打开弹窗再次确认重试；重试也只处理这五个包，不接收任意安装地址。`dsh-ops`新版包含Windows/Linux/macOS适配；它会提供自己的工具和预设行为，具体功能以该插件说明为准。

需要重启时由用户自行重启，不自动关闭应用。构建脚本待批准、版本不兼容等情况不会被插件绕过：不自动批准安装脚本，不创建版本豁免。相关状态提示去官方插件管理中处理。

镜像是官方安装器的首选源；它的已配置回退行为仍由DSH管理，不修改用户全局npm registry或PATH。

### Windows 包管理器问题

当前官方DSH桌面版随应用提供pnpm，并用自带运行时启动它；通常无需用户安装全局Node/npm/pnpm。本插件在Windows Desktop上先检查其内置pnpm入口，并以安全参数数组执行一次`--version`，支持含空格的安装路径。

若缺失或启动失败，停止安装队列并提示修复/重新安装完整官方DSH桌面版，重启后再重试。镜像仅解决下载源，不能补齐缺失的运行时。不会自动修改系统PATH、全局安装包管理器或要求管理员权限。

网络、超时、权限/文件占用、版本不兼容与缺包管理器分别显示，不统一归咎于pnpm。CLI、自制便携版或非官方打包方式需要按其部署方式提供Node/pnpm；本插件不假装可以修复所有发行方式。本轮没有Windows实机，只通过隔离测试和已安装桌面版源码核对路径与调用方式。

## 配置思考深度

1. **设置 → 模型 → 对应 NovaFlow 提供商 → 模型编辑 → 高级**：开启思考能力，配置该模型支持的档位和请求值，保存。
2. 在对话底部的原生模型选择器中选择模型，再选择实际使用的思考深度。

按用户指定的统一配置，本版本首次迁移会将全部受管提供商设为 **OpenAI Responses**，全部模型开启 **text/image** 输入和 **off、low、medium、high、xhigh、max** 档位。关闭档位映射为 Responses 的 `none`。新增连接也继承该偏好；迁移完成后保留用户在原生页面的后续编辑。

这里只开启可选择的档位，不强设每次调用的默认深度。用户选择经官方Config、catalog、adapter与SDK生成 `reasoning.effort` 与图片 `input_image`。平台具体模型是否支持图片、Responses以及某个深度，仍以服务端实际能力为准；客户端选项不构成上游能力保证。

通过工具 `novaflow_account` 的 `configure_models` 可按相同规则重新应用所有受管连接；此操作会覆盖其当前协议、图片开关与思考档位，普通目录刷新不会。

## 内置 magpie-image MCP

插件内提供同名 MCP 服务，并通过 DSH 官方 MCP 客户端连接；不依赖 Magpie 应用、Magpie Gateway 或其模型设置。旧的外部 Magpie MCP 入口会停用，保留一致的工具名称：

- `mcp__magpie-image__generate_image`：不填 model 时直接使用 NovaFlow 的 **gpt-image-2.6**。支持文字生图、本地/HTTPS参考图编辑、1～4张输出及 size/quality/background。
- `mcp__magpie-image__generate_video`：**model 必填**。Agent 必须使用用户在当前请求或有效当前上下文中明确选择的模型；没有选择时先列模型并询问，禁止使用默认、旧profile或自动取首个。
- `mcp__magpie-image__list_models`：只读列出当前账户授权的图片/视频模型和分组。多组同名模型要求明确group，不自动选择计费路由。
- `mcp__magpie-image__generation_result`：查询返回的作业ID并取得本地结果文件。

工具描述和MCP服务器instructions已同步修改。DSH将服务器instructions加入模型系统提示词，不再提示到Magpie选择模型。图片模型没有权限时明确失败，不自动切换其他模型。

长任务短暂等待后返回作业ID；继续查询，不重复提交。网络中断或重启导致结果未知时显示unknown，提醒可能已计费，须检查平台历史后再决定下一步。视频轮询使用可信平台内容接口，不要求手动复制下载链接。

结果默认写入DSH默认工作目录的`generated-images/`或`generated-videos/`；相对path和参考图也按该默认工作目录解析。已有输出文件在提交前拒绝，路径不越出默认工作目录、不穿过符号链接。作业元数据在该工作目录`.novaflow-media/jobs/`持久保存，不含平台凭据。

媒体服务使用NovaFlow当前设备凭据，退出/卸载会中止在途本机工作。原生模型页的图片输入选项与这里的图片生成功能是独立操作。当前视频实现采用平台标准`/v1/videos`；各模型的参考图上传能力仍以其后端为准，不承诺适配全部非标准视频扩展。

## 连接与凭据

原生提供商的本机连接地址由插件管理，保留插件填入的地址即可。该地址使用仅本机可用的独立连接凭据；平台设备访问/刷新凭据不写入模型配置。真实模型请求仅转发到固定 NovaFlow 平台，并由插件附加设备 Bearer 与分组标识。

模型发现走官方“获取模型”流程；调用正文中的思考、工具及协议字段由原生 SDK 生成，本机转接不重写它们。平台撤销某个组或模型权限后，即使保留了原生模型配置，该连接也无法继续调用该模型。

## 退出与保留

退出会清除本机登录和插件持有的连接凭据、中止运行中的 NovaFlow 请求，并撤销当前设备。**原生提供商及模型配置会保留**，重新登录后可继续使用。若默认模型仍指向 NovaFlow，会恢复登录前的默认模型；后来切换到其他供应商的选择保留。

普通后台刷新不会覆盖用户改过的连接地址、协议或密钥。若用户将某个原生提供商改作其他连接，插件停止管理该连接，不删除后来替换的密钥。

远端撤销失败会明确提示在 NovaFlow“安全与访问”手动撤销设备，不会退出网页登录或撤销其他设备。刷新响应丢失时不重放旧refresh，要求重新登录。

## 范围与限制

- 对话模型接入 `kind=text` 的授权目录；图片/视频生成由内置MCP独立提供，使用平台图片/视频endpoint目录。
- 平台设备接口暂未提供余额查询，账户页链接到平台查看，不显示假定余额。
- 容量、输出上限与能力先采用可确认的内置目录；未知型号采用32768上下文预算、4096默认输出上限、文本输入，可在官方模型页修改。
- 网页账户入口替换官方账户UI；不修改应用安装文件或原生首次启动欢迎窗口。
- 当前仅适配指定DSH版本。升级DSH后须核对官方配置和SDK契约。

## 开发与验证

开发使用Node.js 24及以上，并准备当前DSH安装供官方库集成测试解析。普通Node环境可在包目录运行：

```bash
npm install --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

DSH工具环境使用自带Electron运行时时，测试命令为：

```bash
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" --test test/*.test.js
```

全量检查通过后按[测试与发布](docs/RELEASE.md)打包。构建脚本仅执行语法检查和两组契约测试，不能代替全量测试。测试使用内存凭据、mock上游和临时回环HTTP服务器，不发生付费模型请求；真实官方Config、catalog、adapter与SDK进入思考深度测试。已执行的结果见[验证记录](VERIFICATION.md)。

Agent工具 `novaflow_account` 支持 `state`、`refresh`、`cancel`、`signout`、`configure_models`、`retry_plugins`。`state`返回不含密钥的账户、原生配置、安装状态及分发摘要；`configure_models`是显式配置修改；`retry_plugins`只请求用户确认。`start`与`confirm_plugins`仅对交互HTTP开放，详见[开发手册](docs/DEVELOPMENT.md#4-本机接口与调用权限)。
