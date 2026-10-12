import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultStudyPreferences } from "../studyPreferences";
import { SYNCED_TABLES } from "../sync/tables";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const source = (file: string) => readFileSync(new URL(file, `file://${root}`), "utf8");

describe("拼写作为正常学习卡上线", () => {
  it("默认关闭设备偏好，拼写三张表仍不上云", () => {
    expect(defaultStudyPreferences.spellingEnabled).toBe(false);
    expect(SYNCED_TABLES.filter((entry) => entry.table.startsWith("spelling_")))
      .toHaveLength(3);
    expect(SYNCED_TABLES.filter((entry) => entry.table.startsWith("spelling_")).every((entry) => entry.cloud === false)).toBe(true);
  });

  it("网页独立入口和插播已删除，学习卡面保留", async () => {
    const { ROUTES } = await import("../../routes");
    expect(Object.keys(ROUTES)).not.toContain("spelling");
    for (const file of ["frontend/src/pages/SpellingPage.tsx", "frontend/src/features/spelling/SpellingInline.tsx", "frontend/src/features/spelling/SpellingSettings.tsx", "frontend/src/routes/spelling.tsx"]) {
      expect(existsSync(new URL(file, `file://${root}`))).toBe(false);
    }
    const study = source("frontend/src/pages/WordStudy.tsx");
    expect(study).toContain("<SpellingCardView");
    expect(study).not.toMatch(/inlineWordId|inlineCandidate|SpellingInline/);
    expect(source("frontend/src/components/ZooHome.tsx")).not.toContain('onNavigate("spelling")');
  });

  it("Taro 没有独立拼写路由，开口和 JLPT 始终登记", () => {
    const output = execFileSync(process.execPath, ["-e", `
      const { ROUTE_TABLE } = require('./taro-spike-2/src/platform/route-table.cjs');
      console.log(JSON.stringify(ROUTE_TABLE.map(route => route.page)));
    `], { cwd: root, env: process.env, encoding: "utf8" });
    const pages: string[] = JSON.parse(output);
    expect(pages.includes("spelling")).toBe(false);
    expect(pages.includes("talk")).toBe(true);
    expect(pages.includes("jlpt-practice")).toBe(true);
  });
});
