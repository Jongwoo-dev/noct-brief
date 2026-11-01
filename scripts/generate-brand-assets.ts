import { readFile, writeFile, copyFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile("public/brand/noct-mark.svg");
await copyFile("public/brand/noct-mark.svg", "app/icon.svg");
await sharp(source).resize(180, 180).png().toFile("app/apple-icon.png");

// ICO directory entries wrap PNG frames, preserving crisp native 16/32/48px sizes.
const sizes = [16, 32, 48];
const frames = await Promise.all(
  sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()),
);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (const [i, frame] of frames.entries()) {
  const entry = 6 + i * 16;
  header[entry] = sizes[i];
  header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
}
await writeFile("app/favicon.ico", Buffer.concat([header, ...frames]));
console.log(
  "Generated SVG, 16/32/48px favicon.ico and 180px Apple icon from noct-mark.svg.",
);
