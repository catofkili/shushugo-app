#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentPath = path.join(here, "../src/data/talk_content.json");
const dbPath = path.join(here, "../public/nihongo.db");
const content = JSON.parse(readFileSync(contentPath, "utf8"));
const SQL = await initSqlJs({
  locateFile: (file) => fileURLToPath(new URL("../node_modules/sql.js/dist/" + file, import.meta.url))
});
const db = new SQL.Database(new Uint8Array(readFileSync(dbPath)));

function rows(sql) {
  const result = db.exec(sql)[0];
  if (!result) return [];
  return result.values.map((values) =>
    Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))
  );
}

function names(text, expression) {
  return [...text.matchAll(expression)].map((match) => match[1]).sort();
}

function teForm(surface, verbType) {
  if (surface.endsWith("する")) return surface.slice(0, -2) + "して";
  if (surface === "行く" || surface === "いく") return surface.slice(0, -1) + "って";
  if (verbType === "ichidan" && surface.endsWith("る")) return surface.slice(0, -1) + "て";
  const last = [...surface].at(-1);
  const endings = { う: "って", つ: "って", る: "って", む: "んで", ぶ: "んで", ぬ: "んで", く: "いて", ぐ: "いで", す: "して" };
  return endings[last] ? [...surface].slice(0, -1).join("") + endings[last] : null;
}

assert.equal(content.version, "2026-09-30");
const expectedFormulaIds = Array.from({ length: 30 }, (_, i) => "F" + String(i + 1).padStart(2, "0"));
const expectedSceneIds = Array.from({ length: 15 }, (_, i) => "S" + String(i + 1).padStart(2, "0"));
const formulaIds = content.formulas.map((formula) => formula.id);
const sceneIds = content.scenes.map((scene) => scene.id);
assert.equal(new Set(formulaIds).size, formulaIds.length, "formula IDs must be unique");
assert.equal(new Set(sceneIds).size, sceneIds.length, "scene IDs must be unique");
assert.deepEqual([...formulaIds].sort(), expectedFormulaIds, "must contain exactly F01-F30");
assert.deepEqual([...sceneIds].sort(), expectedSceneIds, "must contain exactly S01-S15");

const formulaIdSet = new Set(formulaIds);
const sceneIdSet = new Set(sceneIds);
const wordById = new Map(rows("SELECT id, kanji, kana, pos, verb_type FROM words").map((word) => [word.id, word]));
let fillerGroups = 0;
let wordIdGroups = 0;
let wordIdValues = 0;
for (const formula of content.formulas) {
  const patternSlots = names(formula.pattern, /\[([^\]]+)\]/g);
  const skeletonSlots = names(formula.skeleton, /\[([^\]]+)\]/g);
  const promptSlots = names(formula.prompt, /\{([^}]+)\}/g);
  assert.deepEqual(promptSlots, patternSlots, formula.id + " prompt slots");
  if (skeletonSlots.length) assert.deepEqual(skeletonSlots, patternSlots, formula.id + " skeleton slots");
  assert.ok(formula.skeleton.includes("……"), formula.id + " skeleton must include an ellipsis");
  assert.ok(!formula.skeleton.includes(formula.pattern), formula.id + " skeleton exposes the full pattern");

  if (skeletonSlots.length) {
    const lastPatternSlot = [...formula.pattern.matchAll(/\[([^\]]+)\]/g)].at(-1);
    const lastSkeletonSlot = [...formula.skeleton.matchAll(/\[([^\]]+)\]/g)].at(-1);
    const patternTail = formula.pattern.slice(lastPatternSlot.index + lastPatternSlot[0].length);
    const skeletonTail = formula.skeleton
      .slice(lastSkeletonSlot.index + lastSkeletonSlot[0].length)
      .replaceAll("……", "");
    assert.ok(patternTail.startsWith(skeletonTail), formula.id + " skeleton must only retain the pattern opening");
    const covered = patternTail.length - skeletonTail.length;
    assert.ok(covered >= Math.ceil(patternTail.length / 2), formula.id + " skeleton reveals too much of the pattern");
  }

  assert.ok(formula.fillers.length >= 8 && formula.fillers.length <= 12, formula.id + " must have 8-12 filler groups");
  const filledPrompts = formula.fillers.map((group) =>
    formula.prompt.replace(/\{([^}]+)\}/g, (_, slot) => group[slot].zh)
  );
  assert.equal(new Set(filledPrompts).size, filledPrompts.length, formula.id + " filled prompts must be unique");

  for (const group of formula.fillers) {
    fillerGroups++;
    assert.deepEqual(Object.keys(group).sort(), patternSlots, formula.id + " filler slots");
    const filledAnswer = formula.pattern.replace(/\[([^\]]+)\]/g, (_, slot) => group[slot].ja);
    const filledSkeleton = formula.skeleton.replace(/\[([^\]]+)\]/g, (_, slot) => group[slot].ja);
    assert.notEqual(
      filledSkeleton.replaceAll("……", ""),
      filledAnswer,
      formula.id + " filled skeleton must not equal the complete answer"
    );

    let groupHasWordId = false;
    for (const [slot, filler] of Object.entries(group)) {
      assert.deepEqual(Object.keys(filler).sort(), filler.wordId === undefined ? ["ja", "zh"] : ["ja", "wordId", "zh"]);
      assert.equal(typeof filler.ja, "string");
      assert.equal(typeof filler.zh, "string");
      if (filler.wordId === undefined) continue;
      wordIdValues++;
      groupHasWordId = true;
      const word = wordById.get(filler.wordId);
      assert.ok(word, formula.id + " has unknown wordId " + filler.wordId);
      const bare = filler.ja.replace(/^(お|ご)/, "");
      const exactMatch = [filler.ja, bare].some((surface) => word.kanji === surface || word.kana === surface);
      const verbMatch = slot === "动作て形" &&
        (teForm(word.kanji, word.verb_type) === filler.ja || teForm(word.kana, word.verb_type) === filler.ja);
      assert.ok(exactMatch || verbMatch, formula.id + " wordId does not match " + filler.ja);
      if (verbMatch) assert.ok(word.pos.includes("动词"), formula.id + " te-form wordId must be a dictionary verb");
    }
    if (groupHasWordId) wordIdGroups++;
  }
  if (formula.scene !== undefined) assert.ok(sceneIdSet.has(formula.scene), formula.id + " references a missing scene");
}

let sceneLineCount = 0;
for (const scene of content.scenes) {
  assert.ok(scene.lines.length > 0, scene.id + " has no lines");
  assert.ok(scene.lines.some((line) => line.self === true), scene.id + " needs at least one self line");
  for (const line of scene.lines) {
    sceneLineCount++;
    assert.equal(typeof line.self, "boolean", scene.id + " self must be boolean");
    assert.equal(typeof line.ja, "string");
    assert.equal(typeof line.zh, "string");
    for (const id of line.formulas) assert.ok(formulaIdSet.has(id), scene.id + " references missing " + id);
  }
}
assert.equal(sceneLineCount, 60, "the 15 scenes must contain all 60 corpus lines");

db.close();
console.log(
  "Talk content verification passed: " + content.formulas.length + " formulas, " +
  content.scenes.length + " scenes, " + sceneLineCount + " lines, " + fillerGroups +
  " filler groups, " + wordIdGroups + " groups with wordId (" + wordIdValues + " linked entries)."
);
