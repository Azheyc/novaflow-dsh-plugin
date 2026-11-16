# 故障排查

适用：插件 2.5.0，DSH 0.2.2-rc.2／0.2.2-rc.3。先记录插件版本、DSH 版本、操作系统、错误码和脱敏状态；定位源码见[开发手册](DEVELOPMENT.md)，实际分发核验见[测试与发布](RELEASE.md)。

## 优先检查的状态

只读调用 `novaflow_account` 的 `state`。检查结果中的 `connected`、`error`、`nativeProviders`、`media.mcp`、`pluginSetup`、`delivery`。状态读取不会安装插件，也不会调用付费模型。

诊断时不要复制 Credentials 原始记录、Authorization header、Cookie、授权码或完整回调查询。允许记录凭据名称、公开包名、错误码、版本、安装 request ID 和脱敏摘要。

## 界面还是旧提示或旧版本

| 现象 | 检查与处理 |
|---|---|
| 点击后仍打开新会话或预填安装请求 | 自2.4.0起已移除该路径。比较 Host `delivery.version/installFlow` 与 `delivery.clientURL` 实际响应，确认正在看的 GUI 和客户端资源；仅升级磁盘包或刷新不能替代修复旧源码 |
| Host 新、界面旧 | 先看官方安装是否 applied，再核对模块图提供的 revision 和实际 Client；刷新既有 GUI，Inspect 检查 `shell.overlay` 的新弹窗 ID |
| 声称 HMR 但没有变化 | 核对同一 checkout 的 Web watcher 是否在运行；不启动另一服务器，不把静态文件正确当成现有页面已更新 |
| 页面注册成功但显示异常 | Slot active 只证明注册。另行检查浏览器点击、焦点和主题；没有截图或交互证据时保留“未做视觉验收” |

当前安装弹窗 ID 为 `novaflow-plugin-install-confirmation`，旧 ID `novaflow-plugin-recommendations` 不应继续占用。`delivery.clientURL` 或 revision 为空时，先检查模块图和 Client 是否已连接，不猜路径。

## 登录与授权

| 现象／错误 | 检查与处理 |
|---|---|
| `CALLBACK_UNAVAILABLE` | Web origin 必须是明确端口的 `http://127.0.0.1`。localhost、HTTPS、非回环地址不满足本插件约束 |
| 浏览器显示登录，DSH仍未连接 | 网页会话与设备授权独立。核对本次回调是否成功换码、创作身份读取是否成功；不要反复提交旧 code |
| `AUTH_REQUIRED` | 会话、账户、企业身份或后台权限可能变化。核对平台设备状态；若仍有旧凭据，先在账户与余额中退出，再发起登录，原生配置保留 |
| `SIGNOUT_REQUIRED` | 已连接或仍保存旧设备凭据，不能直接发起另一登录；先退出清理旧凭据，再重新登录 |
| `NETWORK_ERROR`／`PLATFORM_ERROR` | 分别检查网络和平台响应。不能仅凭网络失败断言用户授权被撤销 |
| `INVALID_RESPONSE` | 核对平台 `{code,data}` 包装、发行方、令牌格式、目录 schema 和期限，不放宽校验来消除报错 |
| 刷新结果未知／要求重新登录 | 已写刷新标记但未确认新令牌时，不重放旧 refresh。平台会因重放撤销设备；在账户与余额中先退出清除旧凭据，再重新登录，保留原生提供商和模型配置 |
| 取消后旧回调到达 | 当前代次应拒绝旧回调；重新从账户页发起，检查 attempt ID 和卸载／取消的晚到结果保护 |
| 退出提示远端撤销失败 | 本机清理与平台撤销分别判断。到平台“安全与访问”手动撤销当前设备，不要求删除后台专属模型 Key |

平台暂未提供设备余额接口。账户页链接平台查看余额，不显示余额不能通过填零或虚构 API 修复。

## 原生模型与请求

| 现象／错误 | 检查与处理 |
|---|---|
| `RUNTIME_UNSUPPORTED` | 核对当前 DSH 版本及随附官方库。Host 不一定有工具环境的 `DSH_INSTALL_DIR`；检查 resources／入口解析，不借用另一个全局 DSH |
| `MODEL_SETTINGS_UNAVAILABLE` | 核对官方 `llm-pi-ai` entry 是否存在；不要绕过官方配置另建不可编辑的运行时模型列表 |
| `MODEL_SETTINGS_WRITE_FAILED` | 检查 ConfigEditor／HMR 和官方配置错误，保留登录与原生配置，修复后刷新重试 |
| 思考档位或图片输入不可用 | 查看原生高级设置、实际adapter／SDK序列化及上游支持。Claude用官方metadata，off为null；不直接套用Responses的none/xhigh，仅按官方metadata允许值规范（部分Claude支持xhigh），未知Claude思考为false，不假定adaptive。客户端选项不是服务端能力保证 |
| 想重新启用图片和思考档位 | `configure_models`显式重设家族协议，并重新启用text/image和协议原生档位；普通刷新不会执行相同覆盖 |
| 只想修正旧统一Responses协议 | 使用HTTP或Agent动作 `migrate_protocols`，仅一次家族迁移，保留已有图片／思考设置语义；跨协议值按目标协议转换，清理不适用compat |
| 未登录或AUTH_REQUIRED时需要迁移 | 2.5.0可离线编辑已保存受管配置，无需为迁移重新授权；离线不发布cached桥权限，成功只证明配置已保存，不能证明账户或模型请求可用 |
| Claude仍显示Responses或名称带vendor前缀 | 先核对实际delivery为2.5.0与迁移策略。Claude识别不区分大小写，支持原始ID开头及常见vendor前缀／冒号／点；已应用策略后的手工协议编辑会保留，需重设时显式configure_models |
| 升级后出现家族child提供商 | 混合source按家族确定性拆分，纯家族保留source原地更新。核对名称、容量、删除和overrides按家族保留，不按显示名合并路由 |
| 旧会话模型找不到，默认模型却正常 | 默认同模型会迁至新提供商；已有会话若引用被拆走模型，需在该会话重新选择 |
| 手动删除后未被目录同步加回 | 这是保留用户删除的行为。使用官方获取模型／手动添加；删除提供商后可重新登录配置 |
| 模型同名但分组不同 | 通过提供商和授权 group 区分，不能合并计费路由或给显示名自动加后缀 |
| Anthropic 请求被桥拒绝 | 排查官方 SDK 的 `?beta=true` 与允许的协议 header；不放开任意查询和任意转发目标 |
| 刷新后自定义地址或密钥没被重写 | 归属保护生效。用户改作其他连接后插件停止管理，不清除替换密钥 |

