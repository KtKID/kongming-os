/** 在真实 SDK profile 中创建并刷新会话，报告宿主的数据、工作与临时目录。 */
import { tmpdir } from 'node:os';
export const name = 'runtime-home-smoke';
export const inject = ['sessions', 'sessionPersistence'];
export async function apply(ctx) {
  const session = ctx.sessions.create(undefined, { meta: { cwd: process.cwd() } });
  const stored = await ctx.sessionPersistence.create(session.header);
  try { await stored.flush(); }
  finally { await stored.close(); }
  ctx.logger.warn('runtime-home-smoke');
  process.stderr.write('KMH_HOME_SMOKE ' + JSON.stringify({ home: process.env.DSH_HOME, tmp: tmpdir(),
    zcode: process.env.ZCODE_DATA_BASE_DIR, cwd: process.cwd(), sessionId: session.id }) + '\n');
}
