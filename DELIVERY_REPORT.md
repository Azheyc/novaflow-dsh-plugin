# 交付记录入口

当前实现版本为2.5.0，兼容DSH 0.2.2-rc.2与0.2.2-rc.3。Claude系列改用Anthropic Messages，其他文本模型使用OpenAI Responses；一次家族迁移保留source标识与原生模型设置，混合source按家族拆分。`migrate_protocols`只迁旧协议，保留图片／思考设置语义，可离线保存且不发布缓存桥权限；`configure_models`显式重新启用能力。默认选择自动迁移，已有会话引用被拆走模型时需重选。

2026-11-16，最终完整190项测试全部通过；官方disable／enable返回applied、无warnings。2.5.0的 `migrate_protocols` 完成1个提供商、7个本地Claude模型的离线迁移，`capabilitiesReset=false`，均采用anthropic-messages并保留7个图片输入开关；实际Client资源revision为 `c51462e91d9b`，GET200、36380bytes，含中英新协议说明。

账户仍为 `connected=false`、`hasCredential=true`、`error=AUTH_REQUIRED`，用户需先退出旧凭据再重新登录后获取目录／调用，本轮未自动退出；MCP旧同名冲突仍在。未执行付费请求或视觉实机验收。

2026-11-16的2.4.1历史记录：完成rc.3兼容核查，169项测试通过，官方管理器应用成功，Host与关键Client Slot均已激活。以下文档整理和首次GitHub发布段落为2.4.0历史。各版本的应用、资源与测试证据维护在[验证记录](VERIFICATION.md)；后续交付步骤与必记信息见[测试与发布](docs/RELEASE.md)。

2026-11-13文档整理新增了[文档索引](docs/README.md)、[安装与快速开始](docs/GETTING_STARTED.md)、[开发手册](docs/DEVELOPMENT.md)、[测试与发布](docs/RELEASE.md)、[故障排查](docs/TROUBLESHOOTING.md)，并更新了根目录入口。此次仅文档变更，未改运行逻辑、安装、重载或重新打包；现有2.4.0 tarball不因此获得新增文档。

此前2.4.0发布记录包含167项完整测试通过；本次仅重新运行分发契约、包运行时和安装确认三组测试，11项通过。浏览器点击、截图、Windows实机和付费模型调用不属于本次验收。

随后GitHub首次发布在同一2.4.0运行逻辑基础上，补齐公开仓库元数据和下载入口，并重新生成包含最新文档的安装包。发布前完整167项测试和语法检查通过；源码仓库为 [Azheyc/novaflow-dsh-plugin](https://github.com/Azheyc/novaflow-dsh-plugin)，附件与SHA256校验见 [Releases](https://github.com/Azheyc/novaflow-dsh-plugin/releases)。前述“未重打包”仅指文档整理阶段，不能作为此后Release内容的描述。

旧1.0原型的生产就绪声明已撤回，不作为当前交付证据。
