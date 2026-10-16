/**
 * kmh-infra 宿主半装配的行为测试：用可变的 volatile 替身与注入的暗号解析
 * 替身驱动 McpMount，断言 stdio 参数、环境变量传递、异步解析后的重挂与
 * 卸载、代次竞态，以及措辞引导段落的内容边界。替身只替代 loader 的取值
 * 管道与 shell 取值，装配与判定走的是同一段代码。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpMount } from "../lib/src/mcp.js";
import * as Prompt from "../lib/src/prompt.js";

/** 测试用的暗号环境变量名；暗号值只在测试进程里存在。 */
const TOKEN_VAR = "KMH_INFRA_TEST_TOKEN";
/** 测试用的假暗号：用于验证传递与不泄漏，不是任何真实凭据。 */
const TOKEN_VALUE = "not-a-real-secret-0123456789";

/** 等待暗号解析的微任务链跑完（解析是异步的，挂载发生在 then 回调里）。 */
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

/** 建立一组可变配置引用（loader 之外的最小替身）。 */
function createConfig(overrides = {}) {
  const state = {
    dashUrl: "http://127.0.0.1:60010",
    tokenEnvVar: TOKEN_VAR,
    pythonCommand: "python3",
    mcpModuleDir: "/tmp/x-infra-mcp",
    panelLoadTimeoutMs: 8000,
    probeTimeoutMs: 5000,
    toolCallTimeoutMs: 60000,
    mcpEnabled: true,
    ...overrides,
  };
  const config = {};
  for (const key of Object.keys(state)) config[key] = { get: () => state[key] };
  return { state, config };
}

/** 记录子插件挂载、告警与信息日志的最小宿主上下文。 */
function createHost() {
  const plugins = [];
  const warnings = [];
  const infos = [];
  const ctx = {
    plugin: (module, options) => {
      const record = { module, options, disposed: 0 };
      plugins.push(record);
      return {
        dispose: () => {
          record.disposed += 1;
          return Promise.resolve();
        },
      };
    },
    logger: {
      warn: (...args) => warnings.push(args.map(String).join(" ")),
      info: (...args) => infos.push(args.map(String).join(" ")),
    },
    on: () => {},
    effect: () => () => {},
  };
  return { ctx, plugins, warnings, infos };
}

/**
 * 建一个可编排的 shell 取值替身：默认立即取到假暗号；测试可改 current 切换
 * 取值（或置 undefined 模拟取不到），或用 hold/release 构造慢取值与乱序完成。
 * 替身只替代 shell 取值这一步，解析顺序（shell 优先、进程环境后备）走真实代码。
 */
function createFetcher() {
  const state = {
    current: TOKEN_VALUE,
    queue: [],
  };
  const fetcher = () => {
    if (state.queue.length > 0) return state.queue.shift();
    return Promise.resolve(state.current);
  };
  return {
    fetcher,
    state,
    hold: () => {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      state.queue.push(promise);
      return release;
    },
  };
}

/** 断言第一个挂载的查询实例选项（stdio 参数与环境变量传递）。 */
function mcpOptionsAt(host, index) {
  return host.plugins[index].options;
}

test("启用时解析暗号后挂载 stdio 查询与引导段落，暗号显式传入子进程", async () => {
  const { config } = createConfig();
  const host = createHost();
  const { fetcher } = createFetcher();
  new McpMount(host.ctx, config, fetcher).sync();
  await flush();

  assert.equal(host.plugins.length, 2, "查询实例与引导段落各挂一次");
  const mcp = mcpOptionsAt(host, 0);
  assert.equal(mcp.transport, "stdio");
  assert.equal(mcp.serverName, "infra");
  assert.equal(mcp.command, "python3");
  assert.deepEqual(mcp.args, ["-m", "x_infra_mcp.mcp_server"]);
  assert.equal(mcp.cwd, "/tmp/x-infra-mcp");
  assert.equal(mcp.env.X_DASH_BASE_URL, "http://127.0.0.1:60010");
  assert.equal(
    mcp.env.X_INFRA_MCP_TOKEN,
    TOKEN_VALUE,
    "暗号必须显式传入：DSH 会按 KEY|PASSWORD|SECRET|TOKEN 把父进程环境洗掉",
  );
  assert.equal(mcp.toolCallTimeoutMs, 60000);
  assert.equal(
    mcp.failOnStartupError,
    false,
    "连接失败不得阻塞插件加载",
  );
  assert.equal(host.warnings.length, 0);
  assert.match(host.infos[0], /用户 shell 配置/);
});

