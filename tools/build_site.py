#!/usr/bin/env python3
"""Build the standalone website (GitHub Pages) into docs/.

index.html is written as artifact page content: claude.ai adds the HTML document
wrapper when it publishes. This script adds that wrapper itself, moves the title
and font links into <head>, and copies the scripts and sample session next to it.

Usage: python tools/build_site.py
"""
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs'
COPY = ['engine.js', 'odds.js', 'sample-session.txt']

HEAD_RESET = (
    ':root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);'
    'padding-bottom:env(safe-area-inset-bottom,0px)}'
    'body{margin:0;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}'
    'img{max-width:100%}[hidden]{display:none!important}'
)


def main():
    page = (ROOT / 'index.html').read_text(encoding='utf-8')
    head_bits = []
    title = re.search(r'<title>.*?</title>', page, re.S)
    if title:
        head_bits.append(title.group(0))
        page = page.replace(title.group(0), '', 1)
    page = re.sub(r'<meta name="claude:[^"]*"[^>]*>\s*', '', page)
    for link in re.findall(r'<link [^>]*>', page[:4000]):
        head_bits.append(link)
        page = page.replace(link, '', 1)
    doc = (
        '<!doctype html>\n<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="description" content="Opponent profiles from NL Hold\'em hand histories, plus an odds lab: equity against ranges, pot odds, EV and a decision replay.">\n'
        + '\n'.join(head_bits) + '\n'
        f'<style>{HEAD_RESET}</style>\n'
        '</head>\n<body>\n' + page.strip() + '\n</body>\n</html>\n'
    )
    OUT.mkdir(exist_ok=True)
    (OUT / 'index.html').write_text(doc, encoding='utf-8', newline='\n')
    for name in COPY:
        shutil.copyfile(ROOT / name, OUT / name)
    (OUT / '.nojekyll').write_text('', encoding='utf-8')
    print(f'Built {OUT} ({len(doc):,} bytes of HTML plus {", ".join(COPY)})')


if __name__ == '__main__':
    main()
