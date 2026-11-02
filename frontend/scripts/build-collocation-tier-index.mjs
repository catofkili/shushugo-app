// 小程序不能装载整份迁移种子，只带队列必需的身份和档位；测试逐项比对决定源产物。
import { readFileSync, writeFileSync } from 'node:fs';
const content = JSON.parse(readFileSync(new URL('../src/data/jlpt_collocation_content.json', import.meta.url), 'utf8'));
writeFileSync(new URL('../src/data/collocation_tier_index.json', import.meta.url), `${JSON.stringify(content.entries.map(({ surface, kana, t }) => [surface, kana, t ?? 1]))}\n`);
