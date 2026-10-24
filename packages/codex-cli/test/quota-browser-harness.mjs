/** 隔离额度验收：真实配置落盘、真实会话模型目录与组件，官方连接使用固定数据。 */
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";
import {
  boot,
  initProfile,
  readProfilePatches,
} from "../../../third_party/dsh/packages/boot/app-boot/lib/index.js";
import ConfigEditor from "../../../third_party/dsh/packages/boot/config-editor/lib/index.js";
import Settings from "@deepseek-ai/dsh-settings";
import { Config } from "../lib/src/config.js";
import { CodexQuotaService } from "../lib/src/quota.js";
import { mountWeb } from "../lib/src/web.js";

/** 创建真实配置宿主与清理入口；启动失败清理临时目录后抛出原错误。 */
export async function quotaHostFixture() {
  const home = await mkdtemp(join(tmpdir(), "kmh-quota-ui-"));
  const dir = join(home, "profiles", "quota");
  initProfile(dir, ["quota-fixture"]);
  const bundle = join(dir, "node_modules", "quota-fixture");
  await mkdir(bundle, { recursive: true });
  await writeFile(
    join(home, "package.json"),
    '{"name":"quota-fixture-installation"}\n',
  );
  await writeFile(
    join(bundle, "package.json"),
    JSON.stringify({
      name: "quota-fixture",
      version: "1.0.0",
      dsh: { bundle: { patch: "cordis.patch.yml" } },
    }),
  );
  await writeFile(
    join(bundle, "cordis.patch.yml"),
    JSON.stringify([
      {
        insert: [
          { id: "config-editor", name: "cordis:editor" },
          { id: "settings", name: "cordis:settings" },
          {
            id: "kmh-codex-cli",
            name: "cordis:quota",
            config: { cwd: home, dataDir: join(home, "data") },
          },
        ],
      },
    ]),
  );
  await writeFile(join(dir, "cordis.yml"), "[]\n");
  const profile = {
    name: "quota",
    startedBundles: ["quota-fixture"],
    dir,
    patchPath: join(dir, "cordis.patch.yml"),
    installAnchor: join(home, "package.json"),
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  };
  let ctx;
  let liveConfig;
  async function start() {
    ctx = await boot(
      "quota",
      join(dir, "cordis.yml"),
      readProfilePatches("quota", profile),
      (ctx) => {
        ctx.provide("profileContext", profile);
        ctx.provide("appReady", {
          onReady: (fn) => {
            fn();
            return () => {};
          },
        });
        Object.assign(ctx.loader.builtins, {
          editor: ConfigEditor,
          settings: Settings,
          quota: {
            Config,
            apply: (_ctx, value) => {
              liveConfig = value;
            },
          },
        });
      },
    );
    return ctx;
  }
  try {
    await start();
  } catch (error) {
    await rm(home, { recursive: true, force: true });
    throw error;
  }
  const descriptor = () =>
    ctx.settings
      .describe({ redactSecrets: true })
      .find((row) => row.ns === "kmh-codex-cli");
  const remote = {
    describe: async () => ({
      ok: true,
      value: { writable: true, hasDocument: true, namespaces: [descriptor()] },
    }),
    mutate: async (ns, ops, revision) => {
      try {
        await ctx.settings.mutate(ns, ops, revision);
        return { ok: true, value: descriptor() };
      } catch (error) {
        return { ok: false, error: { message: error.message } };
      }
    },
  };
  return {
    home,
    profile,
    remote,
    descriptor,
    get config() {
      return liveConfig;
    },
    get ctx() {
      return ctx;
    },
    restart: async () => {
      await ctx.fiber.dispose();
      return start();
    },
    close: async () => {
      await ctx.fiber.dispose();
      await rm(home, { recursive: true, force: true });
    },
  };
}

