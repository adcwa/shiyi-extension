# 点译 · 连接本机 Codex

Chrome / Edge · v0.12.0 · 本机助手支持 macOS / Linux

[返回产品介绍](../src/intro.html)

点译通过官方 Codex app-server 调用本机已经登录的 Codex CLI。浏览器不导入 `auth.json`，不保存 OAuth 令牌，也不把登录凭据转成 API Key。翻译与总结分别添加「本机 Codex」连接，可各自设为默认或备用。

## 1. 准备本机登录

按 [Codex CLI 官方安装说明](https://learn.chatgpt.com/docs/cli)安装 CLI，并在终端运行：

```sh
codex login
```

沿用你已有的正常登录即可，不需要把令牌提供给点译。官方支持 ChatGPT 登录和 API Key 登录，两种方式的额度、权限和数据政策不同，见[官方认证说明](https://learn.chatgpt.com/docs/auth?surface=cli)。ChatGPT 登录消耗对应 Codex 账户额度，不等同于普通 API Key 按量计费，也不表示免费或无限使用。

本次在 macOS、Codex CLI 0.153.4 上，以既有 ChatGPT 登录真实完成短词翻译和增量输出。可用型号以「检测本机登录」返回的列表和你的账户权限为准；`auto` 沿用本机 Codex 默认型号，可能不是轻量型号。日常翻译可主动选择账户可用的轻量型号。

## 2. 安装一次本机助手

浏览器插件不能直接启动本机 CLI，需要用浏览器原生消息机制连接一个本机助手。助手随点译安装包提供，不监听 HTTP / WebSocket 端口，不作为开机服务运行。

1. 需要 Python 3.10 或更新版本，以及已安装的 Codex CLI。
2. 在点译「模型连接」或「总结设置」选择「本机 Codex」，点击「复制安装命令」。命令中包含当前扩展的准确 ID。
3. 在已解压扩展目录的 `native-host` 文件夹打开终端，粘贴并运行该命令，例如：

```sh
python3 install.py --extension-id 这里替换为插件显示的32位扩展ID
```

安装器默认给 Chrome 和 Edge 注册本机助手。只使用其中一个浏览器时，可以在命令后增加 `--browser chrome` 或 `--browser edge`。如果系统找不到 CLI，可增加 `--codex-path` 并填写实际的 CLI 路径。

安装器将本机助手放在 `~/.local/share/dianyi-codex/`，在当前用户的浏览器 NativeMessagingHosts 目录注册 `com.dianyi.codex`。来源白名单只包含你提供的明确扩展 ID，不使用通配符；重复安装会保留已明确授权的其他安装 ID。安装器不读取、复制或修改 Codex 的登录文件，不更改你的全局 Codex 配置。

更换扩展安装目录或浏览器可能改变扩展 ID。如果提示来源未授权，请使用新页面提供的命令重新安装。当前不提供 Windows 本机助手；Windows 上仍可正常使用插件的 API Key 连接。

## 3. 检测、选择模型并保存

1. 点击「检测本机登录」。检测不发送网页或翻译请求，只显示是否已登录和可用型号，不显示邮箱、令牌或其他账户资料。
2. 模型可填 `auto`，或从检测返回的可用型号中选择。填写容易区分的连接名称。
3. 选择是否设为默认，再点击「连接并保存」。会发送固定的短测试文字并使用账户额度，成功后保存连接。

以后正常使用原有划词、整页翻译和总结入口。总结侧栏仍只显示结果，不提供模型或翻译设置。Key 连接和 Codex 连接可以作为彼此的备用；资料可能交由勾选的备用服务处理，按相应账户规则使用额度。

## 仅处理文字的边界

本机助手仅允许检测与文本生成，不接受网页传入的命令、可执行路径、文件路径、任意 JSON-RPC 方法或认证数据。每次任务使用独立临时目录和内存会话，采用只读权限、关闭命令及扩展工具，显式停用继承的 MCP 服务；无法施加这些限制时拒绝生成。发现工具调用也会停止。限制只作用于点译启动的任务，不修改你正常使用 Codex 时的功能。

认证、模型服务连接和组织策略继续由本机 Codex 处理。模型输出不代表对事实的核验。点击停止或取消任务会断开本机消息通道，终止这次生成及其子进程；不会退出你的 Codex 账号。点译「清除 Key」只清除浏览器中保存的 API Key，不会注销 Codex。

## 连接失败时

| 提示 | 处理方式 |
| --- | --- |
| 未连接本机助手 | 核对是否在 `native-host` 文件夹运行过安装命令，是否允许插件连接本机应用 |
| 当前扩展 ID 未被允许 | 从当前插件页面重新复制安装命令并运行 |
| 尚未登录或登录已过期 | 在本机运行 `codex login`，完成后再次检测；不要复制认证令牌 |
| 型号不可用或额度不足 | 检查账户权限，尝试 `auto` 或检测返回的其他型号，或改用已保存的 API 备用连接 |
| 无法应用仅文本限制 | 更新 Codex CLI，或使用 API Key 连接；助手不会放宽限制继续运行 |

协议依据：[Codex app-server](https://learn.chatgpt.com/docs/app-server)、[Chrome 原生消息](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[Edge 原生消息](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)。本机助手实际调用回执和浏览器 UI 验收属于不同范围；当前未宣称已在原生 Edge 或 Windows 完成验收。
