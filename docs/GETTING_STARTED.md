# 安装与快速开始

适用：NovaFlow 插件2.5.0、DSH 0.2.2-rc.2／0.2.2-rc.3。功能与限制见[使用说明](../README.md)，开发与分发流程见[测试与发布](RELEASE.md)。

## 安装、升级与停用

1. 准备匹配当前 DSH 版本的插件 tarball；当前包名为 `@local/novaflow-dsh-plugin`。其他机器需要分发包，维护者本地目录链接不能作为跨机器交付文件。
2. 通过 DSH 官方插件管理能力安装该包。Agent 侧使用 `plugin_manager` 时，先列出 bundle 取得准确标识，再按官方安装参数操作；不要用 shell npm 写入 profile 或手工编辑 profile 清单。
3. 检查官方返回的应用状态：applied 表示已应用；restart-required 需用户重启；overridden 需处理有效预设覆盖。兼容性或安装脚本待审批由官方插件管理处理，本插件不代批。
4. 刷新既有 DSH GUI，检查“账户与余额”中的 NovaFlow 入口。开发交付时还需核对真实 Client revision 和 Slot，详见测试与发布。

升级前保留已验证旧包；升级后核对登录、原生模型和分发状态。2.5.0一次迁移旧受管协议：Claude系列采用Anthropic Messages，其他文本模型采用OpenAI Responses；纯家族source原地更新，混合source按家族拆分，保留原生名称、容量、删除和overrides。默认同模型自动转到新提供商；已有会话引用被拆走模型时需重新选择。

仅迁移旧协议可调用 `novaflow_account` 的 `migrate_protocols`：可离线处理已保存受管配置，保留图片／思考设置语义，离线不发布缓存桥权限；它会标记能力初始化已处理，避免下次联网刷新重置设置。`configure_models`则显式重新启用图片输入和协议原生档位。迁移后普通刷新保留原生编辑。账户AUTH_REQUIRED仍需按故障排查恢复登录，配置迁移不代表授权恢复。

停用整个bundle可恢复官方账户入口，但已安装的推荐插件保留；需要撤销设备时先在账户页退出并检查结果，不把停用当成撤销凭据。

## 首次使用

1. 打开“账户与余额”，点击“登录 NovaFlow”。
2. 在平台浏览器页面登录并由本人确认设备授权，返回 DSH 等待连接完成。
3. 登录后推荐插件弹窗列出固定五个包：`dshmarket`、`dsh-ops`、`dsh-free-search`、`@michengai/dsh-archive-manager`、`dsh-rewind-plugin`。
4. 希望安装时点击“确认并开始安装”，查看逐项状态；关闭或“稍后再说”不会安装。以后可从账户页重新打开。已有项跳过、禁用项保持禁用，不自动升级或重启。
5. 到官方“设置 → 模型”查看 NovaFlow 提供商，使用原生获取、添加、编辑、删除与保存功能。模型名不追加分组后缀。
6. 在模型高级设置检查思考档位，在会话底部模型选择器选择实际模型与深度。Claude按官方metadata，off为null，未知Claude保守关闭思考，不假定adaptive；其他文本模型用Responses原生档位。配置选项不能保证上游支持对应能力。

账户页负责授权与同步，模型编辑在官方模型页进行。余额在平台查看；当前设备接口不提供余额读数。

## 图片与视频

图片生成工具省略 model 时使用 NovaFlow 的 `gpt-image-2.6`，无需打开 Magpie 设置。视频需用户明确指定模型；未指定时先列出可用模型再选择。同名模型跨组时还需明确 group。

生成返回作业 ID 后继续查询原作业，不重复提交。默认产物在 DSH 默认工作目录的 `generated-images/` 或 `generated-videos/`。结果未知可能已计费，先检查平台历史。

内置 MCP 使用名称 `magpie-image`。如果与旧客户端冲突，或仍显示旧 Magpie 选模型说明，按[故障排查](TROUBLESHOOTING.md)核对有效预设及实际工具来源。

## 退出与故障处理

账户页退出会清本机登录并尝试撤销当前设备，保留原生提供商和模型配置。撤销失败时按提示到平台“安全与访问”处理。退出不等于退出浏览器，也不撤销其他设备。

Windows 提示缺包管理器时优先修复完整官方 Desktop 自带运行时；不要先要求用户安装全局 pnpm。其他故障从[故障排查](TROUBLESHOOTING.md)中的状态、错误码和当前分发版本开始定位。
