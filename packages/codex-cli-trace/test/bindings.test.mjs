import test from "node:test";
import assert from "node:assert/strict";
import {
  writeFile,
  readFile,
  copyFile,
  symlink,
  mkdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
test("T01 T04 empty binding is independent and read-only", async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.bindingsFile);
  const r = new TraceReader(f);
  t.after(() => r.dispose?.());
  assert.equal((await r.snapshot("absent")).state, "unlinked");
  assert.deepEqual(await readFile(f.bindingsFile), before);
});
test("T04 bad binding and mismatched native header reject attribution", async (t) => {
  const f = await fixture(t);
  const r = new TraceReader(f);
  t.after(() => r.dispose?.());
  await writeFile(f.bindingsFile, "{bad");
  await assert.rejects(() => r.snapshot(f.sessionId), /BINDING/);
  await writeFile(
    f.bindingsFile,
    JSON.stringify({ "session-a": { threadId: "native-a" } }),
  );
  await writeFile(
    f.file,
    JSON.stringify({ type: "session_meta", payload: { id: "foreign" } }) + "\n",
  );
  await assert.rejects(() => r.snapshot(f.sessionId), /SOURCE_MISMATCH/);
});
test("T04 multiple candidates and escaping symbolic links are rejected", async (t) => {
  const f = await fixture(t);
  const folder = join(f.codexHome, "archived_sessions");
  await mkdir(folder);
  await copyFile(f.file, join(folder, "rollout-second-native-a.jsonl"));
  const r = new TraceReader(f);
  t.after(() => r.dispose?.());
  await assert.rejects(() => r.snapshot(f.sessionId), /SOURCE_AMBIGUOUS/);
});

test("T04 file symbolic link outside configured CLI root rejects source", async (t) => {
  const f = await fixture(t);
  const outside = join(f.dir, "outside.jsonl");
  await copyFile(f.file, outside);
  await rm(f.file);
  await symlink(outside, f.file);
  const r = new TraceReader(f);
  t.after(() => r.dispose());
  await assert.rejects(() => r.snapshot(f.sessionId), /SOURCE_MISMATCH/);
});
