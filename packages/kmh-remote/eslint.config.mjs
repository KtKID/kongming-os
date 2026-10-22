/** Remote 客户端、Host 与共享 TS 沿用 KMH 根配置的严格类型规则。 */
import config from '../../eslint.config.mjs';

export default config.map((entry) =>
  entry.files
    ? {
        ...entry,
        files: ['client/**/*.{ts,tsx}', 'host/**/*.ts', 'shared/**/*.ts'],
      }
    : entry,
);
