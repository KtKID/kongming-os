// 统计条 opt-out 的两半（issue #172）。
//
// 上半：body:not([data-pocket-stats=X]) 停用 pocket 自己那套 28px 横滚条样式。
// 下半：那一行是**核心**渲染的（StatsPills 挂在 conversation.composer.dock），只停样式它
//       仍按核心样式占着同一条频带，于是接管者（皮肤页脚）还是和它叠印 —— 注释写着
//       "can legally reclaim this 28px band"，必须名副其实。
//       [data-mobile-nav="stats"] 是 pocket 自己写上去的标记（mobile-apply.tsx），
//       所以 opt-out 一并隐藏被标记的元素（连同那一行承载的核心读数与折叠进去的 TPS）。
//
// 这里没有 DOM，也不引 CSS 解析器（与仓库其它契约测试一样手写）：把 MOBILE_CSS 模板按
// 大括号配对拆成"规则"，再对规则本身做断言。断言刻意分辨**生效的规则**与下面这些：
//   · 被注释掉的；· 注释边界写坏、被蹭进选择器的（本 PR 第一版就踩了这个：规则无效、
//   浏览器整条丢弃，而"文本包含"型断言照样绿）；· 落在永不匹配的媒体查询里的；
//   · 被后面一条同特异度规则盖回去的；· 标记被 opt-out 关掉导致规则无的放矢。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../client/mobile/mobile.css.ts', import.meta.url),
  'utf8',
);
const bundleUrl = new URL('../lib/client.js', import.meta.url);
const bundle = readFileSync(bundleUrl);
const apply = readFileSync(
  new URL('../client/mobile/mobile-apply.tsx', import.meta.url),
  'utf8',
);

/** 取出 `export const NAME = \`…\`` 的模板正文（模板内没有插值，只需处理转义）。 */
const templateOf = (text, name) => {
  // 源码是 `export const MOBILE_CSS = \u0060`，打包产物是 `var MOBILE_CSS = \u0060`：只认名字
  const marker = name + ' = \u0060';
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, '找不到 ' + name + ' 模板');
  let i = start + marker.length;
  let out = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      out += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\u0060') return out;
    out += ch;
    i += 1;
  }
  assert.fail(name + ' 模板没有收尾反引号');
};

/** 折成可比较的形状：折叠空白、去掉属性值引号（[role="menu"] 与 [role=menu] 等价）。 */
const normalize = (text) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/\[\s*([-\w]+)\s*([~|^$*]?=)\s*"([^"]*)"\s*\]/g, '[$1$2$3]')
    .replace(/\[\s*([-\w]+)\s*([~|^$*]?=)\s*'([^']*)'\s*\]/g, '[$1$2$3]')
    .trim();

