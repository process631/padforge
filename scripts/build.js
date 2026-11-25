// Bundles src/ into build/app (what Electron runs and electron-builder packages).
//   node scripts/build.js         release build (minified)
//   node scripts/build.js --dev   development build (readable, inline source maps)
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = (...p) => path.join(root, 'src', ...p);
const out = path.join(root, 'build', 'app');
const dev = process.argv.includes('--dev');
const pkg = require(path.join(root, 'package.json'));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const common = {
  bundle: true, minify: !dev, sourcemap: dev ? 'inline' : false, legalComments: 'none', logLevel: 'warning',
  banner: { js: `/* ${pkg.productName} ${pkg.version} */` },
};
const node = { ...common, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] };
esbuild.buildSync({ ...node, entryPoints: [src('main', 'main.js')], outfile: path.join(out, 'main.js') });
esbuild.buildSync({ ...node, entryPoints: [src('main', 'preload.js')], outfile: path.join(out, 'preload.js') });
esbuild.buildSync({ ...common, platform: 'browser', format: 'iife', target: 'chrome130', entryPoints: [src('renderer', 'app.js')], outfile: path.join(out, 'renderer.js') });
esbuild.buildSync({ entryPoints: [src('renderer', 'styles.css')], outfile: path.join(out, 'styles.css'), bundle: true, minify: !dev, logLevel: 'warning' });

let html = fs.readFileSync(src('renderer', 'index.html'), 'utf8');
if (!dev) html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(out, 'assets', 'icon.png'));
fs.copyFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), path.join(out, 'THIRD_PARTY_NOTICES.txt'));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description,
  author: pkg.author, license: pkg.license, main: 'main.js',
}, null, 2));

const kb = f => `${f} ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(1)} KB`;
console.log(`Built build/app (${dev ? 'dev' : 'release'}): ${['main.js', 'preload.js', 'renderer.js', 'styles.css', 'index.html'].map(kb).join(', ')}`);