test("shell 配置的取值优先于 KMH 进程环境", async () => {
  process.env[TOKEN_VAR] = `${TOKEN_VALUE}-from-env`;
  try {
    const { config } = createConfig();
    const host = createHost();
    const { fetcher } = createFetcher();
    new McpMount(host.ctx, config, fetcher).sync();
    await flush();
    assert.equal(mcpOptionsAt(host, 0).env.X_INFRA_MCP_TOKEN, TOKEN_VALUE);
    assert.match(host.infos[0], /用户 shell 配置/);
  } finally {
    delete process.env[TOKEN_VAR];
  }
});

test("shell 取不到时回退进程环境并照常挂载", async () => {
  process.env[TOKEN_VAR] = `${TOKEN_VALUE}-from-env`;
  try {
    const { config } = createConfig();
    const host = createHost();
    const { fetcher, state } = createFetcher();
    state.current = undefined;
    new McpMount(host.ctx, config, fetcher).sync();
    await flush();
    assert.equal(mcpOptionsAt(host, 0).env.X_INFRA_MCP_TOKEN, `${TOKEN_VALUE}-from-env`);
    assert.match(host.infos[0], /KMH 进程环境/);
    assert.equal(host.warnings.length, 0);
  } finally {
    delete process.env[TOKEN_VAR];
  }
});

test("两个来源都没有取值时不下发该变量，只留一条告警且日志里没有暗号", async () => {
  delete process.env[TOKEN_VAR];
  const { config } = createConfig();
  const host = createHost();
  const { fetcher, state } = createFetcher();
  state.current = undefined;
  new McpMount(host.ctx, config, fetcher).sync();
  await flush();

  const mcp = mcpOptionsAt(host, 0);
  assert.equal("X_INFRA_MCP_TOKEN" in mcp.env, false);
  assert.equal(mcp.env.X_DASH_BASE_URL, "http://127.0.0.1:60010");
  assert.equal(host.warnings.length, 1);
  assert.match(host.warnings[0], /身份校验错误/);
  assert.match(host.warnings[0], /shell 配置/);
  assert.doesNotMatch(host.warnings[0], new RegExp(TOKEN_VALUE));
  assert.equal(host.infos.length, 0, "没有取值时不产生来源信息日志");
});

test("关键参数变化触发重挂：旧实例先卸载，工具名命名空间保持稳定", async () => {
  const { state, config } = createConfig();
  const host = createHost();
  const { fetcher } = createFetcher();
  const mount = new McpMount(host.ctx, config, fetcher);
  mount.sync();
  await flush();
  assert.equal(host.plugins.length, 2);

  mount.sync();
  await flush();
  assert.equal(host.plugins.length, 2, "配置与暗号都没变不重挂");

  state.dashUrl = "http://127.0.0.1:60011";
  mount.sync();
  await flush();
  assert.equal(host.plugins.length, 4, "地址变化重挂一次");
  assert.equal(host.plugins[0].disposed, 1, "旧查询实例被卸载");
  assert.equal(host.plugins[1].disposed, 1, "旧引导段落被卸载");
  assert.equal(mcpOptionsAt(host, 2).env.X_DASH_BASE_URL, "http://127.0.0.1:60011");
  assert.equal(mcpOptionsAt(host, 2).serverName, "infra");

  state.toolCallTimeoutMs = 30000;
  mount.sync();
  await flush();
  assert.equal(host.plugins.length, 6, "查询等待上限变化也重挂");
  assert.equal(mcpOptionsAt(host, 4).toolCallTimeoutMs, 30000);
});

test("开关关闭立即卸载两个子插件，重新打开再挂回", async () => {
  const { state, config } = createConfig();
  const host = createHost();
  const { fetcher } = createFetcher();
  const mount = new McpMount(host.ctx, config, fetcher);
  mount.sync();
  await flush();
  state.mcpEnabled = false;
  mount.sync();
  assert.equal(host.plugins.length, 2, "关闭后不新增挂载（卸载不等暗号解析）");
  assert.equal(host.plugins[0].disposed, 1);
  assert.equal(host.plugins[1].disposed, 1);
  state.mcpEnabled = true;
  mount.sync();
  await flush();
  assert.equal(host.plugins.length, 4, "重新打开挂回一组");
});

test("关键参数为空时不挂载，也不留下半挂状态", async () => {
  const { config } = createConfig({ pythonCommand: "", mcpModuleDir: "" });
  const host = createHost();
  const { fetcher } = createFetcher();
  new McpMount(host.ctx, config, fetcher).sync();
  await flush();
  assert.equal(host.plugins.length, 0);
});

