import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

/**
 * 2026-11-09：0.2.6 上传被拒「invalid file: lazy/tabs.js … SyntaxError: Invalid or unexpected token」。
 * 微信开发者工具上传 / 预览时会把对象键的引号去掉；它按新版 Unicode 把「・」（U+30FB）「･」（U+FF65）
 * 当标识符字符，「書きます・食べます」就成了裸标识符，而微信自己的 JS 引擎不认。我们的 dist 里引号还在，
 * 所以 Taro 构建、node --check、所有闸门都是绿的，只有上传那一步才炸。
 * 守住：源码和小程序生成物里不许出现「含・的字符串当对象键」。要用就写成键值对数组或 JSON.parse 字符串。
 */
const repo = path.resolve(__dirname, "../../..");
const roots = ["frontend/src", "wechat-miniprogram/src"];
const KEY = /(?:^|[{,])\s*"[^"\n]*[・･][^"\n]*"\s*:/m;

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full);
  return /\.(ts|tsx|js|cjs|mjs)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
});

it("no object-literal key contains ・ / ･ (WeChat upload unquotes it into an invalid identifier)", () => {
  const offenders = roots.flatMap((root) => walk(path.join(repo, root)))
    .filter((file) => KEY.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(repo, file));
  expect(offenders).toEqual([]);
});
