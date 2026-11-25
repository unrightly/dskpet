'use strict';

/**
 * 由 assets/icon.png 生成多尺寸 assets/icon.ico（16~256），供安装包与 exe 使用。
 * 运行：node_modules\.bin\electron.cmd tools\gen-ico.js
 */

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  try {
    const root = path.join(__dirname, '..');
    const srcPath = path.join(root, 'assets', 'icon.png');
    const outPath = path.join(root, 'assets', 'icon.ico');
    const src = nativeImage.createFromPath(srcPath);
    if (src.isEmpty()) throw new Error(`cannot load ${srcPath}`);

    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const images = sizes.map((size) => ({
      size,
      data: src.resize({ width: size, height: size, quality: 'best' }).toPNG()
    }));

    const count = images.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(count, 4);

    const entries = [];
    const blobs = [];
    let offset = 6 + 16 * count;

    for (const image of images) {
      const entry = Buffer.alloc(16);
      entry[0] = image.size >= 256 ? 0 : image.size;
      entry[1] = image.size >= 256 ? 0 : image.size;
      entry[2] = 0;
      entry[3] = 0;
      entry.writeUInt16LE(1, 4);
      entry.writeUInt16LE(32, 6);
      entry.writeUInt32LE(image.data.length, 8);
      entry.writeUInt32LE(offset, 12);
      offset += image.data.length;
      entries.push(entry);
      blobs.push(image.data);
    }

    const ico = Buffer.concat([header, ...entries, ...blobs]);
    fs.writeFileSync(outPath, ico);
    console.log(`icon.ico written: ${outPath} (${ico.length} bytes, ${count} sizes)`);
  } catch (err) {
    console.error('[gen-ico] failed:', err);
    process.exitCode = 1;
  }
  app.quit();
});
