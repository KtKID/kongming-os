// 核心访问记录测试：隔离文件与真实组件；V8 输出四项覆盖率供变更范围对账。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^\.\/access-records-integration\.js$/,
        replacement: fileURLToPath(
          new URL('./host/access-records-integration.ts', import.meta.url),
        ),
      },
      {
        find: /^\.\/access-records\.js$/,
        replacement: fileURLToPath(
          new URL('./host/access-records.ts', import.meta.url),
        ),
      },
      {
        find: /^\.\/access-records-shared\.js$/,
        replacement: fileURLToPath(
          new URL('./shared/access-records.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ['test/access-records*.spec.{ts,tsx}'],
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: './.cache/records-coverage',
      include: [
        'shared/access-records.ts',
        'host/access-records.ts',
        'host/access-records-integration.ts',
        'client/RemotePluginPanel.tsx',
        'client/access-records-locales.ts',
        'host/proxy.mjs',
        'host/service.mjs',
        'host/index.js',
        'host/web-rpc.js',
        'client/index.jsx',
        'client/pocket-locales.js',
      ],
    },
  },
});
