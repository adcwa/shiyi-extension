# 本地英语读音数据

本目录只包含 IPA Dict 的美式英语词典，源自 CMUdict、cmudict-ipa 和 syllabify，适用于英文单词和词典收录的词形。共 125,912 个词条，保留全部列出的读音和重音符号。按首字母拆成 26 份 JSON，扩展后台按需读取；不联网查询词典，不向词典网站发送原词或网页。

- 来源：[IPA Dict](https://github.com/open-dict-data/ipa-dict)，固定版本 `972cd67dd5f96bc5660e28070cde26e3928abcd7`，文件 `data/en_US.txt`。
- 原始文件 SHA-256：`2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67`。
- 数据源声明及许可证：[IPA Dict 说明](https://github.com/open-dict-data/ipa-dict#credits)、本目录 `LICENSES.txt`。这里只分发美式数据，未引入其他语言或英式数据。
- 本地修改：转换成 JSON；仅保留插件当前支持的拉丁字母词条、点号、撇号及连字符；修正 engineer 及 engineers、engineered、engineering 开头的重复主重音，其他音素保持原样。[重音核对](https://dictionary.cambridge.org/pronunciation/english/engineer)。

主动更新数据时，在项目根目录运行 `node scripts/build-pronunciation.mjs`；也可传入已经下载的原始文件路径，脚本会校验同一个 SHA-256。正常打包直接使用已提交的数据，不下载或远程执行任何资源。

读取顺序：已有本页结果 → 内置美式词典 → 已配置的总结模型。未收录且未配置总结模型时，仅显示本地未收录说明并保留系统试听；不生成猜测音标，不将逐词读音拼成句子音标。词典的多个读音不自动按语境消歧。英式、美式试听分别使用系统已有的对应语音；词典文件只提供文字音标，没有录音。
