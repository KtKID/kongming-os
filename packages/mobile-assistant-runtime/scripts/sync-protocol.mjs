/** 从唯一 Zod 源生成三端协议及状态目录；--check 比较产物并对漂移返回失败。 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { z } from "zod";
import { taskContracts } from "../lib/protocol.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootIndex = process.argv.indexOf("--harmony-root");
if (rootIndex < 0 || !process.argv[rootIndex + 1])
  throw new Error("必须指定 --harmony-root <Harmony绝对路径>");
const harmonyRoot = resolve(process.argv[rootIndex + 1]);
const check = process.argv.includes("--check");
const source = await readFile(join(packageRoot, "src/protocol.ts"), "utf8");
const digest = createHash("sha256").update(source).digest("hex");
const requireGateway = createRequire(
  join(harmonyRoot, "xiaoyi2agent-server/package.json"),
);
const importedPrettier = await import(
  pathToFileURL(requireGateway.resolve("prettier")).href
);
const prettier = importedPrettier.default ?? importedPrettier;
const header = `// 自动生成，修改唯一源 packages/mobile-assistant-runtime/src/protocol.ts 后重新生成。\n// 源 SHA-256: ${digest}\n`;
const schemas = Object.fromEntries(
  Object.entries(taskContracts).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { io: "input" }),
  ]),
);
const definitions = new Map();
const cache = new Map();
let serial = 0;
const clean = (schema) => {
  const { $schema, description, ...rest } = schema;
  return rest;
};
const key = (schema) => JSON.stringify(clean(schema));
const label = (value) => value.replace(/[^a-zA-Z0-9]/g, "_");
function register(schema, preferred) {
  const id = key(schema);
  if (cache.has(id)) return cache.get(id);
  let name = label(preferred);
  while (definitions.has(name)) name = label(preferred) + ++serial;
  cache.set(id, name);
  definitions.set(name, schema);
  return name;
}
for (const [name, schema] of Object.entries(schemas)) register(schema, name);
function typeFor(schema, preferred) {
  if (schema.$ref) throw new Error("生成器拒绝未展开引用：" + schema.$ref);
  if (schema.const !== undefined)
    return typeof schema.const === "string"
      ? JSON.stringify(schema.const)
      : typeof schema.const;
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  const alternatives =
    schema.anyOf ??
    schema.oneOf ??
    (Array.isArray(schema.type)
      ? schema.type.map((type) => ({ type }))
      : undefined);
  if (alternatives)
    return alternatives
      .map((part, i) => typeFor(part, preferred + "Case" + i))
      .join(" | ");
  if (schema.type === "object") return register(schema, preferred);
  if (schema.type === "array")
    return "(" + typeFor(schema.items, preferred + "Item") + ")[]";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (
    schema.type === "string" ||
    schema.type === "boolean" ||
    schema.type === "null"
  )
    return schema.type;
  throw new Error("未覆盖的协议类型：" + JSON.stringify(schema));
}
function expression(schema, variable, preferred) {
  if (schema.const !== undefined)
    return `${variable} === ${JSON.stringify(schema.const)}`;
  if (schema.enum)
    return (
      "(" +
      schema.enum
        .map((v) => `${variable} === ${JSON.stringify(v)}`)
        .join(" || ") +
      ")"
    );
  const alternatives =
    schema.anyOf ??
    schema.oneOf ??
    (Array.isArray(schema.type)
      ? schema.type.map((type) => ({ type }))
      : undefined);
  if (alternatives)
    return (
      "(" +
      alternatives
        .map((part, i) => expression(part, variable, preferred + "Case" + i))
        .join(" || ") +
      ")"
    );
  if (schema.type === "object")
    return `check${register(schema, preferred)}(${variable})`;
  if (schema.type === "array") {
    const arr = `(${variable} as Object[])`;
    return `(Array.isArray(${variable}) && ${arr}.every((entry: Object) => ${expression(schema.items, "entry", preferred + "Item")}))`;
  }
  if (schema.type === "null") return `${variable} === null`;
  const checks = [
    `typeof ${variable} === '${schema.type === "integer" ? "number" : schema.type}'`,
  ];
  if (schema.type === "number" || schema.type === "integer") {
    checks.push(`Number.isFinite(${variable} as number)`);
    if (schema.type === "integer")
      checks.push(`Number.isInteger(${variable} as number)`);
    if (schema.minimum !== undefined)
      checks.push(`(${variable} as number) >= ${schema.minimum}`);
    if (schema.exclusiveMinimum !== undefined)
      checks.push(`(${variable} as number) > ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined)
      checks.push(`(${variable} as number) < ${schema.exclusiveMaximum}`);
    if (schema.maximum !== undefined)
      checks.push(`(${variable} as number) <= ${schema.maximum}`);
  }
  if (schema.type === "string") {
    if (schema.minLength !== undefined)
      checks.push(`(${variable} as string).length >= ${schema.minLength}`);
    if (schema.maxLength !== undefined)
      checks.push(`(${variable} as string).length <= ${schema.maxLength}`);
  }
  return "(" + checks.join(" && ") + ")";
}
let ets =
  header +
  "// JSON 先作为待校验载体读取；每个字段通过生成的检查后才作为协议对象返回。\n";
// 遍历过程中登记子对象，Map 的迭代同时覆盖新发现的定义。
for (const [name, schema] of definitions) {
  const description = (schema.description ?? "").replaceAll("*/", "* /");
  if (description) ets += `\n/** ${description} */\n`;
  if (schema.type === "object") {
    ets += `export interface ${name} {\n`;
    const required = new Set(schema.required ?? []);
    for (const [field, child] of Object.entries(schema.properties ?? {}))
      ets += `  ${field}${required.has(field) ? "" : "?"}: ${typeFor(child, name + label(field))};\n`;
    ets += "}\n";
  } else ets += `export type ${name} = ${typeFor(schema, name + "Value")};\n`;
}
for (const [name, schema] of definitions) {
  let body;
  if (schema.type === "object") {
    const required = new Set(schema.required ?? []);
    const checks = [
      `typeof value === 'object'`,
      "value !== null",
      "!Array.isArray(value)",
    ];
    for (const [field, child] of Object.entries(schema.properties ?? {})) {
      const carrier = `(value as ${name}).${field}`;
      const validation = expression(child, carrier, name + label(field));
      checks.push(
        required.has(field)
          ? validation
          : `(${carrier} === undefined || ${validation})`,
      );
    }
    body = checks.join(" && ");
  } else body = expression(schema, "value", name + "Value");
  ets += `\nexport function check${name}(value: Object | null | undefined): boolean { return ${body}; }\n`;
  ets += `export function parse${name}(raw: string): ${name} | null {\n let carrier: Object | null = null;\n try { carrier = JSON.parse(raw) as Object; } catch (error) { return null; }\n if (!check${name}(carrier)) return null;\n return carrier as ${name};\n}\n`;
}
// 同结构根 schema 也保留公开名称。
for (const [name, schema] of Object.entries(schemas)) {
  const actual = cache.get(key(schema));
  if (actual !== name)
    ets += `\nexport type ${name} = ${actual};\nexport function check${name}(value: Object | null | undefined): boolean { return check${actual}(value); }\nexport function parse${name}(raw: string): ${name} | null { return parse${actual}(raw); }\n`;
}
const document =
  "# 任务状态协议 · 自动生成目录\n\n> 唯一源：KMH packages/mobile-assistant-runtime/src/protocol.ts\n> SHA-256：`" +
  digest +
  "`\n\n" +
  Object.entries(schemas)
    .map(
      ([name, schema]) =>
        `## ${name}\n\n${schema.description ?? "协议结构"}\n\n\`\`\`json\n${JSON.stringify(clean(schema), null, 2)}\n\`\`\`\n`,
    )
    .join("\n");
const targets = [
  [
    join(
      harmonyRoot,
      "xiaoyi2agent-server/src/protocol/task-state.generated.ts",
    ),
    header + source,
    {
      parser: "typescript",
      singleQuote: true,
      printWidth: 100,
      trailingComma: "all",
    },
  ],
  [
    join(
      harmonyRoot,
      "xiaoyi_e2e/entry/src/main/ets/a2a/generated/TaskProtocol.ets",
    ),
    ets,
    { parser: "typescript", singleQuote: true, printWidth: 100 },
  ],
  [
    join(
      harmonyRoot,
      "docs/spec/usagi-task-state-recovery/state-catalog.generated.md",
    ),
    document,
    { parser: "markdown" },
  ],
];
for (const [file, body, options] of targets) {
  const text = await prettier.format(body, options);
  if (check) {
    if ((await readFile(file, "utf8")) !== text)
      throw new Error("协议生成物漂移：" + file);
  } else {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}
process.stdout.write(
  JSON.stringify({
    check,
    sourceSha256: digest,
    schemas: Object.keys(schemas).length,
    generatedFiles: targets.length,
  }) + "\n",
);
