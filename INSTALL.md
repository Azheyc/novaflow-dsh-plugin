# 安装说明

适用：插件2.6.0、DSH 0.2.2-rc.2／0.2.2-rc.3。安装、升级和停用步骤统一维护在[安装与快速开始](docs/GETTING_STARTED.md#安装升级与停用)。

通过DSH官方插件管理器安装，不手工修改profile或用shell npm安装到profile。推荐插件必须登录后由用户在弹窗确认，才使用官方安装器和npmmirror执行。完整行为见[使用说明](README.md)。

开发者本地链接、打包、实际加载版本核验和回退见[测试与发布](docs/RELEASE.md)。遇到Windows运行时缺失或预设覆盖，见[故障排查](docs/TROUBLESHOOTING.md)。

2.6.0保留rc.2／rc.3兼容。账户页新增New API既有 `plugin/usage` 设备余额：个人／公司共享钱包与成员限额分开显示，使用当前设备access，无需Cookie、PAT、后台模型Key或后端改造。读取失败不影响模型登录；当前AUTH_REQUIRED，实际金额需用户重新授权后验收。升级会按家族一次迁移旧受管协议：Claude用Messages，其他文本模型用Responses；需要仅迁移旧协议时使用 `migrate_protocols`，可离线保存配置且保留图片／思考设置语义。`configure_models`会显式重新启用这些能力。混合source拆分后，已有会话引用被拆走模型时需重选，默认选择自动迁移。详情见[安装与快速开始](docs/GETTING_STARTED.md)。

旧1.0原型的手动profile安装方法与生产就绪声明已撤回，不适用于当前版本。
