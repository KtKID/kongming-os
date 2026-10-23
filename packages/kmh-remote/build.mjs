/** 构建 KMH Remote：复制 Host、编译记录与共享约定，打包浏览器模块工厂。 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('.', import.meta.url));

/** 清理 lib 后复制 Host、编译 TS 与浏览器入口；构建失败向调用方抛出异常。 */
export async function buildRemote() {
  await rm(new URL('lib/', import.meta.url), { recursive: true, force: true });
  await mkdir(new URL('lib/', import.meta.url), { recursive: true });
  await cp(
    new URL('host/', import.meta.url),
    new URL('lib/', import.meta.url),
    {
      recursive: true,
    },
  );
  await build({
    absWorkingDir: root,
    entryPoints: ['shared/access-records.ts'],
    outfile: 'lib/access-records-shared.js',
    bundle: true,
    external: ['zod'],
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    sourcemap: true,
  });
  await build({
    absWorkingDir: root,
    entryPoints: [
      'host/access-records.ts',
      'host/access-records-integration.ts',
    ],
    outdir: 'lib',
    bundle: true,
    external: ['zod'],
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    sourcemap: true,
  });
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['client/index.jsx'],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    jsx: 'transform',
    target: ['chrome100'],
    external: [
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    write: false,
    legalComments: 'none',
  });
  const source = result.outputFiles?.[0]?.text;
  if (!source) throw new Error('KMH Remote 浏览器构建产物为空');
  await writeFile(
    new URL('lib/client.js', import.meta.url),
    `window.__ModuleLoader__.load({id:"@kmh/remote",factory:(require)=>{var module={exports:{}};var exports=module.exports;var React = require("react");\n${source}\nreturn module.exports;}});\n`,
  );
}

await buildRemote();
