import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const talkDirectory = resolve(root, "frontend/src/lib/talk");

const allowed = (file: string): boolean => (
  file.startsWith(`${talkDirectory}${sep}`)
  || file === resolve(root, "frontend/src/pages/TalkPage.tsx")
  || file === resolve(root, "frontend/src/routes/talk.tsx")
  || file.startsWith(`${resolve(root, "taro-spike-2/src/study/talk")}${sep}`)
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

const talkReferences = (source: string, file: string): string[] => moduleReferences(source, file).filter((reference) => {
  if (!reference.startsWith(".")) return false;
  const target = resolve(dirname(file), reference.replace(/[?#].*$/u, ""));
  return target === talkDirectory || target.startsWith(`${talkDirectory}${sep}`);
});

const sourceFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = resolve(directory, entry.name);
  return entry.isDirectory() ? sourceFiles(file) : /\.[cm]?[jt]sx?$/u.test(entry.name) ? [file] : [];
});

describe("开口练习发布隔离", () => {
  it("网页和 Taro 只有指定页面或 talk 内部能引用数据层", () => {
    const violations = ["frontend/src", "taro-spike-2/src"].flatMap((directory) => sourceFiles(resolve(root, directory)))
      .filter((file) => !allowed(file))
      .flatMap((file) => talkReferences(readFileSync(file, "utf8"), file).map((reference) => `${file}: ${reference}`));
    expect(violations).toEqual([]);
  });

  it("识别相对路径归一化、直接导入子模块及各种引用语法", () => {
    const file = resolve(root, "frontend/src/lib/sync/fixture.ts");
    const references = ["../talk", "../talk/cards", "../talk/index.ts", "../../lib/talk/schedule", "../sync/../talk/content?raw", "../talk/content"];
    const source = `
      import { talkCard } from "${references[0]}";
      export * from "${references[1]}";
      const page = import("${references[2]}");
      const cards = require("${references[3]}");
      import content = require("${references[4]}");
      type Content = import("${references[5]}").TalkContent;
    `;
    expect(talkReferences(source, file)).toEqual(references);
    expect(talkReferences('require.resolve("../talk/cards"); import(`../talk/content`);', file))
      .toEqual(["../talk/cards", "../talk/content"]);
    expect(talkReferences('export { talkCard } from "../../../frontend/src/lib/talk/cards";', resolve(root, "taro-spike-2/src/lib/fixture.ts")))
      .toEqual(["../../../frontend/src/lib/talk/cards"]);
  });

  it("不会把注释、普通文本或名字相近的模块当成依赖", () => {
    const source = `
      // import { talkCard } from "../talk";
      /* export * from "../talk/cards"; */
      const note = 'import("../talk")';
      import other from "../talk-other";
    `;
    expect(talkReferences(source, resolve(root, "frontend/src/lib/fixture.ts"))).toEqual([]);
  });

  it("允许名单只放行指定路径", () => {
    const permitted = ["frontend/src/lib/talk/cards.ts", "frontend/src/pages/TalkPage.tsx", "frontend/src/routes/talk.tsx", "taro-spike-2/src/study/talk/index.tsx"];
    const forbidden = ["frontend/src/lib/cards.ts", "frontend/src/pages/TalkPage.test.tsx", "frontend/src/routes/index.ts", "taro-spike-2/src/study/talk-other/index.tsx"];
    expect(permitted.every((file) => allowed(resolve(root, file)))).toBe(true);
    expect(forbidden.some((file) => allowed(resolve(root, file)))).toBe(false);
  });
});
