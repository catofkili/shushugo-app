const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const strip = require('./strip-weapp-css.cjs');

const originalCwd = process.cwd();
const scratch = fs.mkdtempSync(path.join(__dirname, '../.strip-css-test-'));
(async () => {
  try {
    process.chdir(scratch);
    fs.mkdirSync('reports');
    const { css } = await postcss([strip()]).process(`
.app-mobile-tabbar,.weapp-app-main { color:red }
@media (min-width:640px) { .app-landscape-rail-grid>button { color:blue } .app-landscape-main { padding:2px } }
.app-tab,.app-tab-pill,.app-mobile-topbar,.app-landscape-topbar { color:green }
.app-shell,.app-tabular { display:block }
`, { from: undefined });
    const selectors = [];
    postcss.parse(css).walkRules(rule => selectors.push(rule.selector.trim()));
    assert.deepEqual(selectors, ['.weapp-app-main', '.app-landscape-main', '.app-shell,.app-tabular']);
    console.log('WeApp CSS strip passed: unused web navigation removed, mixed selectors and native page layout preserved.');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(scratch, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
