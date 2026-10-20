/** 移动端 TypeScript 沿用 KMH 根配置的严格类型规则。 */
import config from '../../eslint.config.mjs';

export default config.map((entry) =>
  entry.files
    ? {
        ...entry,
        files: ['client/mobile/**/*.{ts,tsx}'],
      }
    : entry,
);
