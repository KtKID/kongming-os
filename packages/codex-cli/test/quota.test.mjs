/** 额度读取测试；所有官方连接均由进程边界替身提供。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { CodexCli, Config } from "../lib/src/index.js";
import { CodexQuotaService } from "../lib/src/quota.js";
import { QuotaView } from "../lib/src/quota-protocol.js";
import {
  modelQuota,
  windowLow,
  QUOTA_MIN_INTERVAL_MS,
} from "../lib/src/quota-rules.js";
import { mountWeb } from "../lib/src/web.js";
import { createServer } from "node:http";
import { once } from "node:events";

test("T02/T04/T19 真实 HTTP 边界验证查询、共享冷却与无凭据响应", async (t) => {
  const f = fixture();
  const routes = new Map();
  mountWeb(
    {
      connection: {
        fetch: { register: (route) => routes.set(route.path, route) },
      },
    },
    {
      quota: f.service,
      config: Config({
        cwd: "/private/tmp",
        dataDir: "/private/tmp/kmh-quota-unused",
      }),
      settingsNamespace: "kmh-codex-cli",
    },
  );
  assert.ok(routes.has("/api/codex-cli/quota"), "额度只读路由已注册");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const route = routes.get(url.pathname);
      if (!route) {
        res.writeHead(404);
        res.end();
        return;
      }
      const response = await route.fetch(new Request(url));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const context = await (
    await fetch(`${base}/api/codex-cli/quota/context`)
  ).json();
  assert.equal(context.settingsNamespace, "kmh-codex-cli");
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      fetch(`${base}/api/codex-cli/quota?detail=full&force=1`),
    ),
  );
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    QuotaView.parse(await response.json());
  }
  assert.equal(f.calls.length, 2);
  assert.equal(
    (await fetch(`${base}/api/codex-cli/quota?force=bad`)).status,
    400,
  );
});

const origin = 1800000000000;
const win = (usedPercent = 81, windowDurationMins = 300) => ({
  usedPercent,
  windowDurationMins,
  resetsAt: origin / 1000 + 3600,
});
const raw = () => ({
  accountId: "private-account",
  rateLimits: {
    limitId: "codex",
    primary: win(),
    secondary: win(50, 10080),
    credits: { hasCredits: true, unlimited: false, balance: "0" },
    individualLimit: {
      limit: "100.50",
      used: "1.25",
      remainingPercent: 98,
      resetsAt: origin / 1000 + 86400,
    },
  },
  rateLimitResetCredits: {
    availableCount: 1,
    credits: [
      {
        id: "reset-a",
        title: "Gift",
        description: null,
        resetType: "weekly",
        status: "available",
        grantedAt: origin / 1000,
        expiresAt: null,
      },
    ],
  },
});
function fixture({ startupNotification = false } = {}) {
  let now = origin;
  let value = raw();
  let account = {
    type: "chatgpt",
    email: "private@example.test",
    planType: "plus",
  };
  let failure;
  let gate;
  let notify;
  const calls = [];
  let stopped = 0;
  const ctx = new Context();
  const service = new CodexQuotaService(
    ctx,
    Config({ cwd: "/private/tmp", dataDir: "/private/tmp/kmh-quota-unused" }),
    {
      now: () => now,
      connect: async () => ({
        onNotification: (fn) => {
          notify = fn;
        },
        request: async (method, params) => {
          calls.push({ method, params });
          if (method === "account/read") {
            if (startupNotification) notify("account/updated", {});
            return { account };
          }
          assert.equal(
            method,
            "account/rateLimits/read",
            "读取仅允许两个官方只读方法",
          );
          if (gate) await gate;
          if (failure) throw failure;
          return value;
        },
        stop: async () => {
          stopped++;
          return "clean";
        },
      }),
    },
  );
  return {
    service,
    calls,
    get stopped() {
      return stopped;
    },
    advance: () => {
      now += QUOTA_MIN_INTERVAL_MS;
    },
    set: (v) => {
      value = v;
    },
    fail: (e) => {
      failure = e;
    },
    account: (a) => {
      account = a;
    },
    gate: (p) => {
      gate = p;
    },
    notify: () => notify("account/updated", {}),
  };
}

test("T01/T05/T06 官方窗口、Credits、消费上限、重置卡与零值保真", async () => {
  const f = fixture();
  const view = await f.service.read();
  assert.equal(view.groups[0].windows[0].remainingPercent, 19);
  assert.equal(view.groups[0].windows[1].windowMinutes, 10080);
  assert.equal(view.credits.balance, "0");
  assert.equal(view.spend.limit, "100.50");
  assert.equal(view.resets.availableCount, 1);
  assert.equal(view.resets.cards[0].expiresAtMs, null);
  assert.equal(view.fetchedAtMs, origin);
  assert.equal(f.stopped, 1);
  assert.deepEqual(f.calls, [
    { method: "account/read", params: { refreshToken: false } },
    {
      method: "account/rateLimits/read",
      params: { excludeResetCreditDetails: false },
    },
  ]);
  assert.ok(!JSON.stringify(view).includes("private"));
  QuotaView.parse(view);
  f.advance();
  f.set({
    ...raw(),
    rateLimits: { primary: null, secondary: win(100, 10080) },
    rateLimitResetCredits: { availableCount: 0, credits: null },
  });
  const partial = await f.service.read();
  assert.equal(partial.groups[0].windows.length, 1);
  assert.equal(partial.groups[0].windows[0].remainingPercent, 0);
  assert.equal(partial.credits, null);
  assert.equal(partial.resets.availableCount, 0);
  assert.equal(partial.resets.cards, null);
});

test("T05/T07 可选区域错误保留原时间，合法窗口继续更新", async () => {
  const f = fixture();
  await f.service.read();
  f.advance();
  const value = raw();
  value.rateLimits.credits = { balance: 33 };
  value.rateLimitResetCredits = { availableCount: -1 };
  value.rateLimits.primary = win(90);
  f.set(value);
  const view = await f.service.read();
  assert.equal(view.groups[0].windows[0].remainingPercent, 10);
  assert.equal(view.fetchedAtMs, origin + QUOTA_MIN_INTERVAL_MS);
  assert.equal(view.creditsAtMs, origin);
  assert.equal(view.resetsAtMs, origin);
  assert.deepEqual(
    view.errors.map((e) => e.area),
    ["credits", "resets"],
  );
  assert.equal(view.credits.balance, "0");
});

test("T10/T16 参考插件的精确分组、Spark、Reserve、严格阈值及有效期", async () => {
  const f = fixture();
  const view = await f.service.read();
  const main = view.groups[0];
  const groups = [
    main,
    {
      ...main,
      id: "spark",
      name: "GPT Spark",
      windows: main.windows.map((w) => ({
        ...w,
        usedPercent: 35,
        remainingPercent: 65,
      })),
    },
    {
      ...main,
      id: "gpt-special",
      name: "Special",
      windows: main.windows.map((w) => ({
        ...w,
        usedPercent: 95,
        remainingPercent: 5,
      })),
    },
  ];
  assert.equal(modelQuota(groups, "gpt-special").length, 2);
  assert.equal(modelQuota(groups, "gpt-5-spark").length, 2);
  assert.equal(modelQuota(groups, "gpt-special")[0].remainingPercent, 5);
  assert.equal(modelQuota(groups, "gpt-5-spark")[0].remainingPercent, 65);
  assert.equal(modelQuota(groups, "gpt-reserve").length, 0);
  assert.equal(modelQuota([main], "gpt-5-spark").length, 0);
  assert.equal(modelQuota([main], "gpt-5").length, 2);
  const w = main.windows[0];
  const settings = {
    quotaDisplayMode: "percent",
    quotaAlertsEnabled: true,
    quotaShortThresholdPercent: 20,
    quotaWeeklyThresholdPercent: 20,
  };
  assert.equal(windowLow(w, origin, origin, settings), true);
  assert.equal(
    windowLow({ ...w, remainingPercent: 20 }, origin, origin, settings),
    false,
  );
  assert.equal(windowLow(w, origin, origin + 300001, settings), false);
  assert.equal(
    windowLow({ ...w, resetsAtMs: origin }, origin, origin, settings),
    false,
  );
  assert.equal(
    windowLow(w, origin, origin, { ...settings, quotaAlertsEnabled: false }),
    false,
  );
});

test("T02/T19 并发、手动与失败读取统一五分钟限频且缓存独立", async () => {
  const f = fixture();
  const views = await Promise.all(
    Array.from({ length: 100 }, () => f.service.read()),
  );
  assert.equal(f.calls.length, 2);
  views[0].groups.length = 0;
  assert.equal(f.service.snapshot().groups.length, 1);
  for (let i = 0; i < 30; i++) await f.service.read();
  assert.equal(f.calls.length, 2);
  f.advance();
  f.fail(new Error("private-token forbidden"));
  const failed = await f.service.read();
  assert.equal(failed.state, "error");
  assert.equal(failed.fetchedAtMs, origin);
  assert.equal(failed.groups[0].windows[0].remainingPercent, 19);
  assert.ok(!JSON.stringify(failed).includes("private-token"));
  await Promise.all(Array.from({ length: 100 }, () => f.service.read()));
  assert.equal(f.calls.length, 4);
  assert.equal(f.stopped, 2);
});

test("T03/T19 模拟账号失效淘汰晚回执且保留冷却；全程只有只读请求", async () => {
  const f = fixture();
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  f.gate(gate);
  const pending = f.service.read();
  await new Promise((resolve) => setImmediate(resolve));
  f.service.invalidate();
  release();
  await pending;
  assert.equal(f.service.snapshot().groups.length, 0);
  assert.equal(f.service.snapshot().accountEpoch, 1);
  await f.service.read();
  assert.equal(f.calls.length, 2);
  f.advance();
  f.account(null);
  const signedOut = await f.service.read();
  assert.equal(signedOut.state, "signed-out");
  assert.equal(signedOut.credits, null);
  f.advance();
  f.account({ type: "apiKey" });
  assert.equal((await f.service.read()).state, "unsupported");
  assert.ok(
    f.calls.every((c) =>
      ["account/read", "account/rateLimits/read"].includes(c.method),
    ),
  );
});

test("T03 成功读取发现账号变化后清除全部旧区域", async () => {
  const f = fixture();
  await f.service.read();
  f.advance();
  f.set({
    ...raw(),
    accountId: "new-account",
    rateLimits: { primary: win(0), credits: null },
    rateLimitResetCredits: null,
  });
  const view = await f.service.read();
  assert.equal(view.accountEpoch, 1);
  assert.equal(view.credits, null);
  assert.equal(view.resets, null);
  assert.equal(view.groups[0].windows[0].remainingPercent, 100);
});

test("B2 CLI 启动账号通知后完成读取，账号回执变化清空旧分区", async () => {
  const f = fixture({ startupNotification: true });
  const first = await f.service.read();
  assert.equal(first.state, "ready");
  assert.equal(first.groups[0].windows[0].remainingPercent, 19);
  assert.equal(first.accountEpoch, 0);
  assert.equal(f.calls.length, 2);
  await f.service.read();
  assert.equal(f.calls.length, 2, "启动通知保持五分钟冷却");
  f.advance();
  f.account({ type: "chatgpt", email: "new@example.test", planType: "plus" });
  f.set({ ...raw(), rateLimits: { primary: win(0), credits: { balance: 3 } } });
  const next = await f.service.read();
  assert.equal(next.state, "ready");
  assert.equal(next.accountEpoch, 1);
  assert.equal(next.groups[0].windows[0].remainingPercent, 100);
  assert.equal(next.credits, null, "新账号回执淘汰上次 Credits");
  assert.equal(f.stopped, 2);
});

test("B2 额度请求期间的账号通知中止提交，晚回执保持空状态与冷却", async () => {
  const f = fixture({ startupNotification: true });
  let release;
  f.gate(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = f.service.read();
  await new Promise((resolve) => setImmediate(resolve));
  f.notify();
  release();
  const view = await pending;
  assert.equal(view.accountEpoch, 1);
  assert.equal(view.groups.length, 0);
  assert.equal(view.credits, null);
  assert.equal(view.nextRefreshAtMs, origin + QUOTA_MIN_INTERVAL_MS);
  await f.service.read();
  assert.equal(f.calls.length, 2);
  assert.equal(f.stopped, 1);
});

test("B2 同账号启动通知后的读取失败保留原额度与成功时间", async () => {
  const f = fixture({ startupNotification: true });
  const first = await f.service.read();
  f.advance();
  f.fail(new Error("fixture read failed"));
  const failed = await f.service.read();
  assert.equal(failed.state, "error");
  assert.deepEqual(failed.groups, first.groups);
  assert.deepEqual(failed.credits, first.credits);
  assert.equal(failed.fetchedAtMs, origin);
  assert.equal(failed.nextRefreshAtMs, origin + 2 * QUOTA_MIN_INTERVAL_MS);
});

test("T02 CLI 标准 method-not-found 错误码标为不支持", async () => {
  const f = fixture();
  const error = new Error("Unknown method");
  error.code = -32601;
  f.fail(error);
  assert.equal((await f.service.read()).state, "unsupported");
  assert.equal(f.stopped, 1);
});

test("T07 主对象损坏时，多分组窗口有效，旧 Credits 保留并显示分区错误", async () => {
  const f = fixture();
  await f.service.read();
  f.advance();
  const value = raw();
  value.rateLimitsByLimitId = { codex: value.rateLimits };
  value.rateLimits = null;
  f.set(value);
  const view = await f.service.read();
  assert.equal(view.groups[0].windows[0].remainingPercent, 19);
  assert.equal(view.credits.balance, "0");
  assert.equal(view.creditsAtMs, origin);
  assert.ok(view.errors.some((e) => e.area === "credits"));
});

test("T02/T07 窗口解析全部失败时保留上次周期与成功时间", async () => {
  const f = fixture();
  await f.service.read();
  f.advance();
  const value = raw();
  value.rateLimits.primary = { ...win(), usedPercent: NaN };
  value.rateLimits.secondary = { ...win(), windowDurationMins: 0 };
  f.set(value);
  const view = await f.service.read();
  assert.equal(view.fetchedAtMs, origin);
  assert.equal(view.groups[0].windows[0].remainingPercent, 19);
  assert.ok(view.errors.some((e) => e.area === "windows"));
});

test("T01 运行时提供独立只读额度服务", () => {
  const ctx = new Context();
  const runtime = new CodexCli(
    ctx,
    Config({ cwd: "/private/tmp", dataDir: "/private/tmp/kmh-quota-unused" }),
  );
  assert.equal(typeof runtime.quota?.read, "function");
});