模型发现由本机桥按授权目录提供；不能推定平台允许设备凭据调用普通 `/v1/models` 或任意管理 API。

## 推荐插件确认与安装

`confirmationRequired=true` 表示需要提醒用户，`confirmationId` 用于本次交互确认。`running=false` 不等于五个插件都安装失败或都已完成；结合条目状态判断。

| 状态／错误 | 含义与处理 |
|---|---|
| `pending`／`checking`／`installing` | 待处理、检查中或已提交；不要因短暂等待重复提交 |
| `installed`／`already-installed` | 已安装成功／库存已存在；后者不代表本次发生升级 |
| `present-disabled` | 已安装但用户禁用；保持选择，不强制启用 |
| `restart-required` | 由用户自行重启后重新核对激活状态，不自动关闭应用 |
| `overridden` | 有效预设或上层配置覆盖了变更；检查来源，不能写成 applied |
| `USER_CONFIRMATION_REQUIRED` | 来自非交互调用；回到账户页由用户确认 |
| `INSTALL_CONFIRMATION_EXPIRED` | 旧 ID 已失效或已使用；刷新状态并重新打开弹窗，不重放 |
| `INSTALL_ALREADY_RUNNING` | 等待现有队列，不再创建并行安装 |
| `build-approval-required` | 在官方插件管理中让用户处理明确的构建脚本审批；本插件不代批 |
| `incompatible-version`／`unsupported-platform` | 核对 DSH、插件和平台要求；不自动创建豁免 |
| `registry-unavailable`／`network`／`timeout` | 核对镜像和网络，区分运行时缺失。官方回退由 DSH 管理，不改全局 registry |
| `permission`／`disk-full`／文件占用 | 处理具体磁盘或文件问题，不统一归咎 pnpm |
| `activation-failed` | 包已存在但 entry 激活失败，查该插件的 Host 错误；不能仅凭 inventory 报成功 |
| `bootstrap-failed`／`installation-error` | 查看脱敏条目及官方管理器结果，修复后重新打开确认弹窗重试 |

关闭或“稍后再说”不安装；安装开始后关闭不取消；Agent 的 `retry_plugins` 只请求确认。重载保留旧 request ID，但不会自动恢复运行；新的用户确认后才查询／继续。五个包固定，不接受任意包名或安装地址。

### Windows 缺少包管理器

官方 Desktop 内置 pnpm。预检检查 resources 中 `runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs`，再用自带执行程序启动 `--version`。路径含空格通过参数数组处理。

- `pnpm-missing`：内置入口缺失或启动程序不存在。
- `pnpm-runtime-unavailable`：启动失败或输出不是可识别版本。

修复或重新安装完整官方 DSH 桌面版，重启后由用户确认重试。镜像解决下载源，不能补齐缺失运行时。不要自动安装全局 Node／pnpm、修改 PATH 或要求管理员权限。CLI、自制便携版按其发行方式提供运行环境；本项目没有 Windows 实机通过结论。

## 内置 magpie-image MCP

| 现象／错误 | 检查与处理 |
|---|---|
| `serverName "magpie-image" is already in use` | 同名旧客户端仍有效。检查本包停用旧 `magpie-mcp-magpie-image` 的补丁是否被 Agent 预设覆盖；官方结果 overridden 时先解决有效配置来源，不改名掩盖问题 |
| 仍提示去 Magpie 选择模型 | 核对实际可见 Tool schema 与 MCP instructions 是否来自本插件；旧工具说明不能证明新服务已连接 |
| 图片模型没权限 | 默认是原始 ID `gpt-image-2.6`，失败时不静默切换模型 |
| `VIDEO_MODEL_REQUIRED` | 列出视频模型并取得用户明确选择，再提交；不使用旧 profile 或首个结果 |
| 同名模型有多个 group | 请用户明确路由，不自动决定计费组 |
| 返回运行中 ID | 使用 `generation_result` 查询原 ID，不再次调用生成 |
| `unknown` 或重启后结果未知 | 可能已计费；先核对平台历史和已有产物，不自动重提 |
| 输出或参考图找不到 | 相对路径按 DSH 默认工作目录解析；检查默认目录而非另一个会话 cwd |
| 输出冲突／路径被拒 | 使用默认工作目录内的新输出路径；不覆盖、不越界、不绕过符号链接限制 |

2026-11-13 的此前运行记录观察到有效 Agent 预设覆盖旧 MCP 停用设置，产生同名冲突；该问题尚无本轮修复证据。历史2.2工具可用记录不能代替当前服务健康状态。排查只读状态和模型目录即可，未经用户请求不要通过生成图片、视频或真实对话制造计费验证。
