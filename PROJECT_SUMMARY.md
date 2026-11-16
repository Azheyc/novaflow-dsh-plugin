# 项目与开发文档入口

本项目为 `@local/novaflow-dsh-plugin`，当前实现2.6.0，兼容DSH 0.2.2-rc.2与0.2.2-rc.3。提供NovaFlow设备授权、官方原生模型配置、本机鉴权桥、内置媒体MCP和用户确认后的推荐插件安装。

2.6.0新增账户页New API余额：以 `nfds_` 设备access调用平台既有 `GET /api/novaflow/v1/plugin/usage`，无需Cookie、PAT、后台模型Key或后端改造；标准dashboard billing不接受creator令牌且不适用企业钱包。展示个人／公司共享钱包的可用、总额、冻结和更新时间，成员限额另列，CNY金额不再次换算。支持HTTP／Agent `refresh_balance`，登录／账户刷新／默认10分钟后台后非阻塞更新，UI轮询只读Host。失败不影响模型登录，旧成功数据标旧、无数据不显示假0，退出／拒绝／换身份清理旧请求。当前AUTH_REQUIRED，真实在线余额待用户重新授权后验收；最终完整212项测试全部通过，两次官方应用均applied、无warnings；真实Client revision为 `f92ee7b36197`，GET200、42840bytes，未实际截图或点击。

沿用2.5.0家族协议策略：Claude系列用Anthropic Messages，其他文本模型用OpenAI Responses。保留历史source标识，混合source确定性拆分，名称、容量、删除及overrides随家族保留。`migrate_protocols`只迁旧协议，可离线保存并保留已有图片／思考设置语义，不发布缓存桥权限；`configure_models`显式重新启用图片和协议原生思考档位。Claude档位基于官方metadata，未知型号保守关闭思考。默认模型自动迁移，已有会话引用被拆走模型时需重选。

- [文档索引](docs/README.md)：按任务阅读及文档维护约定。
- [开发手册](docs/DEVELOPMENT.md)：源码地图、配置、HTTP／工具权限、凭据与生命周期。
- [测试与发布](docs/RELEASE.md)：开发环境、验证、打包、实际资源核验和回退。
- [故障排查](docs/TROUBLESHOOTING.md)：常见问题和安全诊断路径。
- [使用说明](README.md)：当前产品行为。
- [验证记录](VERIFICATION.md)：已执行证据与验收边界。

旧1.0原型说明已撤回；平台侧归档的旧DSH桌面客户端也不是本插件。不要将其接口、安装方法或验收结论直接移用。
