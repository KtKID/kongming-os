/**
 * kmh-infra 的暗号自取：插件在挂载与配置变更时自己解析暗号取值，而不是
 * 要求 Web 服务的启动环境预先备好——服务怎么启动、何时重启都与暗号无关，
 * 暗号轮换也不需要重启服务。
 *
 * 解析顺序：先以登录交互 shell 模拟用户终端会话，读取 tokenEnvVar 指定的
 * 变量（暗号的真实存放处，与 x-dash 从同一份 shell 配置取值）；取不到再
 * 回退 KMH 进程环境（兼容从带暗号的环境启动的部署）。暗号取值只在内存
 * 与查询子进程环境里存在，不写入任何文件，也不进入日志与错误消息。
 */
import { spawn } from "node:child_process";

/** shell 取值等待上限：用户 shell 配置挂起或大量输出时的护栏，不是功能性阈值。 */
export const SHELL_FETCH_TIMEOUT_MS = 5000;

/** shell 取值输出上限：超出即判定为异常输出并放弃，防止病态配置无限吐字符。 */
const MAX_FETCH_OUTPUT_BYTES = 65536;

/** 环境变量名的合法字符：字母数字下划线；其他字符不得拼进 shell 命令。 */
const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** 暗号解析结果：token 是取值（取不到为 undefined），source 记录来源供日志说明。 */
export interface TokenResolution {
  token: string | undefined;
  source: "shell" | "env" | "absent";
}

/** 判断名字是否是可以安全拼进 shell 命令的环境变量名。 */
export function isValidEnvVarName(name: string): boolean {
  return ENV_VAR_NAME_PATTERN.test(name);
}

/**
 * 以登录交互 shell 读取变量的当前取值（模拟用户终端会话，加载 .zshenv、
 * 登录配置与 rc 文件）。
 * @param varName - 要读取的环境变量名（调用方先校验合法性）。
 * @param shell - 用户 shell 可执行文件路径（通常来自 SHELL 环境变量）。
 * @param timeoutMs - 等待上限，超时按取不到处理。
 * @returns 变量取值（stdout 最后一个非空行，吸收 rc 文件的杂音输出）；
 *   启动失败、非零退出、超时、输出超限都返回 undefined，绝不抛错。
 */
export function fetchTokenFromShellProfile(
  varName: string,
  shell: string,
  timeoutMs: number = SHELL_FETCH_TIMEOUT_MS,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(shell, ["-lic", `printf %s "$${varName}"`], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve(undefined);
      return;
    }
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > MAX_FETCH_OUTPUT_BYTES) {
        child.kill("SIGKILL");
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      const lines = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      resolve(lines.length > 0 ? lines[lines.length - 1] : undefined);
    });
  });
}

/**
 * 解析暗号：用户 shell 配置优先，KMH 进程环境后备，两者都取不到时 token
 * 为 undefined（source 为 absent）。
 * @param varName - 配置里填的变量名；为空或非法时不做 shell 取值，只查进程环境。
 * @param env - 进程环境（后备来源，也是 shell 路径 SHELL 的来源）。
 * @param fetcher - shell 取值函数；缺省用真实实现，测试注入替身。
 * @returns 解析结果；本函数不抛错，任何失败都归入 absent。
 */
export async function resolveToken(
  varName: string,
  env: Record<string, string | undefined>,
  fetcher: (
    varName: string,
    shell: string,
  ) => Promise<string | undefined> = fetchTokenFromShellProfile,
): Promise<TokenResolution> {
  if (
    varName !== "" &&
    isValidEnvVarName(varName) &&
    typeof env.SHELL === "string" &&
    env.SHELL !== ""
  ) {
    const fromShell = await fetcher(varName, env.SHELL);
    if (fromShell !== undefined && fromShell !== "") {
      return { token: fromShell, source: "shell" };
    }
  }
  const fromEnv = varName === "" ? undefined : env[varName];
  if (fromEnv !== undefined && fromEnv !== "") {
    return { token: fromEnv, source: "env" };
  }
  return { token: undefined, source: "absent" };
}