/** 手写解析：返回 [{ prelude, decls, atStack }]，注释已剔除，atStack 是外层 at-rule 条件。 */
const rulesOf = (stylesheet) => {
  const live = stylesheet.replace(/\/\*[\s\S]*?\*\//g, ' '); // 块注释（CSS 里没有 // 注释）
  const stack = [];
  const found = [];
  let buffer = '';
  for (let i = 0; i < live.length; i++) {
    const ch = live[i];
    if (ch === '{') {
      stack.push({ prelude: buffer.trim(), bodyStart: i + 1 });
      buffer = '';
      continue;
    }
    if (ch === '}') {
      const frame = stack.pop();
      if (!frame) continue;
      found.push({
        prelude: frame.prelude,
        decls: live.slice(frame.bodyStart, i).trim(),
        atStack: stack
          .map((entry) => entry.prelude)
          .filter((entry) => entry.startsWith('@')),
      });
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  return found;
};

const style = templateOf(source, 'MOBILE_CSS');
const bundleStyle = templateOf(bundle.toString('utf8'), 'MOBILE_CSS');
const rules = rulesOf(style);

// opt-out 的哨兵值从样式表里取，而不是写死：一致改名（off -> band 之类）不该让测试变红。
const sentinel = /data-pocket-stats="([^"]+)"/.exec(style)?.[1];
assert.ok(sentinel, '样式表里找不到 data-pocket-stats 的哨兵值');

const OPT_OUT_SELECTOR = normalize(
  'body[data-pocket-stats="' + sentinel + '"] [data-mobile-nav="stats"]',
);
const DEFAULT_SELECTOR = normalize(
  'body:not([data-pocket-stats="' + sentinel + '"]) [data-mobile-nav="stats"]',
);

const optOutRules = rules.filter(
  (rule) => normalize(rule.prelude) === OPT_OUT_SELECTOR,
);
// 只关心打到统计行本身的规则：pocket 还用它自己的标记（files/explorer）藏自己的控件，那是另一回事
const statsRules = rules.filter((rule) =>
  normalize(rule.prelude).includes('[data-mobile-nav=stats]'),
);

test('opt-out 隐藏规则：选择器干净、声明正确、只有一条', () => {
  assert.equal(
    optOutRules.length,
    1,
    'opt-out 隐藏规则必须恰好一条，且选择器必须是 clean 的 ' +
      OPT_OUT_SELECTOR +
      '（注释边界写坏会把文字蹭进选择器，让整条规则无效）；实际匹配到 ' +
      optOutRules.length +
      ' 条',
  );
  assert.equal(
    optOutRules[0].decls.replace(/\s+/g, ' '),
    'display: none !important;',
    '隐藏规则的声明必须只有 display: none !important',
  );
});

test('隐藏规则落在移动端媒体查询里，且外层条件在窄屏都成立', () => {
  const [rule] = optOutRules;
  assert.ok(rule, '隐藏规则不存在，先看上一个用例');
  const conditions = rule.atStack.map((entry) => normalize(entry));
  assert.ok(
    conditions.some((entry) => /max-width: 1023px/.test(entry)),
    '隐藏规则必须落在 @media (max-width: 1023px) 内，当前外层是 ' +
      JSON.stringify(conditions),
  );
  for (const condition of conditions) {
    assert.equal(
      /print|prefers-reduced-motion/.test(condition),
      false,
      '隐藏规则不能落在 @media print / prefers-reduced-motion 里：默认情况下不生效。外层：' +
        JSON.stringify(conditions),
    );
    const min = /min-width:\s*(\d+)px/.exec(condition);
    assert.equal(
      min === null || Number(min[1]) <= 1023,
      true,
      '隐藏规则的外层媒体查询在窄屏不成立（' + condition + '），等于不生效',
    );
  }
});

test('默认路径不受影响，且没有任何"无条件隐藏统计行"的规则', () => {
  const defaultRule = rules.find(
    (rule) => normalize(rule.prelude) === DEFAULT_SELECTOR,
  );
  assert.ok(
    defaultRule,
    '默认路径的 28px 条样式必须保留（' + DEFAULT_SELECTOR + '）',
  );
  assert.match(
    defaultRule.decls,
    /display:\s*flex\s*!important/,
    '默认路径的条必须仍然是 display: flex !important',
  );
  for (const rule of statsRules) {
    if (!/display:\s*none/.test(rule.decls)) continue;
    assert.ok(
      /data-pocket-stats/.test(rule.prelude),
      '只有 opt-out 作用域下的规则才允许隐藏统计行，这条没有：' +
        normalize(rule.prelude),
    );
  }
});

test('标记仍然无条件写入，且不读 opt-out 哨兵（隐藏规则依赖它）', () => {
  assert.match(
    apply,
    /setAttribute\(\s*'data-mobile-nav'\s*,\s*'stats'\s*\)/,
    'mobile-apply.tsx 必须仍然给核心那一行打 data-mobile-nav="stats"：删掉它 opt-out 就静默失效',
  );
  assert.equal(
    /data-pocket-stats/.test(apply),
    false,
    'mark() 目前是无条件写的，隐藏规则依赖这一点：要按 opt-out 关掉标记（任何写法，包括 getAttribute），请连隐藏规则与它的说明一起改',
  );
});

test('构建样式保留统计行 opt-out 隐藏规则', () => {
  // 产物里的 MOBILE_CSS 也必须含有同一条 opt-out 规则（解析而不是数出现次数）
  const bundleOptOut = rulesOf(bundleStyle).filter(
    (rule) => normalize(rule.prelude) === OPT_OUT_SELECTOR,
  );
  assert.equal(
    bundleOptOut.length,
    1,
    'client/client.js 里的 MOBILE_CSS 缺少 opt-out 隐藏规则',
  );
  assert.equal(
    bundleOptOut[0].decls.replace(/\s+/g, ' '),
    'display: none !important;',
    '产物里的隐藏规则声明不对',
  );
});
