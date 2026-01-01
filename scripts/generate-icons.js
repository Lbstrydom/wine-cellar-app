/**
 * @fileoverview Generate PWA icons from SVG source.
 * Run with: node scripts/generate-icons.js
 */

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const imagesDir = join(publicDir, 'images');

// Icon sizes needed for PWA
const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// Read SVG source
const svgBuffer = readFileSync(join(imagesDir, 'icon.svg'));

async function generateIcons() {
  console.log('Generating PWA icons...');

  for (const size of ICON_SIZES) {
    // Regular icon
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(imagesDir, `icon-${size}.png`));
    console.log(`Created icon-${size}.png`);
  }

  // Maskable icons (with padding for safe zone)
  for (const size of [192, 512]) {
    // Maskable icons need 10% padding for safe zone
    const innerSize = Math.floor(size * 0.8);
    const padding = Math.floor(size * 0.1);

    await sharp(svgBuffer)
      .resize(innerSize, innerSize)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 26, g: 26, b: 46, alpha: 1 } // #1a1a2e
      })
      .png()
      .toFile(join(imagesDir, `icon-maskable-${size}.png`));
    console.log(`Created icon-maskable-${size}.png`);
  }

  // Badge icon (monochrome, smaller)
  await sharp(svgBuffer)
    .resize(72, 72)
    .png()
    .toFile(join(imagesDir, 'badge-72.png'));
  console.log('Created badge-72.png');

  // Shortcut icons
  await generateShortcutIcon('add', '#4CAF50');
  await generateShortcutIcon('wine', '#722F37');

  // Apple touch icon (180x180)
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(join(imagesDir, 'apple-touch-icon.png'));
  console.log('Created apple-touch-icon.png');

  // Favicon (32x32)
  await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toFile(join(imagesDir, 'favicon-32.png'));
  console.log('Created favicon-32.png');

  // Favicon ICO is typically generated from 16, 32, 48 sizes
  // For now, just create PNGs
  await sharp(svgBuffer)
    .resize(16, 16)
    .png()
    .toFile(join(imagesDir, 'favicon-16.png'));
  console.log('Created favicon-16.png');

  console.log('Done! All icons generated.');
}

async function generateShortcutIcon(name, color) {
  // Simple colored circle with symbol
  const size = 96;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="${color}"/>
      <text x="${size/2}" y="${size/2 + 8}"
            text-anchor="middle"
            font-size="48"
            fill="white">
        ${name === 'add' ? '+' : '🍷'}
      </text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(imagesDir, `icon-${name}-96.png`));
  console.log(`Created icon-${name}-96.png`);
}

generateIcons().catch(console.error);
