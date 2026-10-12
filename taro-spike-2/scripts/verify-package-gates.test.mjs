import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-package-gates-'));
const source = 'frontend/src/components/DailyPlanSlider.weapp.tsx';
try {
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'reports'));
  const script = path.join(root, 'scripts/verify-package-gates.mjs');
  fs.copyFileSync(new URL('./verify-package-gates.mjs', import.meta.url), script);
  const files = ['main', 'account', 'study'].map((name) => ({ path: name === 'main' ? 'common.js' : `${name}/index.js`, package: name, bytes: 1 }));
  fs.writeFileSync(path.join(root, 'reports/package-sizes.json'), JSON.stringify({
    packages: Object.fromEntries(files.map((file) => [file.package, { bytes: 1 }])), files
  }));
  const check = (owners, moduleSource = source) => {
    fs.writeFileSync(path.join(root, 'reports/webpack-stats.json'), JSON.stringify({
      chunks: owners.map((owner) => ({ files: [files.find((file) => file.package === owner).path],
        modules: [{ nameForCondition: `/checkout/${moduleSource}`, size: 10 }] }))
    }));
    execFileSync(process.execPath, [script, '--report-only'], { stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(path.join(root, 'reports/package-gates.json'), 'utf8'));
  };
  assert(!check(['main']).stalePageComponentAllowlist.includes(source), '主包唯一实例已消除重复');
  assert(check([]).stalePageComponentAllowlist.includes(source), '消失的条目仍拦截');
  assert(check(['account']).stalePageComponentAllowlist.includes(source), '只剩一个分包的条目仍需更新许可');
  assert(!check(['account', 'study']).stalePageComponentAllowlist.includes(source), '原有分包重复仍按许可检查');
  assert.equal(check(['account', 'study'], 'frontend/src/components/Unlisted.tsx').unapprovedPageComponents.length, 1, '未许可重复不放行');
  console.log('分包组件提取回归检查通过');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
