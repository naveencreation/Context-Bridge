const fs = require('fs-extra');
const path = require('path');

const target = process.argv[2] || 'chrome';
const src = path.resolve(__dirname, '..');
const dist = path.resolve(__dirname, '..', 'dist', target);

async function build() {
  await fs.remove(dist);
  await fs.ensureDir(dist);

  // Copy all extension files
  const filesToCopy = [
    'popup', 'settings', 'background',
    'content', 'utils', 'icons'
  ];

  for (const f of filesToCopy) {
    const from = path.join(src, f);
    if (await fs.pathExists(from)) {
      await fs.copy(from, path.join(dist, f));
    }
  }

  // Copy correct manifest
  const manifestFile = target === 'firefox'
    ? 'manifest.firefox.json'
    : 'manifest.json';

  await fs.copy(
    path.join(src, manifestFile),
    path.join(dist, 'manifest.json')
  );

  console.log(`✅ Built for ${target} → dist/${target}/`);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

