// 小程序不能装载整份迁移种子，只带队列必需的身份和档位；测试逐项比对决定源产物。
import { readFileSync, writeFileSync } from 'node:fs';
const content = JSON.parse(readFileSync(new URL('../src/data/jlpt_collocation_content.json', import.meta.url), 'utf8'));
const index = Object.fromEntries([['core', 0], ['optional', 2]].map(([tier, code]) => [tier,
  content.entries.filter(({ t }) => t === code).map(({ surface, kana }) => surface === kana ? surface : [surface, kana])
]));
writeFileSync(new URL('../src/data/collocation_tier_index.json', import.meta.url), `${JSON.stringify(index)}\n`);
