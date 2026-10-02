import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const practiceDirectory = resolve(root, "frontend/src/lib/jlpt-practice");

const dataDirectory = resolve(root, "frontend/src/data/jlpt");

const allowed = (file: string): boolean => (
  file.startsWith(`${practiceDirectory}${sep}`)
  || file === resolve(root, "frontend/src/pages/JlptPracticePage.tsx")
  || file === resolve(root, "frontend/src/routes/jlpt-practice.tsx")
  || file.startsWith(`${resolve(root, "frontend/src/features/jlpt-practice")}${sep}`)
  || file.startsWith(`${resolve(root, "taro-spike-2/src/study/jlpt-practice")}${sep}`)
);

/** Parse imports rather than matching text: comments and fixture strings are not dependencies. */
const moduleReferences = (source: string, file: string): string[] => {
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
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));
  return references;
};

const practiceReferences = (source: string, file: string): string[] => moduleReferences(source, file).filter((reference) => {
  if (!reference.startsWith(".")) return false;
  const target = resolve(dirname(file), reference.replace(/[?#].*$/u, ""));
  return [practiceDirectory, dataDirectory].some((directory) => target === directory || target.startsWith(`${directory}${sep}`));
});

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = resolve(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?[jt]sx?$/u.test(entry.name) ? [file] : [];
});

describe("JLPT 刷题发布隔离", () => {
  it("vitest 默认打开实验开关", () => {
    expect(__EXP_JLPT__).toBe(true);
  });

  it("网页和 Taro 只有指定页面或 jlpt-practice 内部能引用数据层", () => {
    const violations = ["frontend/src", "taro-spike-2/src"].flatMap((directory) => sourceFiles(resolve(root, directory)))
      .filter((file) => !allowed(file))
      .flatMap((file) => practiceReferences(readFileSync(file, "utf8"), file).map((reference) => `${file}: ${reference}`));
    expect(violations).toEqual([]);
  });

  it("识别相对路径归一化、直接导入子模块及各种引用语法", () => {
    const file = resolve(root, "frontend/src/lib/sync/fixture.ts");
    const references = ["../jlpt-practice", "../jlpt-practice/cards", "../jlpt-practice/index.ts", "../../lib/jlpt-practice/schedule", "../sync/../jlpt-practice/content?raw", "../jlpt-practice/content"];
    const source = `
      import { loadJlptBank } from "${references[0]}";
      export * from "${references[1]}";
      const page = import("${references[2]}");
      const cards = require("${references[3]}");
      import content = require("${references[4]}");
      type Content = import("${references[5]}").JlptBank;
    `;
    expect(practiceReferences(source, file)).toEqual(references);
    expect(practiceReferences('import bank from "../../data/jlpt/n3.json";', file)).toEqual(["../../data/jlpt/n3.json"]);
    expect(practiceReferences('require.resolve("../jlpt-practice/cards"); import(`../jlpt-practice/content`);', file))
      .toEqual(["../jlpt-practice/cards", "../jlpt-practice/content"]);
    expect(practiceReferences('export { loadJlptBank } from "../../../frontend/src/lib/jlpt-practice/cards";', resolve(root, "taro-spike-2/src/lib/fixture.ts")))
      .toEqual(["../../../frontend/src/lib/jlpt-practice/cards"]);
  });

  it("不会把注释、普通文本或名字相近的模块当成依赖", () => {
    const source = `
      // import { loadJlptBank } from "../jlpt-practice";
      /* export * from "../jlpt-practice/cards"; */
      const note = 'import("../jlpt-practice")';
      import other from "../jlpt-practice-other";
    `;
    expect(practiceReferences(source, resolve(root, "frontend/src/lib/fixture.ts"))).toEqual([]);
  });

  it("允许名单只放行指定路径", () => {
    const permitted = ["frontend/src/lib/jlpt-practice/cards.ts", "frontend/src/features/jlpt-practice/card.tsx", "frontend/src/pages/JlptPracticePage.tsx", "frontend/src/routes/jlpt-practice.tsx", "taro-spike-2/src/study/jlpt-practice/index.tsx"];
    const forbidden = ["frontend/src/lib/cards.ts", "frontend/src/pages/JlptPracticePage.test.tsx", "frontend/src/routes/index.ts", "taro-spike-2/src/study/jlpt-practice-other/index.tsx"];
    expect(permitted.every((file) => allowed(resolve(root, file)))).toBe(true);
    expect(forbidden.some((file) => allowed(resolve(root, file)))).toBe(false);
  });

  it("Taro 的 JLPT 和开口练习页面登记由各自开关独立控制", () => {
    for (const talk of ["0", "1"]) for (const jlpt of ["0", "1"]) {
      const output = execFileSync(process.execPath, ["-e", `
        const { ROUTE_TABLE } = require('./taro-spike-2/src/platform/route-table.cjs');
        console.log(JSON.stringify(ROUTE_TABLE.map(route => route.page)));
      `], { cwd: root, env: { ...process.env, SHUSHUGO_EXP_TALK: talk, SHUSHUGO_EXP_JLPT: jlpt }, encoding: "utf8" });
      const pages: string[] = JSON.parse(output);
      expect(pages.includes("talk")).toBe(talk === "1");
      expect(pages.includes("jlpt-practice")).toBe(jlpt === "1");
    }
  });
});
