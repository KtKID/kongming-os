// 核对访问记录变更的四项覆盖率；新增模块全量计入，接线按固定 Git 基线计算，低于 100% 时失败。
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const task = resolve(
  root,
  'docs/spec/kmh-remote-access-records/tasks/task-access-records-core',
);
const report = resolve(root, 'packages/kmh-remote/.cache/records-coverage');
const coverage = JSON.parse(
  await readFile(resolve(report, 'coverage-final.json'), 'utf8'),
);
const complete = new Set([
  'shared/access-records.ts',
  'host/access-records.ts',
  'host/access-records-integration.ts',
  'client/RemotePluginPanel.tsx',
  'client/access-records-locales.ts',
]);
const wiring = [
  'host/proxy.mjs',
  'host/index.js',
  'host/service.mjs',
  'host/web-rpc.js',
  'client/index.jsx',
  'client/pocket-locales.js',
];
const gitBase = JSON.parse(
  await readFile(resolve(task, 'baselines/git-base.json'), 'utf8'),
).commit;
const sha = (text) => createHash('sha256').update(text).digest('hex');

/** 从统一差异中提取当前文件的新增/替换行，删除行为由既有回归核验。 */
function diffLines(diff) {
  const result = new Set();
  for (const match of diff.matchAll(
    /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm,
  )) {
    const start = Number(match[1]),
      count = Number(match[2] ?? 1);
    for (let line = start; line < start + count; line++) result.add(line);
  }
  return result;
}

const files = {};
let failed = false;
for (const short of [...complete, ...wiring]) {
  const path = resolve(root, 'packages/kmh-remote', short);
  const source = await readFile(path, 'utf8');
  const raw = coverage[path];
  if (!raw) throw Error(`缺少覆盖报告：${short}`);
  let changed;
  if (complete.has(short))
    changed = new Set(source.split('\n').map((_, i) => i + 1));
  else {
    changed = diffLines(
      execFileSync(
        'git',
        [
          'diff',
          '--no-ext-diff',
          '--diff-algorithm=myers',
          '--unified=0',
          gitBase,
          '--',
          relative(root, path),
        ],
        { cwd: root, encoding: 'utf8' },
      ),
    );
    if (short === 'client/index.jsx') {
      // 记录详情仅在 apply 注册；原设置表单的独立修复由设置测试承接。
      const entry = source
        .split('\n')
        .findIndex((line) => line.startsWith('export function apply('));
      if (entry < 0) throw Error('访问记录的客户端注册入口缺失');
      changed = new Set([...changed].filter((line) => line > entry));
    }
  }
  const overlaps = (loc) =>
    [...changed].some((line) => line >= loc.start.line && line <= loc.end.line);
  const metrics = { statements: [], functions: [], branches: [], lines: [] };
  const lines = new Map();
  for (const [id, loc] of Object.entries(raw.statementMap))
    if (overlaps(loc)) {
      metrics.statements.push(raw.s[id] > 0);
      if (changed.has(loc.start.line))
        lines.set(
          loc.start.line,
          (lines.get(loc.start.line) ?? false) || raw.s[id] > 0,
        );
    }
  metrics.lines = [...lines.values()];
  for (const [id, loc] of Object.entries(raw.fnMap))
    if (overlaps(loc.decl)) metrics.functions.push(raw.f[id] > 0);
  for (const [id, loc] of Object.entries(raw.branchMap))
    if (complete.has(short) || changed.has(loc.line))
      metrics.branches.push(...raw.b[id].map((value) => value > 0));
  const result = {};
  for (const [name, values] of Object.entries(metrics)) {
    const covered = values.filter(Boolean).length,
      total = values.length;
    result[name] = {
      covered,
      total,
      pct: total ? (100 * covered) / total : 100,
    };
    if (covered !== total) failed = true;
  }
  files[relative(root, path)] = {
    sha256: sha(source),
    scope: complete.has(short) ? 'full' : 'added-or-replaced-lines',
    changedLines: [...changed].sort((a, b) => a - b),
    metrics: result,
  };
}
await writeFile(
  resolve(report, 'coverage-scope.json'),
  JSON.stringify({ threshold: 100, gitBase, files }, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      threshold: 100,
      passed: !failed,
      files: Object.fromEntries(
        Object.entries(files).map(([path, value]) => [path, value.metrics]),
      ),
    },
    null,
    2,
  ),
);
if (failed) process.exitCode = 1;
