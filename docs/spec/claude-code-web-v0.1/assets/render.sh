#!/usr/bin/env bash
# 把 .mmd 文件批量渲染成 SVG，使用 mermaid.ink 在线服务（pako 压缩 + 标准 UA）
# 用法：bash render.sh [-f]      # -f: 强制覆盖已有 svg
# 修改图后重跑此脚本即可重新生成 SVG。

set -euo pipefail
cd "$(dirname "$0")"

export FORCE=0
[[ "${1:-}" == "-f" ]] && export FORCE=1

python3 << 'PYEOF'
import base64, json, zlib, urllib.request, os, sys

force = os.environ.get('FORCE', '0') == '1'

def render(mmd, svg):
    with open(mmd) as f:
        code = f.read()
    payload = json.dumps({"code": code, "mermaid": {"theme": "default"}}, separators=(',', ':')).encode()
    compressed = zlib.compress(payload, 9)
    enc = base64.urlsafe_b64encode(compressed).decode().rstrip('=')
    url = f'https://mermaid.ink/svg/pako:{enc}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        r = urllib.request.urlopen(req, timeout=30)
        data = r.read()
        with open(svg, 'wb') as f:
            f.write(data)
        print(f'  ok {svg} ({len(data)} bytes)')
        return True
    except urllib.error.HTTPError as e:
        body = e.read()[:300].decode(errors='replace')
        print(f'  FAIL {mmd}: HTTP {e.code} {body}', file=sys.stderr)
        return False

ok = 0
fail = 0
for mmd in sorted(os.listdir('.')):
    if not mmd.endswith('.mmd'):
        continue
    svg = mmd.replace('.mmd', '.svg')
    if os.path.exists(svg) and not force:
        if os.path.getmtime(mmd) <= os.path.getmtime(svg):
            print(f'  skip {svg} (up-to-date)')
            continue
    print(f'render {mmd}')
    if render(mmd, svg):
        ok += 1
    else:
        fail += 1

print(f'\ndone: {ok} ok, {fail} fail')
sys.exit(0 if fail == 0 else 1)
PYEOF
