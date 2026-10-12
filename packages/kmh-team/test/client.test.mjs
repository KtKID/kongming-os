import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { draftSubmission } from "../lib/browser-types/src/client/draft.js";
test("feat04 场景3,6,8: only structured candidate references route members; ordinary pasted names remain ordinary", () => {
  const teamId = randomUUID(),
    roleId = randomUUID();
  const plain = draftSubmission(
    teamId,
    { text: "@Writer task", references: [] },
    randomUUID(),
  );
  assert.equal(plain.mentions.length, 0);
  const ref = {
    source: "kmh-team",
    ref: JSON.stringify({ kind: "member", roleId }),
    offset: 0,
    length: 7,
    label: "Writer",
    clipboardText: "@Writer",
  };
  assert.equal(
    draftSubmission(
      teamId,
      { text: "@Writer task", references: [ref] },
      randomUUID(),
    ).mentions[0].actor.roleId,
    roleId,
  );
  assert.throws(
    () =>
      draftSubmission(
        teamId,
        { text: "@Writer task", references: [{ ...ref, invalid: true }] },
        randomUUID(),
      ),
    /mention-invalid/,
  );
});
