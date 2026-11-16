# 项目与开发文档入口

本项目为 `@local/novaflow-dsh-plugin`，当前实现2.5.0，兼容DSH 0.2.2-rc.2与0.2.2-rc.3。提供NovaFlow设备授权、官方原生模型配置、本机鉴权桥、内置媒体MCP和用户确认后的推荐插件安装。

2.5.0按家族选择协议：Claude系列用Anthropic Messages，其他文本模型用OpenAI Responses。保留历史source标识，混合source确定性拆分，名称、容量、删除及overrides随家族保留。`migrate_protocols`只迁旧协议，可离线保存并保留已有图片／思考设置语义，不发布缓存桥权限；`configure_models`显式重新启用图片和协议原生思考档位。Claude档位基于官方metadata，未知型号保守关闭思考。默认模型自动迁移，已有会话引用被拆走模型时需重选。

- [文档索引](docs/README.md)：按任务阅读及文档维护约定。
- [开发手册](docs/DEVELOPMENT.md)：源码地图、配置、HTTP／工具权限、凭据与生命周期。
- [测试与发布](docs/RELEASE.md)：开发环境、验证、打包、实际资源核验和回退。
- [故障排查](docs/TROUBLESHOOTING.md)：常见问题和安全诊断路径。
- [使用说明](README.md)：当前产品行为。
- [验证记录](VERIFICATION.md)：已执行证据与验收边界。

旧1.0原型说明已撤回；平台侧归档的旧DSH桌面客户端也不是本插件。不要将其接口、安装方法或验收结论直接移用。