/** 返回隔离页面 URL 与异步关闭入口；打包失败时回收临时宿主并抛出原错误。 */
export async function startBrowserHarness() {
  const fixture = await quotaHostFixture();
  const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const pkg = join(root, "packages/codex-cli");
  const primitives = join(
    root,
    "third_party/dsh/packages/client/ui-primitives",
  );
  const require = createRequire(join(primitives, "package.json"));
  let now = Date.now(),
    reads = 0,
    fail = false,
    hang = false,
    quotaHttpRequests = 0,
    signedOut = false,
    reset = false;
  const quota = new CodexQuotaService(
    fixture.ctx,
    Config({ cwd: fixture.home, dataDir: join(fixture.home, "quota") }),
    {
      now: () => now,
      connect: async () => ({
        onNotification: () => {},
        stop: async () => "clean",
        request: async (method) => {
          if (method === "account/read")
            return {
              account: signedOut
                ? null
                : { type: "chatgpt", email: null, planType: "plus" },
            };
          if (method !== "account/rateLimits/read")
            throw new Error("Fixture permits only quota reads");
          reads++;
          if (fail) throw new Error("fixture read failure");
          const window = (usedPercent, minutes) => ({
            usedPercent,
            windowDurationMins: minutes,
            resetsAt: Math.floor((reset ? now - 1 : now + 3600000) / 1000),
          });
          const main = {
            limitId: "codex",
            limitName: "Codex",
            primary: window(81, 300),
            secondary: window(50, 10080),
            credits: { hasCredits: true, unlimited: false, balance: "0" },
          };
          return {
            accountId: "fixture",
            rateLimits: main,
            rateLimitsByLimitId: {
              codex: main,
              spark: {
                limitId: "spark",
                limitName: "Spark",
                primary: window(35, 300),
                secondary: null,
              },
            },
            rateLimitResetCredits: {
              availableCount: 1,
              credits: [
                {
                  id: "gift",
                  title: "赠送重置卡",
                  description: null,
                  status: "available",
                  resetType: "weekly",
                  grantedAt: Math.floor(now / 1000),
                  expiresAt: null,
                },
              ],
            },
          };
        },
      }),
    },
  );
  const routes = new Map();
  mountWeb(
    {
      connection: {
        fetch: { register: (route) => routes.set(route.path, route) },
      },
    },
    {
      quota,
      settingsNamespace: "kmh-codex-cli",
      get config() {
        return fixture.config;
      },
    },
  );
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import {Context} from '@deepseek-ai/cordis';
import {Button} from '@deepseek-ai/dsh-client-ui-primitives';import {CodexCard} from './src/client/DetailCard.tsx';import {QuotaStore} from './src/client/quota-store.ts';import {QuotaCard} from './src/client/QuotaCard.tsx';import {QuotaDisplaySettings} from './src/client/QuotaDisplaySettings.tsx';import {ComposerQuota} from './src/client/ComposerQuota.tsx';import {zh} from './src/client/locales.ts';
import {ModelDirectory} from '@deepseek-ai/dsh-client-ui-model-selection/src/client/directory.ts';
import {ModelSelect} from '@deepseek-ai/dsh-client-ui-model-selection/src/client/ModelSelect.tsx';import {zh as modelZh} from '@deepseek-ai/dsh-client-ui-model-selection/src/client/locales.ts';
import {SettingsSchemaService} from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts';import {SettingsDescribeMirror} from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts';import {ConfigFormController} from '@deepseek-ai/dsh-client-ui-settings/src/client/config-form.ts';

const t=key=>zh[key];const mt=(key,params)=>Object.entries(params??{}).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),modelZh[key]??key);
const post=async(url,body)=>await(await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).json();
const ctx={on:()=>()=>{},remote:{settings:{describe:()=>post('/settings/describe',{}),mutate:(ns,ops,revision)=>post('/settings/mutate',{ns,ops,revision})}}};
const mirror=new SettingsDescribeMirror(ctx);const form=new ConfigFormController(ctx,{namespace:'kmh-codex-cli'},mirror,'host',new SettingsSchemaService(new Context()));ctx.configForms={get:()=>form,describe:()=>mirror};await mirror.ensure();
let clock=Date.now();const quota=new QuotaStore(undefined,()=>clock);await quota.bind(ctx);
function observable(value){const listeners=new Set();return {getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:next=>{value=next;for(const fn of listeners)fn()}}}
const groups=[{id:'codex-cli',name:'Codex CLI',models:['gpt-5','gpt-spark','gpt-reserve'].map(id=>({id,name:id}))},{id:'zcode-cli',name:'ZCode CLI',models:[{id:'gpt-5',name:'gpt-5'}]}];
const catalogValue={default:{provider:'codex-cli',model:'gpt-5'},groups,failures:[]};const catalog={store:observable({status:'ready',value:catalogValue,error:null}),load:async()=>catalogValue,reasoningFor:()=>undefined};
let rejectSelection=false;function directory(id,provider){const projected=observable({next:{provider,model:'gpt-5'}});const directory=new ModelDirectory({selectModel:async args=>{if(rejectSelection)return {ok:false,error:{code:'fixture',message:'Model change rejected'}};projected.set({next:{provider:args.provider,model:args.model}});return {ok:true,value:undefined}}},id,()=>true,catalog,projected,()=>false);return directory}
const directories=[directory('a','codex-cli'),directory('b','zcode-cli')];
function App(){const [session,setSession]=React.useState(0),[details,setDetails]=React.useState(true),[width,setWidth]=React.useState(false),[slash,setSlash]=React.useState(false);const d=directories[session];return <><nav aria-label="隔离验收控制"><Button size="sm" onClick={()=>setSession(0)}>会话 A</Button><Button size="sm" onClick={()=>setSession(1)}>会话 B</Button><Button size="sm" onClick={()=>document.body.toggleAttribute('data-ds-dark-theme')}>切换主题</Button><Button size="sm" onClick={()=>setDetails(v=>!v)}>显示详情</Button><Button size="sm" onClick={()=>setWidth(v=>!v)}>窄输入框</Button><Button size="sm" onClick={()=>{rejectSelection=!rejectSelection}}>切换失败模拟</Button>{['advance','fail','reset','account','hang'].map(action=><Button size="sm" key={action} onClick={async()=>{const result=await post('/control/'+action,{});clock=result.now;quota.reset()}}>{action}</Button>)}</nav><main>{details&&<article><header><h1>Codex CLI</h1><p>账号额度与显示设置</p></header><CodexCard view="page" quota={quota} t={t}/></article>}<section className='conversation'><h2>会话 {session===0?'A':'B'}</h2><div className="composerSurface"><textarea placeholder='输入消息；/model 打开模型选择' onChange={event=>setSlash(event.target.value==='/model')}/>{slash&&<div role='menu'>{groups.flatMap(g=>g.models.map(m=><button key={g.id+m.id} onClick={()=>{d.select({provider:g.id,model:m.id});setSlash(false)}}>{g.name} / {m.name}</button>))}</div>}<div className='composer' style={{width:width?200:420}}><ModelSelect available directory={d.store} load={()=>d.load()} select={s=>d.select(s)} t={mt}/><ComposerQuota key={session} directory={d} quota={quota} t={t} openSettings={()=>setDetails(true)}/><Button variant="primary" size="sm">发送</Button></div></div></section></main></>};createRoot(document.getElementById('root')).render(<App/>);`;
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: pkg,
      sourcefile: "quota-harness.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    outdir: "/tmp/quota-browser",
    loader: {
      ".module.css": "local-css",
      ".css": "css",
      ".woff": "dataurl",
      ".woff2": "dataurl",
      ".ttf": "dataurl",
    },
    alias: {
      react: require.resolve("react"),
      "react/jsx-runtime": require.resolve("react/jsx-runtime"),
      "react-dom": require.resolve("react-dom"),
      "react-dom/client": require.resolve("react-dom/client"),
    },
  }).catch(async (error) => {
    await fixture.close();
    throw error;
  });
  const js = result.outputFiles.find((x) => x.path.endsWith(".js")).contents;
  const css =
    result.outputFiles.find((x) => x.path.endsWith(".css"))?.contents ?? "";
  const theme = (
    await Promise.all(
      [
        "base.css",
        "corner-shape.css",
        "design-platform.css",
        "focus.css",
        "scrollbar.css",
        "gradient-shadow-text.css",
      ].map((name) =>
        readFile(
          join(
            root,
            "third_party/dsh/packages/client/ui-theme/src/styles",
            name,
          ),
          "utf8",
        ),
      ),
    )
  ).join("\n");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      if (url.pathname === "/") {
        res.setHeader("content-type", "text/html");
        res.end(
          `<!doctype html><html data-theme="light"><meta charset="utf-8"><title>Codex 额度隔离验收</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><style>
