"""Render local Markdown documentation with the installed development renderer.

No JavaScript or remote fonts are added to the HTML; this tool is not shipped in
the extension. Run using the same development Python that provides markdown_it.
"""
from pathlib import Path
from markdown_it import MarkdownIt
import html, re, json

root = Path(__file__).resolve().parents[1]
version = json.loads((root/'package.json').read_text())['version']
theme = re.search(r'<style>(.*?)</style>', (root/'docs/user-guide.html').read_text(), re.S).group(1)
parser = MarkdownIt('commonmark', {'html': False}).enable('table')
documents = {
    'reading-trails-plan': ('需求与决策记录 / 阅读轨迹', '点译 · 阅读轨迹需求与决策记录'),
    'knowledge-guide': ('阅读知识 / 轨迹与周期回顾', f'点译 v{version} · 阅读轨迹与回顾'),
    'codex-setup': ('本机认证 / Codex 使用指引', '点译 · 连接本机 Codex'),
    'marketing-copy': ('点译 / 产品介绍文案与实拍素材', '点译 · 宣传文案与素材说明'),
    'user-guide': ('GET STARTED / 安装与使用', '点译 · 安装与使用指南'),
    'summary-guide': ('网页总结使用说明', f'点译 v{version} · 网页总结'),
    'architecture': ('IMPLEMENTATION / 实现说明', f'点译 v{version} · 实现说明'),
    'verification': ('VERIFICATION / 验收记录', f'点译 v{version} · 验收记录'),
    'block-reading': ('READING / 长文方案与问题定位', f'点译 v{version} · 批量阅读方案'),
    'compact-layout': ('COMPACT READING / 界面留白优化', f'点译 v{version} · 紧凑排版方案'),
    'provider-defaults': ('MODELS / 翻译模型推荐', f'点译 v{version} · 翻译模型推荐与厂家预设依据'),
    'annotation-stability': ('STABILITY / 重复词闪烁定位与修复', f'点译 v{version} · 重复词标记稳定性方案'),
    'inline-structure': ('INLINE STRUCTURE / 通用行内标签映射', f'点译 v{version} · 通用行内标签映射'),
    'bilingual-links-plan': ('LINKS / 双语链接定位与改造', '双语译文链接：定位与已实施方案'),
    'qwen-access-diagnosis': ('CONNECTION / 千问额度问题定位', f'点译 v{version} · 千问连接拒绝实测与处理'),
}
for name, (eyebrow, title) in documents.items():
    tokens = parser.parse((root/'docs'/f'{name}.md').read_text())
    navigation = []
    for index, token in enumerate(tokens):
        if token.type == 'heading_open' and token.tag == 'h2':
            identifier = f'section-{len(navigation)+1}'; token.attrSet('id', identifier)
            navigation.append(f'<a href="#{identifier}">{html.escape(tokens[index+1].content)}</a>')
        if token.children:
            for child in token.children:
                href = child.attrGet('href') if child.type == 'link_open' else None
                if href in {f'{document}.md' for document in documents}: child.attrSet('href', href[:-3]+'.html')
    body = parser.renderer.render(tokens, parser.options, {})
    body = body.replace('<table>', '<div class="table-scroll"><table>').replace('</table>', '</table></div>')
    document = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{theme}</style></head><body><header><div><span class="brand">点译</span> <small>点一下，读懂。 / v0.2.0</small></div><span class="source-label">CHROME / EDGE</span></header><div class="layout"><nav aria-label="文档目录"><small>CONTENTS / 目录</small>{''.join(navigation)}</nav><main><div class="eyebrow">{html.escape(eyebrow)}</div>{body}<footer class="doc-footer">点译 v0.2.0 · 自己的模型，按块阅读<br>文档提供 HTML 阅读版及 Markdown 可编辑版本。</footer></main></div></body></html>'''
    (root/'docs'/f'{name}.html').write_text(document.replace('v0.2.0 · 自己的模型', f'v{version} · 自己的模型').replace('点一下，读懂。 / v0.2.0', f'点一下，读懂。 / v{version}'))
    if name == 'codex-setup': (root/'src/codex-setup.html').write_text((root/'docs/codex-setup.html').read_text().replace('href="../src/intro.html"', 'href="intro.html"'))
    print(f'Rendered docs/{name}.html')
