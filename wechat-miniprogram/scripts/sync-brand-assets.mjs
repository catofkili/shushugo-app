import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(root, 'wechat-miniprogram/scripts/brand-assets.json');
const manifestPath = path.join(root, 'wechat-miniprogram/scripts/brand-assets.generated.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const check = process.argv.includes('--check');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let previousManifest = { assets: [] };
try { previousManifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch {}

const entries = config.assets.map(({ source, target, quality }) => {
  const sourcePath = path.join(root, source);
  const targetPath = path.join(root, target);
  if (!sourcePath.startsWith(`${root}${path.sep}`) || !targetPath.startsWith(`${root}${path.sep}wechat-miniprogram/src/assets${path.sep}`)) {
    throw new Error(`品牌资源路径越界：${source} → ${target}`);
  }
  const sourceBytes = readFileSync(sourcePath);
  let outputBytes;
  try { outputBytes = readFileSync(targetPath); } catch { outputBytes = null; }

  if (!check && (!outputBytes || !previousManifest.assets.some((entry) => entry.source === source && entry.sourceSha256 === hash(sourceBytes)))) {
    const temporaryPath = `${targetPath}.tmp.webp`;
    mkdirSync(path.dirname(targetPath), { recursive: true });
    execFileSync('cwebp', ['-quiet', '-q', String(quality), sourcePath, '-o', temporaryPath], { stdio: 'inherit' });
    renameSync(temporaryPath, targetPath);
    outputBytes = readFileSync(targetPath);
  }

  return {
    source,
    target,
    quality,
    sourceSha256: hash(sourceBytes),
    targetSha256: outputBytes ? hash(outputBytes) : null,
    targetBytes: outputBytes?.length ?? null,
  };
});

const manifest = `${JSON.stringify({ generatedFrom: 'frontend/public/brand', assets: entries }, null, 2)}\n`;
if (check) {
  let actual = '';
  try { actual = readFileSync(manifestPath, 'utf8'); } catch {}
  if (actual !== manifest || entries.some((entry) => !entry.targetBytes)) {
    console.error('小程序品牌资源已过期：运行 node wechat-miniprogram/scripts/sync-brand-assets.mjs（需要 cwebp）');
    process.exitCode = 1;
  } else {
    console.log(`品牌资源已同步（${entries.length} 项）`);
  }
} else {
  writeFileSync(manifestPath, manifest);
  console.log(`已同步 ${entries.length} 项小程序品牌资源`);
}