*{box-sizing:border-box}body{margin:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:13px/20px var(--dsw-font-family)}nav{display:flex;gap:8px;flex-wrap:wrap;padding:12px 24px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}main{display:grid;grid-template-columns:minmax(0,600px) minmax(0,1fr);gap:40px;max-width:1280px;margin:auto;padding:32px}article{min-width:0;display:flex;flex-direction:column;gap:20px}header{padding:0 4px 4px}h1{margin:0;font-size:20px;line-height:28px;font-weight:500}header p{margin:8px 0 0;color:var(--dsw-alias-label-secondary)}h2{font-size:14px;line-height:20px;font-weight:500;margin:0 0 16px}.conversation{min-width:0;align-self:start;position:sticky;top:24px}.composerSurface{padding:12px;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-soft)}.conversation textarea{display:block;resize:vertical;width:100%;height:120px;padding:8px;border:0;background:transparent;color:inherit;font:inherit;outline-offset:2px}.composer{display:flex;gap:8px;align-items:center;max-width:100%;margin-top:12px;justify-content:space-between}.composer>*{min-width:0}.composer>button:last-child{flex-shrink:0}@media(max-width:850px){main{grid-template-columns:1fr;padding:20px;gap:24px}.conversation{position:static;order:-1}}button{cursor:pointer}
</style><div id="root"></div><script type="module" src="/app.js"></script></html>`,
        );
        return;
      }
      if (url.pathname === "/app.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(js);
        return;
      }
      if (url.pathname === "/app.css" || url.pathname === "/theme.css") {
        res.setHeader("content-type", "text/css");
        res.end(url.pathname === "/app.css" ? css : theme);
        return;
      }
      if (url.pathname === "/api/codex-cli/status") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            account: { login: "signed-in", credentialSource: "隔离验收账号" },
            version: { ok: true, version: "fixture" },
            defaultModel: "gpt-5",
            selection: { skills: false },
            capabilities: [
              {
                id: "skills",
                label: "Codex Skills",
                description: "使用 CLI 本地技能",
                available: true,
              },
            ],
          }),
        );
        return;
      }
      if (url.pathname === "/settings/describe") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(await fixture.remote.describe()));
        return;
      }
      if (url.pathname === "/settings/mutate") {
        const value = JSON.parse(body);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify(
            await fixture.remote.mutate(value.ns, value.ops, value.revision),
          ),
        );
        return;
      }
      if (url.pathname === "/metrics") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            reads,
            quotaHttpRequests,
            hang,
            now,
            settings: fixture.descriptor().value,
          }),
        );
        return;
      }
      if (url.pathname.startsWith("/control/")) {
        const action = url.pathname.split("/").at(-1);
        if (action === "advance") now += 300001;
        if (action === "fail") fail = !fail;
        if (action === "hang") hang = !hang;
        if (action === "reset") reset = !reset;
        if (action === "account") {
          signedOut = !signedOut;
          quota.invalidate();
        }
        res.end(JSON.stringify({ now }));
        return;
      }
      const route = routes.get(url.pathname);
      if (route) {
        if (url.pathname === "/api/codex-cli/quota") {
          quotaHttpRequests++;
          if (hang) return;
        }
        const response = await route.fetch(
          new Request(url, { method: req.method }),
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
        return;
      }
      res.writeHead(404);
      res.end();
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    close: async () => {
      quota.dispose();
      const closed = new Promise((r) => server.close(r));
      server.closeAllConnections();
      await closed;
      await fixture.close();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const harness = await startBrowserHarness();
  process.stdout.write(`${harness.url}\n`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await harness.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });
}
