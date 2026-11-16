# 安装说明

适用：插件2.5.0、DSH 0.2.2-rc.2／0.2.2-rc.3。安装、升级和停用步骤统一维护在[安装与快速开始](docs/GETTING_STARTED.md#安装升级与停用)。

通过DSH官方插件管理器安装，不手工修改profile或用shell npm安装到profile。推荐插件必须登录后由用户在弹窗确认，才使用官方安装器和npmmirror执行。完整行为见[使用说明](README.md)。

开发者本地链接、打包、实际加载版本核验和回退见[测试与发布](docs/RELEASE.md)。遇到Windows运行时缺失或预设覆盖，见[故障排查](docs/TROUBLESHOOTING.md)。

2.5.0保留rc.2／rc.3兼容。升级会按家族一次迁移旧受管协议：Claude用Messages，其他文本模型用Responses；需要仅迁移旧协议时使用 `migrate_protocols`，可离线保存配置且保留图片／思考设置语义。`configure_models`会显式重新启用这些能力。混合source拆分后，已有会话引用被拆走模型时需重选，默认选择自动迁移。详情见[安装与快速开始](docs/GETTING_STARTED.md)。

旧1.0原型的手动profile安装方法与生产就绪声明已撤回，不适用于当前版本。
