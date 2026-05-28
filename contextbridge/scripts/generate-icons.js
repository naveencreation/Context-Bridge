const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');

const sizes = [16, 48, 128];
const iconsDir = path.resolve(__dirname, '..', 'icons');

// Simple purple gradient icon as SVG
const svgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7c3aed"/>
      <stop offset="100%" style="stop-color:#2563eb"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="url(#g)"/>
  <text x="64" y="85" font-size="72" text-anchor="middle" fill="white" font-family="Arial">⟷</text>
</svg>`;

async function generate() {
  await fs.ensureDir(iconsDir);

  for (const size of sizes) {
    await sharp(Buffer.from(svgIcon))
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon${size}.png`));
    console.log(`✅ Generated icon${size}.png`);
  }
}

generate().catch(console.error);