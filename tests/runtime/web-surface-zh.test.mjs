import test from "node:test";
import assert from "node:assert/strict";
import { replaceWebSurface } from "../../packages/web-surface-zh/lib/index.js";

/** web-app 原版 web-surface 文案的最小样本（首句含地址）。 */
const upstreamText =
  "You are interacting with the user through the DeepSeek Harness Web GUI at http://127.0.0.1:3080. " +
  "When the user refers to \"this page\", they mean this GUI.";

test("replaces the web-surface section and backfills the url placeholder", () => {
  const sections = [
    { name: "harness:identity", text: "You are an AI agent." },
    { name: "app:web-surface", text: upstreamText },
  ];
  const result = replaceWebSurface(sections, "你正在通过 {url} 的界面与用户交互。");
  assert.equal(result.replaced, true);
  assert.equal(result.url, "http://127.0.0.1:3080");
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0]?.name, "harness:identity");
  const replaced = result.sections[1];
  assert.equal(replaced?.name, "app:web-surface");
  assert.equal(replaced?.text, "你正在通过 http://127.0.0.1:3080 的界面与用户交互。");
});

test("keeps other section fields such as interpolate", () => {
  const sections = [
    { name: "app:web-surface", text: upstreamText, interpolate: false },
  ];
  const result = replaceWebSurface(sections, "{url}");
  const replaced = result.sections[0];
  assert.equal(replaced?.interpolate, false);
  assert.equal(replaced?.text, "http://127.0.0.1:3080");
});

test("returns sections unchanged when the target section is absent", () => {
  const sections = [{ name: "harness:identity", text: "identity" }];
  const result = replaceWebSurface(sections, "文案");
  assert.equal(result.replaced, false);
  assert.equal(result.url, undefined);
  assert.deepEqual(result.sections, sections);
});

test("returns sections unchanged when the target text carries no url", () => {
  const sections = [{ name: "app:web-surface", text: "no address here" }];
  const result = replaceWebSurface(sections, "文案");
  assert.equal(result.replaced, false);
  assert.equal(result.sections[0]?.text, "no address here");
});

test("fills every placeholder occurrence in a custom template", () => {
  const sections = [{ name: "app:web-surface", text: upstreamText }];
  const result = replaceWebSurface(sections, "地址 {url}，再说一次 {url}。");
  assert.equal(result.sections[0]?.text, "地址 http://127.0.0.1:3080，再说一次 http://127.0.0.1:3080。");
});

test("strips trailing punctuation from the extracted address", () => {
  const sections = [
    { name: "app:web-surface", text: "GUI at https://example.local:8443/. Then more text." },
  ];
  const result = replaceWebSurface(sections, "{url}");
  assert.equal(result.url, "https://example.local:8443/");
});
