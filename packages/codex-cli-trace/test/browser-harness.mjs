/** 仅供本机浏览器验收：使用真实组件、主题与文件读取器，数据为隔离 fixture。 */
import { createServer } from "node:http";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fixture, encode, sampleRecords } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
import { mountRoutes } from "../lib/src/web.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pkg = join(root, "packages/codex-cli-trace");
const cleanup = [];
const f = await fixture({
  after(fn) {
    cleanup.push(fn);
  },
});
const r = new TraceReader(f);
let faults = { snapshot: false, entry: false, export: false };
let requests = 0;
let delay = false;
let releaseDelay = () => {};
const routes = new Map();
const dispose = mountRoutes(
  {
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route);
          return async () => {
            routes.delete(route.path);
          };
        },
      },
    },
  },
  r,
);
const require = createRequire(join(pkg, "package.json"));
const primitives = join(root, "third_party/dsh/packages/client/ui-primitives");
const react = require.resolve("react");
const reactDom = createRequire(join(primitives, "package.json")).resolve(
  "react-dom/client",
);
const out = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from ${JSON.stringify(reactDom)};import {TraceView,TraceToast} from ${JSON.stringify(join(pkg, "src/client/TraceView.tsx"))};import {zh} from ${JSON.stringify(join(pkg, "src/client/locales.ts"))};const t=(key)=>zh[key];function App(){const [session,setSession]=React.useState('session-a'),[shown,setShown]=React.useState(true);return <><nav><button onClick={()=>setSession('session-a')}>会话 A</button><button onClick={()=>setSession('unlinked')}>空会话 B</button><button onClick={()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'}>切换测试主题</button><button onClick={()=>setShown(v=>!v)}>装卸视图</button>{['entry','snapshot','export','append','reset','truncate','delay'].map(action=><button key={action} onClick={()=>fetch('/control/'+action,{method:'POST'})}>{action}</button>)}</nav><main>{shown&&<TraceView sessionId={session} t={t}/>}</main><TraceToast/></>};createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: pkg,
    sourcefile: "trace-harness.tsx",
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  outdir: "/tmp/trace-browser-bundle",
  loader: { ".module.css": "local-css", ".css": "css" },
  alias: { react, "react/jsx-runtime": require.resolve("react/jsx-runtime") },
  plugins: [
    {
      name: "public-atoms",
      setup(b) {
        b.onResolve(
          { filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ },
          () => ({ path: "atoms", namespace: "trace" }),
        );
        b.onLoad({ filter: /.*/, namespace: "trace" }, () => ({
          contents: `export {Button} from ${JSON.stringify(join(primitives, "src/Button.tsx"))};export {Toast} from ${JSON.stringify(join(primitives, "src/Toast.tsx"))};`,
          resolveDir: pkg,
        }));
      },
    },
  ],
});
const js = out.outputFiles.find((x) => x.path.endsWith(".js")).contents;
const css =
  out.outputFiles.find((x) => x.path.endsWith(".css"))?.contents ?? "";
const theme = await readFile(
  join(
    root,
    "third_party/dsh/packages/client/ui-theme/src/styles/design-platform.css",
  ),
);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><html data-theme="dark"><meta charset="utf-8"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:system-ui}nav{display:flex;flex-wrap:wrap;gap:8px;padding:8px;height:60px}main{height:calc(100vh - 76px)}</style><div id="root"></div><script src="/app.js"></script></html>',
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
      res.end(url.pathname === "/theme.css" ? theme : css);
      return;
    }
    if (url.pathname.startsWith("/control/")) {
      const action = url.pathname.split("/").at(-1);
      if (action === "delay") {
        delay = !delay;
        if (!delay) releaseDelay();
      }
      if (action in faults) faults[action] = !faults[action];
      if (action === "append")
        await f.append(
          encode([
            {
              type: "response_item",
              payload: {
                type: "message",
                id: "new-" + Date.now(),
                role: "assistant",
                content: [{ text: "这是追加的新记录" }],
                internal_chat_message_metadata_passthrough: {
                  turn_id: "turn-b",
                },
              },
            },
          ]),
        );
      if (action === "truncate") await writeFile(f.file, "changed");
      if (action === "reset") {
        await writeFile(f.file, encode(sampleRecords()));
        faults = { snapshot: false, entry: false, export: false };
      }
      res.end("ok");
      return;
    }
    if (url.pathname === "/stats") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ requests, ...r.diagnostics }));
      return;
    }
    const route = routes.get(url.pathname);
    if (route) {
      requests++;
      if (
        delay &&
        url.searchParams.get("sessionId") === "session-a" &&
        url.pathname.endsWith("/snapshot")
      )
        await new Promise((resolve) => (releaseDelay = resolve));
      const action = url.pathname.split("/").at(-1);
      if (faults[action]) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "TEST_READ_FAILURE",
            reason: "测试：本次读取失败",
          }),
        );
        return;
      }
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const response = await route.fetch(
        new Request("http://127.0.0.1" + req.url, { signal: abort.signal }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        for await (const bytes of response.body) {
          if (!res.write(bytes))
            await new Promise((resolve) => res.once("drain", resolve));
        }
      }
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.destroy(e);
  }
});
server.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ port: server.address().port, dir: f.dir }));
});
async function stop() {
  await dispose();
  await r.dispose();
  server.close();
  await Promise.all(cleanup.map((fn) => fn()));
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
