import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

it('rebuilds from sources, rejects edited output without overwriting it, and detects stale distinction input', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const fixture = mkdtempSync(join(tmpdir(), 'shushugo-meaning-source-'));
  const generator = 'frontend/scripts/build-manual-meaning-overrides.mjs';
  const sync = 'question-meaning-review/sync-distinction-meanings.mjs';
  const target = join(fixture, 'frontend/src/data/jlpt_meaning_overrides.json');
  const run = (script, ...args) => spawnSync(process.execPath, [join(fixture, script), ...args], { encoding: 'utf8' });
  try {
    // 临时 checkout 只复制会被测试改写的输入；真实工作树和学习数据库都不写。
    for (const file of [generator, sync, 'frontend/scripts/loanword-merge-map.json']) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      cpSync(join(root, file), join(fixture, file));
    }
    cpSync(join(root, 'frontend/scripts/manual-meaning-reviewed'), join(fixture, 'frontend/scripts/manual-meaning-reviewed'), { recursive: true });
    for (const dir of ['manual-meaning-rewrite', 'manual-meaning-polish', 'frontend/node_modules', 'frontend/public']) {
      symlinkSync(join(root, dir), join(fixture, dir));
    }
    const [distinction] = JSON.parse(readFileSync(join(fixture, 'frontend/scripts/manual-meaning-reviewed/distinction-source.json'), 'utf8'));
    const batch = distinction.provenance.reference.split('/').at(-1).split('#')[0];
    // 其余辨析批次也要复制，保证测试的改动只发生在 fixture。
    cpSync(join(root, 'question-meaning-review'), join(fixture, 'question-meaning-review'), {
      recursive: true, filter: (file) => file === join(root, 'question-meaning-review') || /manual-batch-\d+\.json$/.test(file),
    });
    mkdirSync(dirname(target), { recursive: true });
    const baseline = readFileSync(join(root, 'frontend/src/data/jlpt_meaning_overrides.json'));
    const generated = run(generator);
    expect(generated.status, generated.stderr).toBe(0);
    expect(readFileSync(target).equals(baseline)).toBe(true);
    expect(run(generator, '--check').status).toBe(0);

    const handEdited = JSON.parse(baseline.toString('utf8'));
    handEdited[0].meaning += '（手改测试）';
    const edited = Buffer.from(`${JSON.stringify(handEdited, null, 2)}\n`);
    writeFileSync(target, edited);
    const rejected = run(generator, '--check');
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('释义覆盖表与源头生成结果不一致');
    expect(readFileSync(target).equals(edited)).toBe(true);
    writeFileSync(target, baseline);

    const batchPath = join(fixture, 'question-meaning-review', batch);
    const entries = JSON.parse(readFileSync(batchPath, 'utf8'));
    entries.find((entry) => entry.classification === 'distinction').questionMeaning += '（测试）';
    writeFileSync(batchPath, JSON.stringify(entries));
    const stale = run(generator, '--check');
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('辨析源头已过期');
    const synced = run(sync);
    expect(synced.status, synced.stderr).toBe(0);
    expect(readFileSync(target).equals(baseline)).toBe(true);
    expect(run(sync, '--check').status).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}, 20_000);
