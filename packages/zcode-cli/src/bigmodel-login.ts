/** BigModel account bridge follows the official CLI OAuth and Coding Plan resolver protocols. */
import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { authorizeUrl } from "./authorize-url.ts";
import type { Account } from "./account.ts";

const envelope = z.object({
  code: z.union([z.string(), z.number()]).nullish(),
  data: z.unknown(),
});
const initData = z.object({
  flow_id: z.string().min(1),
  authorize_url: z.string(),
  expires_at: z.number().finite(),
  poll_interval_sec: z.number().finite().min(1),
});
const pollData = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("failed") }),
  z.object({
    status: z.literal("ready"),
    user: z.object({ user_id: z.string().min(1) }),
    bigmodel: z.object({
      access_token: z.string().min(1).optional(),
      accessToken: z.string().min(1).optional(),
    }),
  }),
]);
const customerData = z.object({
  organizations: z.array(
    z.object({
      organizationId: z.string().min(1),
      organizationName: z.string().optional(),
      projects: z.array(
        z.object({
          projectId: z.string().min(1),
          projectName: z.string().optional(),
        }),
      ),
    }),
  ),
});
const keyData = z.object({
  apiKey: z.string().min(1),
  name: z.string().optional(),
});
const apiOrigin = "https://zcode.z.ai/api/v1";
const businessOrigin = "https://bigmodel.cn";

async function request(
  url: string,
  authorization: string,
  signal: AbortSignal,
  body?: object,
): Promise<unknown> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("ZCODE_LOGIN_FAILED");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("ZCODE_LOGIN_FAILED");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = z.instanceof(Uint8Array).parse(chunk.value);
      bytes += value.byteLength;
      if (bytes > 65536) throw new Error("ZCODE_LOGIN_OUTPUT_LIMIT");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const result = envelope.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  if (![undefined, null, 0, 200, "0", "200"].includes(result.code))
    throw new Error("ZCODE_LOGIN_FAILED");
  return result.data;
}

async function resolveApiKey(
  accessToken: string,
  signal: AbortSignal,
): Promise<string> {
  const customer = customerData.parse(
    await request(
      `${businessOrigin}/api/biz/customer/getCustomerInfo`,
      accessToken,
      signal,
    ),
  );
  const org =
    customer.organizations.find((x) =>
      x.organizationName?.includes("默认机构"),
    ) ?? customer.organizations[0];
  const project =
    org?.projects.find((x) => x.projectName?.includes("默认项目")) ??
    org?.projects[0];
  if (!org || !project) throw new Error("ZCODE_LOGIN_FAILED");
  const listUrl = `${businessOrigin}/api/biz/v1/organization/${encodeURIComponent(org.organizationId)}/projects/${encodeURIComponent(project.projectId)}/api_keys`;
  const keys = z
    .array(keyData)
    .parse(await request(listUrl, accessToken, signal));
  const key =
    keys.find((x) => x.name === "zcode-api-key") ??
    keyData.parse(
      await request(listUrl, accessToken, signal, { name: "zcode-api-key" }),
    );
  const secret = z
    .object({ secretKey: z.string().optional() })
    .parse(
      await request(
        `${listUrl}/copy/${encodeURIComponent(key.apiKey)}`,
        accessToken,
        signal,
      ),
    );
  return secret.secretKey?.trim()
    ? `${key.apiKey}.${secret.secretKey.trim()}`
    : key.apiKey;
}

/**
 * Initialize and poll official BigModel login, then resolve the official Coding Plan key.
 * @param signal - Cancel, unload or configured login deadline.
 * @param onAuthorize - Publish the validated full official authorization URL.
 * @returns Host-only account identity and API key; abort prevents a late result.
 */
export async function loginBigModel(
  signal: AbortSignal,
  onAuthorize: (url: string) => void,
): Promise<Account> {
  const bearer = `Bearer ${randomBytes(32).toString("hex")}`;
  const init = initData.parse(
    await request(`${apiOrigin}/oauth/cli/init`, bearer, signal, {
      provider: "bigmodel",
    }),
  );
  const expiryMs = init.expires_at * 1000 - Date.now();
  if (expiryMs <= 0 || expiryMs > 2147483647)
    throw new Error("ZCODE_LOGIN_TIMEOUT");
  const range = AbortSignal.any([signal, AbortSignal.timeout(expiryMs)]);
  const url = authorizeUrl(init.authorize_url);
  if (url.origin !== businessOrigin)
    throw new Error("ZCODE_AUTHORIZE_URL_INVALID");
  range.throwIfAborted();
  onAuthorize(url.href);
  try {
    for (;;) {
      const poll = pollData.parse(
        await request(
          `${apiOrigin}/oauth/cli/poll/${encodeURIComponent(init.flow_id)}`,
          bearer,
          range,
        ),
      );
      if (poll.status === "failed") throw new Error("ZCODE_LOGIN_FAILED");
      if (poll.status === "ready") {
        const accessToken =
          poll.bigmodel.access_token ?? poll.bigmodel.accessToken;
        if (!accessToken) throw new Error("ZCODE_LOGIN_FAILED");
        const apiKey = await resolveApiKey(accessToken, range);
        range.throwIfAborted();
        return { identity: poll.user.user_id, apiKey, source: "plugin" };
      }
      await setTimeout(init.poll_interval_sec * 1000, undefined, {
        signal: range,
      });
    }
  } catch (error) {
    if (range.aborted && !signal.aborted)
      throw new Error("ZCODE_LOGIN_TIMEOUT");
    throw error;
  }
}
