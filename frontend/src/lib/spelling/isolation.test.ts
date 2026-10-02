import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const spellingDirectory = resolve(root, "frontend/src/lib/spelling");

const allowed = (file: string): boolean => (
  file.startsWith(`${spellingDirectory}${sep}`)
  || file === resolve(root, "frontend/src/pages/SpellingPage.tsx")
  || file === resolve(root, "frontend/src/routes/spelling.tsx")
  || file.startsWith(`${resolve(root, "frontend/src/features/spelling")}${sep}`)
  || file.startsWith(`${resolve(root, "taro-spike-2/src/study/spelling")}${sep}`)
);

/** Parse imports rather than matching text: comments and fixture strings are not dependencies. */
const moduleReferences = (source: string): string[] => {
  const references: string[] = [];
  const add = (node?: ts.Node) => {
    if (node && ts.isStringLiteralLike(node)) references.push(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const requireCall = ts.isIdentifier(callee) && callee.text === "require";
      const requireResolve = ts.isPropertyAccessExpression(callee)
        && ts.isIdentifier(callee.expression) && callee.expression.text === "require" && callee.name.text === "resolve";
      if (callee.kind === ts.SyntaxKind.ImportKeyword || requireCall || requireResolve) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true));
  return references;
};

const spellingReferences = (source: string, file: string): string[] => moduleReferences(source).filter((reference) => {
  if (!reference.startsWith(".")) return false;
  const target = resolve(dirname(file), reference.replace(/[?#].*$/u, ""));
  return target === spellingDirectory || target.startsWith(`${spellingDirectory}${sep}`);
});

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = resolve(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?[jt]sx?$/u.test(entry.name) ? [file] : [];
});

describe("单词拼写发布隔离", () => {
  it("vitest 默认打开实验开关并登记网页路由", async () => {
    expect(__EXP_SPELLING__).toBe(true);
    const { ROUTES } = await import("../../routes");
    expect(ROUTES.spelling).toBeDefined();
  });

  it("网页和 Taro 只有指定页面或 spelling 内部能引用数据层", () => {
    const violations = ["frontend/src", "taro-spike-2/src"].flatMap((directory) => sourceFiles(resolve(root, directory)))
      .filter((file) => !allowed(file))
      .flatMap((file) => spellingReferences(readFileSync(file, "utf8"), file).map((reference) => `${file}: ${reference}`));
    expect(violations).toEqual([]);
  });

  it("识别相对路径归一化、直接导入子模块及各种引用语法", () => {
    const file = resolve(root, "frontend/src/lib/sync/fixture.ts");
    const references = ["../spelling", "../spelling/check", "../spelling/index.ts", "../../lib/spelling/forms", "../sync/../spelling/content?raw", "../spelling/types"];
    const source = `
      import { SPELLING_MARKER } from "${references[0]}";
      export * from "${references[1]}";
      const page = import("${references[2]}");
      const forms = require("${references[3]}");
      import content = require("${references[4]}");
      type Target = import("${references[5]}").SpellingTarget;
    `;
    expect(spellingReferences(source, file)).toEqual(references);
    expect(spellingReferences('require.resolve("../spelling/check"); import(`../spelling/types`);', file))
      .toEqual(["../spelling/check", "../spelling/types"]);
    expect(spellingReferences('export { SPELLING_MARKER } from "../../../frontend/src/lib/spelling/index";', resolve(root, "taro-spike-2/src/lib/fixture.ts")))
      .toEqual(["../../../frontend/src/lib/spelling/index"]);
  });

  it("不会把注释、普通文本或名字相近的模块当成依赖", () => {
    const source = `
      // import { SPELLING_MARKER } from "../spelling";
      /* export * from "../spelling/check"; */
      const note = 'import("../spelling")';
      import other from "../spelling-extra";
    `;
    expect(spellingReferences(source, resolve(root, "frontend/src/lib/fixture.ts"))).toEqual([]);
  });

  it("允许名单只放行指定路径", () => {
    const permitted = [
      "frontend/src/lib/spelling/check.ts", "frontend/src/pages/SpellingPage.tsx",
      "frontend/src/routes/spelling.tsx", "frontend/src/features/spelling/card.tsx",
      "taro-spike-2/src/study/spelling/index.tsx"
    ];
    const forbidden = [
      "frontend/src/lib/check.ts", "frontend/src/pages/SpellingPage.test.tsx",
      "frontend/src/routes/index.ts", "taro-spike-2/src/study/spelling-extra/index.tsx"
    ];
    expect(permitted.every((file) => allowed(resolve(root, file)))).toBe(true);
    expect(forbidden.some((file) => allowed(resolve(root, file)))).toBe(false);
  });

  it("Taro 的三个实验页面各只由自己的开关控制", () => {
    for (const talk of ["0", "1"]) for (const jlpt of ["0", "1"]) for (const spelling of ["0", "1"]) {
      const output = execFileSync(process.execPath, ["-e", `
        const { ROUTE_TABLE } = require('./taro-spike-2/src/platform/route-table.cjs');
        console.log(JSON.stringify(ROUTE_TABLE.map(route => route.page)));
      `], {
        cwd: root,
        env: {
          ...process.env,
          SHUSHUGO_EXP_TALK: talk,
          SHUSHUGO_EXP_JLPT: jlpt,
          SHUSHUGO_EXP_SPELLING: spelling
        },
        encoding: "utf8"
      });
      const pages: string[] = JSON.parse(output);
      expect(pages.includes("talk")).toBe(talk === "1");
      expect(pages.includes("jlpt-practice")).toBe(jlpt === "1");
      expect(pages.includes("spelling")).toBe(spelling === "1");
    }
  });
});
