# 诊断入口

当前问题分类、错误码与处理步骤统一维护在[故障排查](docs/TROUBLESHOOTING.md)。

优先只读查询 `novaflow_account` 的 `state`，核对连接、错误码、原生提供商、MCP、推荐插件条目及分发版本。旧弹窗问题必须检查实际提供的Client资源；只看Host或磁盘版本不够。诊断资料不复制令牌、Cookie或完整回调查询。

此前逐版问题及真实验收范围见[验证记录](VERIFICATION.md)，测试与实际页面资源核验见[测试与发布](docs/RELEASE.md)。旧1.0原型诊断已撤回，不适用于当前实现。
