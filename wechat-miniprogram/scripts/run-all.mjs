/*
 * `npm test` 的唯一入口:把 package.json 里除了自己以外的每个脚本都跑一遍。
 *
 * ⚠️ 故意不在这里维护一份脚本名单。原来 CI 里手抄着三个脚本名,于是
 * grammar / runtime / entitlement / modes / budget 这些一直没人在提交时跑过 ——
 * 本地补跑全绿,而下一次提交不会自动得到同样的保证。名单一旦要人手抄,
 * 新加的 smoke 就永远是「下次再加进 CI」。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const { scripts } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const names = Object.keys(scripts).filter((name) => name !== 'test');

for (const name of names) {
  process.stdout.write(`\n── npm run ${name} ──\n`);
  execFileSync('npm', ['run', '--silent', name], { cwd: root, stdio: 'inherit' });
}
process.stdout.write(`\n✅ ${names.length} 个脚本全部通过\n`);
