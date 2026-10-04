/** Native-format encrypted account records owned by the plugin. */
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { createZCodeCredentialCipher } from "../vendor/zcode/credential-cipher.ts";

const record = z.record(z.string(), z.string());
const apiKeySuffix = ":api-key";
/** Authenticated account facts; apiKey remains within the Host process. */
export interface Account {
  identity: string;
  apiKey: string;
  /** Which credential file satisfied the read; desktop reads stay read-only. */
  source: "plugin" | "desktop";
}
/** Overrides for account lookup; defaults borrow the official desktop login. */
export interface ReadAccountOptions {
  desktopFile?: string;
}
function desktopCredentialFile(): string {
  return join(homedir(), ".zcode/v2/credentials.json");
}
function desktopPlanId(providerId: string): string {
  // Desktop key names carry the bare plan id, plugin files the full provider id.
  return providerId.startsWith("account:")
    ? providerId.slice("account:".length)
    : providerId;
}
function apiKeyPrefixes(providerId: string): string[] {
  return [
    `account-provider:coding-plan:account:${desktopPlanId(providerId)}:account:`,
    `account-provider:coding-plan:${providerId}:account:`,
  ];
}
function decryptStoredAccount(
  stored: Record<string, string>,
  providerId: string,
  env: NodeJS.ProcessEnv,
  source: Account["source"],
): Account {
  const cipher = createZCodeCredentialCipher({ env });
  const identityRaw = stored[`account-provider:${providerId}:identity`];
  const identity =
    identityRaw === undefined
      ? identityFromApiKeyKeys(stored, providerId)
      : cipher.decrypt(identityRaw);
  const key = apiKeyPrefixes(providerId)
    .map(
      (prefix) => stored[prefix + encodeURIComponent(identity) + apiKeySuffix],
    )
    .find((value) => value !== undefined);
  if (key === undefined) throw new Error("Invalid credential");
  const apiKey = cipher.decrypt(key).trim();
  if (!apiKey || /[^\x21-\x7e]/.test(apiKey))
    throw new Error("Invalid credential");
  return { identity, apiKey, source };
}
/** Desktop and plugin files embed the account identity inside the api-key key name. */
function identityFromApiKeyKeys(
  stored: Record<string, string>,
  providerId: string,
): string {
  for (const prefix of apiKeyPrefixes(providerId))
    for (const name of Object.keys(stored))
      if (name.startsWith(prefix) && name.endsWith(apiKeySuffix))
        return decodeURIComponent(
          name.slice(prefix.length, name.length - apiKeySuffix.length),
        );
  throw new Error("Invalid credential");
}
/**
 * Borrow the official desktop login without modifying it.
 * @param providerId - Official account provider identifier.
 * @param env - Cipher environment shared with the CLI.
 * @param options - Desktop credential location override.
 * @returns Account identity and key, or undefined for an unusable desktop login.
 */
async function readDesktopAccount(
  providerId: string,
  env: NodeJS.ProcessEnv,
  options: ReadAccountOptions,
): Promise<Account | undefined> {
  try {
    const stored = record.parse(
      JSON.parse(
        await readFile(options.desktopFile ?? desktopCredentialFile(), "utf8"),
      ),
    );
    const account = decryptStoredAccount(stored, providerId, env, "desktop");
    return account;
  } catch {
    // Any desktop-file gap, format drift, or key mismatch reports as signed out.
    return undefined;
  }
}
/**
 * Read the native encrypted account-provider record without modifying it.
 * A missing plugin record borrows the official desktop login read-only.
 * @param dataDir - Plugin-owned ZCode data base directory.
 * @param providerId - Official account provider identifier.
 * @param env - Cipher environment also passed to the CLI.
 * @param options - Desktop credential location override.
 * @returns Account identity and key, or undefined for a missing login.
 */
export async function readAccount(
  dataDir: string,
  providerId: string,
  env: NodeJS.ProcessEnv,
  options: ReadAccountOptions = {},
): Promise<Account | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dataDir, ".zcode/v2/credentials.json"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return readDesktopAccount(providerId, env, options);
    throw new Error("ZCODE_CREDENTIAL_READ_FAILED");
  }
  try {
    return decryptStoredAccount(
      record.parse(JSON.parse(raw)),
      providerId,
      env,
      "plugin",
    );
  } catch (error) {
    // Native file and decryption failures are reported without carrying credential values.
    void error;
    throw new Error("ZCODE_CREDENTIAL_INVALID");
  }
}

/**
 * Save the bridge's account in native encrypted format with an atomic replacement.
 * @param dataDir - Plugin-owned storage, also supplied to official CLI logout.
 * @param providerId - Official provider identity.
 * @param account - Host-only identity and Coding Plan key.
 * @param env - Native cipher environment.
 * @param signal - Cancellation checked before replacing the file.
 */
export async function saveAccount(
  dataDir: string,
  providerId: string,
  account: Omit<Account, "source">,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<void> {
  const directory = join(dataDir, ".zcode/v2");
  const file = join(directory, "credentials.json");
  let stored: Record<string, string> = {};
  try {
    stored = record.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("ZCODE_CREDENTIAL_INVALID");
  }
  signal.throwIfAborted();
  const cipher = createZCodeCredentialCipher({ env });
  stored[`account-provider:${providerId}:identity`] = cipher.encrypt(
    account.identity,
  );
  stored[
    `account-provider:coding-plan:${providerId}:account:${encodeURIComponent(account.identity)}:api-key`
  ] = cipher.encrypt(account.apiKey);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.credentials-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(stored), {
      mode: 0o600,
      flag: "wx",
    });
    signal.throwIfAborted();
    renameSync(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
