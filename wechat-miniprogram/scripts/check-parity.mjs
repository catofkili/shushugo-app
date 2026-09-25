import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const map = JSON.parse(readFileSync(path.join(root, 'wechat-miniprogram/parity-map.json'), 'utf8'));
const approved = new Set(map.approvedExemptions);

function git(args, allowFailure = false) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

const pathMatches = (file, rule) => rule.endsWith('/**')
  ? file.startsWith(rule.slice(0, -1))
  : rule.endsWith('/') ? file.startsWith(rule) : file === rule;

function filesBetween(base, head) {
  return git(['diff', '--name-only', '--no-renames', `${base}..${head}`]).split('\n').filter(Boolean);
}

function filesInWorkingTree() {
  const tracked = git(['diff', '--name-only', '--no-renames', 'HEAD']).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  return [...new Set([...tracked, ...untracked])];
}

function validate(files, label, commitMessage = '', dirty = false) {
  const changed = new Set(files);
  const webFiles = files.filter((file) => !/\.(?:test|spec)\.[^.]+$/.test(file)
    && map.sourceRoots.some((rootPath) => pathMatches(file, rootPath)));
  const failures = [];
  let exemption = commitMessage.match(/^Parity-Exempt:\s*(.+)$/m)?.[1]?.trim() ?? '';
  if (dirty && process.env.PARITY_EXEMPT_REASON) exemption = process.env.PARITY_EXEMPT_REASON.trim();
  const allowedExemption = Boolean(exemption && approved.has(exemption));

  for (const webFile of webFiles) {
    const pair = map.pairs.find(({ web }) => pathMatches(webFile, web));
    if (!pair) {
      failures.push(`${webFile} 尚未登记小程序对应项`);
      continue;
    }
    if (!pair.mini.length) {
      failures.push(`${webFile} 目前没有小程序页面对应项`);
      continue;
    }
    if (!pair.mini.some((target) => [...changed].some((file) => pathMatches(file, target)))) {
      failures.push(`${webFile} 改动没有同步到 ${pair.mini.join('、')}`);
    }
  }

  if (!failures.length) return true;
  if (allowedExemption) {
    console.log(`⚠️ ${label} 使用已批准的豁免：${exemption}`);
    return true;
  }
  console.error(`❌ ${label} 的网页/小程序改动未配对：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  if (exemption) console.error(`  豁免原因“${exemption}”不在 parity-map.json 的 approvedExemptions 中`);
  console.error('先更新 parity-map.json 并在用户对话里取得该原因的批准，再使用提交说明：Parity-Exempt: <原因>。');
  return false;
}

function commitExists(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch { return false; }
}

let ok = true;
const base = process.env.PARITY_BASE_SHA;
const head = process.env.PARITY_HEAD_SHA || git(['rev-parse', 'HEAD']);
if (base && commitExists(base) && commitExists(head)) {
  const commits = git(['rev-list', '--reverse', '--no-merges', `${base}..${head}`]).split('\n').filter(Boolean);
  for (const commit of commits) {
    const files = git(['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', commit]).split('\n').filter(Boolean);
    const message = git(['show', '-s', '--format=%B', commit]);
    ok = validate(files, `提交 ${commit.slice(0, 8)}`, message) && ok;
  }
} else {
  const headCommit = git(['rev-parse', 'HEAD']);
  const parent = git(['rev-parse', `${headCommit}^`], true);
  const files = parent
    ? filesBetween(parent, headCommit)
    : git(['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', headCommit]).split('\n').filter(Boolean);
  ok = validate(files, `最近提交 ${headCommit.slice(0, 8)}`, git(['show', '-s', '--format=%B', headCommit])) && ok;
}

const dirtyFiles = filesInWorkingTree();
if (dirtyFiles.length) ok = validate(dirtyFiles, '工作区改动', '', true) && ok;

if (!ok) process.exitCode = 1;
else console.log('网页/小程序改动配对检查通过');