test("dispose 卸载当前一组并作废在途解析，重复调用不再卸载", async () => {
  const { config } = createConfig();
  const host = createHost();
  const { fetcher, hold } = createFetcher();
  const mount = new McpMount(host.ctx, config, fetcher);
  const release = hold();
  mount.sync();
  mount.dispose();
  release(TOKEN_VALUE);
  await flush();
  assert.equal(host.plugins.length, 0, "dispose 之后的解析结果不得再挂载");

  const { fetcher: fetcher2 } = createFetcher();
  const mount2 = new McpMount(host.ctx, config, fetcher2);
  mount2.sync();
  await flush();
  assert.equal(host.plugins.length, 2);
  mount2.dispose();
  assert.equal(host.plugins[0].disposed, 1);
  assert.equal(host.plugins[1].disposed, 1);
  mount2.dispose();
  assert.equal(host.plugins[0].disposed, 1, "第二次 dispose 无副作用");
});

test("暗号取值变化也会重挂，且装配键与日志都不含暗号", async () => {
  const { config } = createConfig();
  const host = createHost();
  const { fetcher, state } = createFetcher();
  const mount = new McpMount(host.ctx, config, fetcher);
  mount.sync();
  await flush();
  state.current = `${TOKEN_VALUE}-rotated`;
  mount.sync();
  await flush();
  assert.equal(host.plugins.length, 4);
  assert.equal(mcpOptionsAt(host, 2).env.X_INFRA_MCP_TOKEN, `${TOKEN_VALUE}-rotated`);
  for (const warning of host.warnings) {
    assert.doesNotMatch(warning, new RegExp(TOKEN_VALUE));
  }
  for (const info of host.infos) {
    assert.doesNotMatch(info, new RegExp(TOKEN_VALUE), "来源日志只出现变量名与来源");
  }
});

test("连发配置变更时只有最新一次解析会落地，被超过的结果被丢弃", async () => {
  const { state, config } = createConfig();
  const host = createHost();
  const { fetcher, hold } = createFetcher();
  const mount = new McpMount(host.ctx, config, fetcher);

  const first = hold();
  mount.sync();
  state.dashUrl = "http://127.0.0.1:60011";
  mount.sync();
  const second = hold();
  state.dashUrl = "http://127.0.0.1:60012";
  mount.sync();
  const third = hold();

  second(TOKEN_VALUE);
  first(`${TOKEN_VALUE}-stale`);
  third(TOKEN_VALUE);
  await flush();

  assert.equal(host.plugins.length, 2, "只有最新代次挂载，被超过的解析不挂");
  assert.equal(mcpOptionsAt(host, 0).env.X_DASH_BASE_URL, "http://127.0.0.1:60012");
  assert.equal(mcpOptionsAt(host, 0).env.X_INFRA_MCP_TOKEN, TOKEN_VALUE);
});

test("解析异常不改变当前装配，只记一条告警", async () => {
  const { config } = createConfig();
  const host = createHost();
  const fetcher = () => Promise.reject(new Error("boom"));
  const mount = new McpMount(host.ctx, config, fetcher);
  mount.sync();
  await flush();
  assert.equal(host.plugins.length, 0, "异常时不挂载也不留半挂状态");
  assert.equal(host.warnings.length, 1);
  assert.match(host.warnings[0], /暗号解析异常/);
  assert.doesNotMatch(host.warnings[0], new RegExp(TOKEN_VALUE));
});

test("措辞引导覆盖各个结果码，且不含地址、端口或凭据", () => {
  const sections = [];
  Prompt.apply({
    systemPrompt: {
      section: (section) => sections.push(section),
      getSectionOrder: () => 3100,
    },
  });
  assert.equal(sections.length, 1);
  const section = sections[0];
  assert.equal(section.name, "kmh-infra:mcp-guidance");
  assert.equal(section.order, 3100);
  assert.equal(section.interpolate, false);
  for (const code of [
    "invalid_token",
    "service_auth_disabled",
    "dash_unreachable",
    "not_found",
    "invalid_argument",
    "unknown",
    "duplicate_names",
  ]) {
    assert.match(section.text, new RegExp(code), `引导必须覆盖 ${code}`);
  }
  assert.match(section.text, /身份校验错误/);
  assert.match(section.text, /面板没有在运行/);
  assert.doesNotMatch(section.text, /127\.0\.0\.1|60010|http:/u);
  assert.doesNotMatch(section.text, new RegExp(TOKEN_VALUE));
});
