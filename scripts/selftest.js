// Runs PadForge against a simulated DualSense Edge and reports the result.
//   node scripts/selftest.js                    test build/app with the development Electron
//   node scripts/selftest.js path\to\PadForge.exe   test a packaged app
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exe = process.argv[2];
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'padforge-test-'));
const [cmd, args] = exe ? [path.resolve(exe), []] : [require('electron'), [path.join(__dirname, '..', 'build', 'app')]];
const r = spawnSync(cmd, args, { env: { ...process.env, PADFORGE_SELFTEST: '1', PADFORGE_SELFTEST_OUT: out }, stdio: 'inherit', timeout: 120000 });

const file = path.join(out, 'selftest.json');
if (!fs.existsSync(file)) { console.error(`Self-test produced no result (exit ${r.status}${r.error ? `, ${r.error.message}` : ''})`); process.exit(1); }
const { result, console: lines } = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const c of result.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `  ->  ${c.info ?? ''}`}`);
const errors = (lines || []).filter(l => /^\[(error|warning|2|3)\]/i.test(l) || l === 'TIMEOUT');
if (errors.length) { console.log('\nConsole problems:'); errors.forEach(l => console.log('  ' + l)); }
const passed = result.checks.filter(c => c.pass).length;
console.log(`\n${result.ok && !errors.length ? 'All' : passed + ' of'} ${result.checks.length} checks passed. Screenshots: ${out}`);
process.exit(result.ok && !errors.length ? 0 : 1);
