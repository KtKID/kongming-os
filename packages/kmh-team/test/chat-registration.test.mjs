import test from "node:test";
import assert from "node:assert/strict";
import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots";
import { registerTeamChat } from "../lib/browser-types/src/client/chat.js";

test("团队适配复用宿主 renderer，普通用户输入保持原组件，释放后恢复原注册", () => {
  const slots = new SlotCore();
  slots.register(
    {
      name: "root",
      children: {
        "conversation.chat.node": { kind: "keyed", scope: "session" },
      },
    },
    () => null,
  );
  const NativeUser = () => null;
  const NativeAssistant = () => null;
  const presentation = { hooks: { presentation: {} } };
  slots.register(
    { name: "conversation.chat.node", key: "user", locale: "chat" },
    NativeUser,
  );
  slots.register(
    {
      name: "conversation.chat.node",
      key: "assistant-step",
      locale: "chat",
      inject: () => presentation,
    },
    NativeAssistant,
  );
  const dispose = registerTeamChat({
    slots,
    locale: { bind: () => (key) => key },
  });
  const entry = (key) =>
    slots
      .entriesOfSlot("conversation.chat.node")
      .find((e) => e.options.key === key);
  const wrapped = entry("user").component;
  const props = {
    node: { data: { source: { kind: "user" } } },
    useProjection: () => null,
  };
  assert.equal(wrapped(props).type, NativeUser);
  assert.equal(
    wrapped({ ...props, useProjection: () => ({ members: [] }) }),
    null,
  );
  assert.equal(
    wrapped({
      ...props,
      node: { data: { source: { kind: "kmh-team-public" } } },
      useProjection: () => ({ members: [] }),
    }).type,
    NativeUser,
  );
  const memberEntry = entry("kmh-team-member");
  assert.equal(memberEntry.inject(), presentation);
  const reply = memberEntry.component({
    node: {
      kind: "kmh-team-member",
      data: {
        actor: { kind: "member", roleId: "role" },
        body: "## 完整正文",
        outcome: "completed",
        time: 1,
      },
    },
    useProjection: () => ({ members: [{ roleId: "role", name: "开发者" }] }),
  });
  assert.equal(reply.props.children[1].type, NativeAssistant);
  assert.equal(reply.props.children[1].props.node.kind, "assistant-step");
  assert.equal(
    reply.props.children[1].props.node.data.blocks[0].text,
    "## 完整正文",
  );
  dispose();
  assert.equal(entry("user").component, NativeUser);
  assert.equal(entry("kmh-team-member"), undefined);
});
