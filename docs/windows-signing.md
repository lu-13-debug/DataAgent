# Windows 安装包签名与校验

DataAgent 当前构建配置 `signExecutable: false`，安装包未进行 Authenticode 代码签名。Windows SmartScreen 可能提示未知发布者；不要将未签名版本描述成已验证发布者。发布时应在下载页提供安装包 SHA256 与计算方法：在 PowerShell 中运行 `Get-FileHash -Algorithm SHA256 -LiteralPath "安装包完整路径"`，将结果与发布页提供的哈希比较。哈希只能检查文件与公布值是否一致；若文件与哈希来自同一被攻击的渠道，它不能独立证明发布者身份。

微软 Artifact Signing 官方公布 Basic 计划为每月 9.99 美元、包含 5000 次签名（以实际账单及地区价格为准）。其公开信任个人身份验证目前要求开发者位于美国或加拿大；组织的地区要求另见官方清单。中国大陆主体不应假设一定可申请，应按实际身份向微软或其他证书机构确认资格、报价与验证材料。私人信任证书与公开信任证书用途不同。未申请证书，也未使用任何证书签名。

资料核对日期：2026-10-27。参考：[微软 Artifact Signing 介绍与价格](https://azure.microsoft.com/en-ca/products/artifact-signing)、[微软身份和地区要求](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)、[Electron 代码签名说明](https://www.electronjs.org/docs/latest/tutorial/code-signing)。

首版更新流程：从固定官方 Release 检查版本并验证 SHA256，用户自行在文件管理器中启动安装包。应用不会自动运行安装程序；同一 Windows 账号下的其他程序仍有可能在校验后替换文件。
