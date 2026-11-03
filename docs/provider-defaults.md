# 点译 v0.9.1 · 翻译模型推荐与厂家预设依据

千问 MT 补充核对日期：2026-11-03；其余预设沿用 2026-11-02 的核对记录。推荐面向划词释义、日常段落和网页翻译，考虑费用、非思考模式与现有段落片段协议的兼容性。具体译文质量与账户访问范围由所选模型和服务决定。

## 推荐清单

| 厂家 | 可选模型 | 标记 | 使用建议与官方依据 |
| --- | --- | --- | --- |
| DeepSeek | deepseek-flash | 推荐 · 日常翻译，默认选中 | 常规划词与网页翻译优先。官方价目表中 Flash 的输入、输出价格均低于 Pro，支持 JSON 输出；翻译关闭思考。[模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)、[思考开关](https://api-docs.deepseek.com/guides/thinking_mode/) |
| DeepSeek | deepseek-v4-pro | 复杂文本备选 | 保留给已有使用习惯或有特殊需求的用户，日常优先 Flash。厂商可能调整型号路由与价格，以当前官方说明为准。 |
| 通义千问 | qwen-mt-flash | 推荐 · 日常翻译，默认选中 | 专用翻译模型，使用单条 user 消息和 translation_options。插件已独立适配纯文本响应、片段映射与回退。[模型能力](https://help.aliyun.com/zh/model-studio/qwen-mt-flash)、[翻译调用说明](https://help.aliyun.com/zh/model-studio/machine-translation) |
| 通义千问 | qwen-flash | 通用模型备选 | 保留原通用轻量型号，适合需要通用释义或已有使用习惯的用户，不再作为默认。原结构化协议仍保留。[模型能力](https://help.aliyun.com/zh/model-studio/qwen-flash) |
| 通义千问 | qwen-plus | 复杂文本备选 | 术语密集或复杂长句可按需尝试，费用高于 Flash。[模型说明](https://help.aliyun.com/zh/model-studio/qwen-plus) |
| OpenAI | gpt-6-luna | 推荐 · 日常翻译，默认选中 | 官方定位为高频、成本敏感任务，支持 Chat Completions；翻译使用 reasoning_effort: none。[模型说明](https://developers.openai.com/api/docs/models/gpt-6-luna)、[型号选型](https://developers.openai.com/api/docs/models) |

每家只有一个日常推荐项，不默认选择更大型的复杂推理型号。推荐是针对点译使用场景的选型判断；界面不预估未发生的调用费用，不自动消耗额度做模型对比。

## 界面与已有配置

- 主配置区直接显示当前模型、推荐／按需选择／自选模型标记及简短理由，填 Key 的流程保持简洁。
- 高级设置的原生模型下拉框把推荐项排在前面，在型号后写明“推荐 · 日常翻译”；通用 Flash 标明“通用模型备选”，更大型号标明“复杂文本备选”。
- 可选择“其他模型（手动填写）”；此前保存的厂家内自选型号仍原样选中，不会改写为推荐项。
- 已选非推荐型号时可点击“改用推荐模型”。此操作只修改当前草稿，保留已输入的同厂家 Key，不发送请求；点击连接按钮后才测试和保存。
- 提交给服务的 model 仍是原始型号标识，不含“推荐”等说明文字。通用推荐项沿用关闭深度思考的翻译参数，MT 使用专用参数；任意自选型号的能力与参数以服务商为准。
- 切换厂家或地域仍会清空未保存的 Key，不混用不同来源的凭据。修改模型不覆盖词库中的旧释义。

## 千问专用翻译型号

qwen-mt-flash 使用单条原文 user 消息与 translation_options，不支持沿用通用模型的 system／JSON 输出协议。点译使用专用调用：目标语言映射为服务所需语种名，预设风格使用英文领域提示，自定义提示词与可选语境使用单 user 自定义提示模式，不发送 enable_thinking。响应按纯文本处理。

网页片段以随机边界标记组合，术语参数保护标记；每组最多 32 个不同片段、约 4000 原文字符。严格检查所有边界与 ID，再重建原段落；不猜测缺失映射。若模型未保留边界，才按原始片段独立翻译并安全绑定；网络、鉴权、取消和限流不触发批量回退请求。所有 MT 请求共享两个并发上限，保留已有缓存及重新翻译行为。上述协议专项使用本地 HTTP 验证。v0.9.1 另经用户授权做了 3 次短词连接诊断，均被真实服务以免费额度原因拒绝，未取得成功译文。

Key 输入框保持空白，旁边的「获取 Key」链接指向[官方获取说明](https://help.aliyun.com/zh/model-studio/get-api-key)。已有自选型号和密钥保存偏好不自动改写。[官方 MT 协议](https://help.aliyun.com/zh/model-studio/qwen-mt-api)

## 官方端点与地域

| 厂家／地域 | 请求地址 |
| --- | --- |
| DeepSeek | https://api.deepseek.com/chat/completions |
| 千问（北京） | https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions |
| 千问（新加坡） | https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions |
| OpenAI | https://api.openai.com/v1/chat/completions |

常用厂家的端点、默认型号与鉴权由预设配置。千问其他地域、代理或企业网关使用自定义连接；各地域使用对应 Key。共享 DashScope 域名仍可用于只填写 Key 的流程；专属 Workspace 地址可用自定义连接，参见[官方地址说明](https://docs.bailian.console.aliyun.com/en/model-studio/base-url)。官方说明见[千问兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)和[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

## 千问连接被拒绝时

v0.9.1 保留 HTTP 状态、受控服务错误码与请求编号。免费额度、Key 模型范围、工作空间、未开通和账户欠费使用不同提示；不回显原始服务响应、输入或密钥。

真实诊断中，专属域名返回 insufficient_quota，公共域名返回 AllocationQuota.FreeTierOnly，两者均为免费额度耗尽。Base URL 换域名无法解除额度限制。在百炼电脑端的“免费额度”页面找到 qwen-mt-flash，检查剩余额度与“免费额度用完即停”，并检查账户余额；只有用户决定继续付费使用时才调整。见[实测及处理步骤](qwen-access-diagnosis.md)与[官方额度说明](https://help.aliyun.com/zh/model-studio/new-free-quota)。

## 验证范围

自动验证检查推荐标记、模型原始 id、候选选择、手动型号保存／重载、Key 保留、关闭思考参数与 375–1440px 布局。自动回归使用隔离浏览器和本地兼容接口，不使用真实密钥；前述授权诊断只核实拒绝原因，没有进行各厂家翻译质量或收费评测。
