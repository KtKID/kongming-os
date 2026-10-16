/**
 * kmh-infra 宿主半装配的行为测试：用可变的 volatile 替身驱动 McpMount，
 * 断言 stdio 参数、环境变量传递、重挂与卸载的真实行为，以及措辞引导段落的
 * 内容边界。替身只替代 loader 负责的取值管道，装配与判定走的是同一段代码。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpMount } from "../lib/src/mcp.js";
import * as Prompt from "../lib/src/prompt.js";

/** 测试用的暗号环境变量名；暗号值只在测试进程里存在。 */
const TOKEN_VAR = "KMH_INFRA_TEST_TOKEN";
/** 测试用的假暗号：用于验证传递与不泄漏，不是任何真实凭据。 */
const TOKEN_VALUE = "not-a-real-secret-0123456789";

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

/** 记录子插件挂载与告警的最小宿主上下文。 */
function createHost() {
  const plugins = [];
  const warnings = [];
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
    },
    on: () => {},
    effect: () => () => {},
  };
  return { ctx, plugins, warnings };
}

test("启用时按配置挂载 stdio 查询与引导段落，暗号显式传入子进程", () => {
  process.env[TOKEN_VAR] = TOKEN_VALUE;
  try {
    const { config } = createConfig();
    const host = createHost();
    new McpMount(host.ctx, config).sync();

    assert.equal(host.plugins.length, 2, "查询实例与引导段落各挂一次");
    const mcp = host.plugins[0].options;
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
  } finally {
    delete process.env[TOKEN_VAR];
  }
});

test("环境里没有暗号时不下发该变量，只留一条告警且日志里没有暗号", () => {
  delete process.env[TOKEN_VAR];
  const { config } = createConfig();
  const host = createHost();
  new McpMount(host.ctx, config).sync();

  const mcp = host.plugins[0].options;
  assert.equal("X_INFRA_MCP_TOKEN" in mcp.env, false);
  assert.equal(mcp.env.X_DASH_BASE_URL, "http://127.0.0.1:60010");
  assert.equal(host.warnings.length, 1);
  assert.match(host.warnings[0], /身份校验错误/);
  assert.doesNotMatch(host.warnings[0], new RegExp(TOKEN_VALUE));
});

test("关键参数变化触发重挂：旧实例先卸载，工具名命名空间保持稳定", () => {
  process.env[TOKEN_VAR] = TOKEN_VALUE;
  try {
    const { state, config } = createConfig();
    const host = createHost();
    const mount = new McpMount(host.ctx, config);
    mount.sync();
    assert.equal(host.plugins.length, 2);

    mount.sync();
    assert.equal(host.plugins.length, 2, "配置未变不重挂");

    state.dashUrl = "http://127.0.0.1:60011";
    mount.sync();
    assert.equal(host.plugins.length, 4, "地址变化重挂一次");
    assert.equal(host.plugins[0].disposed, 1, "旧查询实例被卸载");
    assert.equal(host.plugins[1].disposed, 1, "旧引导段落被卸载");
    assert.equal(host.plugins[2].options.env.X_DASH_BASE_URL, "http://127.0.0.1:60011");
    assert.equal(host.plugins[2].options.serverName, "infra");

    state.toolCallTimeoutMs = 30000;
    mount.sync();
    assert.equal(host.plugins.length, 6, "查询等待上限变化也重挂");
    assert.equal(host.plugins[4].options.toolCallTimeoutMs, 30000);
  } finally {
    delete process.env[TOKEN_VAR];
  }
});

test("开关关闭即卸载两个子插件，重新打开再挂回", () => {
  process.env[TOKEN_VAR] = TOKEN_VALUE;
  try {
    const { state, config } = createConfig();
    const host = createHost();
    const mount = new McpMount(host.ctx, config);
    mount.sync();
    state.mcpEnabled = false;
    mount.sync();
    assert.equal(host.plugins.length, 2, "关闭后不新增挂载");
    assert.equal(host.plugins[0].disposed, 1);
    assert.equal(host.plugins[1].disposed, 1);
    state.mcpEnabled = true;
    mount.sync();
    assert.equal(host.plugins.length, 4, "重新打开挂回一组");
  } finally {
    delete process.env[TOKEN_VAR];
  }
});

test("关键参数为空时不挂载，也不留下半挂状态", () => {
  process.env[TOKEN_VAR] = TOKEN_VALUE;
  try {
    const { config } = createConfig({ pythonCommand: "", mcpModuleDir: "" });
    const host = createHost();
    new McpMount(host.ctx, config).sync();
    assert.equal(host.plugins.length, 0);
  } finally {
    delete process.env[TOKEN_VAR];
  }
});

test("dispose 卸载当前一组，重复调用不再卸载", () => {
  process.env[TOKEN_VAR] = TOKEN_VALUE;
  try {
    const { config } = createConfig();
    const host = createHost();
    const mount = new McpMount(host.ctx, config);
    mount.sync();
    mount.dispose();
    assert.equal(host.plugins[0].disposed, 1);
    assert.equal(host.plugins[1].disposed, 1);
    mount.dispose();
    assert.equal(host.plugins[0].disposed, 1, "第二次 dispose 无副作用");
  } finally {
    delete process.env[TOKEN_VAR];
  }
});

test("暗号取值变化也会重挂，且装配键与日志都不含暗号", () => {
  process.env[TOKEN_VAR] = TOKEN_VALUE;
  try {
    const { config } = createConfig();
    const host = createHost();
    const mount = new McpMount(host.ctx, config);
    mount.sync();
    process.env[TOKEN_VAR] = `${TOKEN_VALUE}-rotated`;
    mount.sync();
    assert.equal(host.plugins.length, 4);
    assert.equal(host.plugins[2].options.env.X_INFRA_MCP_TOKEN, `${TOKEN_VALUE}-rotated`);
    for (const warning of host.warnings) {
      assert.doesNotMatch(warning, new RegExp(TOKEN_VALUE));
    }
  } finally {
    delete process.env[TOKEN_VAR];
  }
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
