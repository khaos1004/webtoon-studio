import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BUBBLE_KINDS, defaultBubble, bubblesSvgDocument } from '../src/lib/bubble';

const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const bubbles = BUBBLE_KINDS.map((k, i) => {
  const x = 40 + (i % 4) * 330;
  const y = 40 + Math.floor(i / 4) * 330;
  const b = defaultBubble(k, x, y);
  return { ...b, tailX: x + 80, tailY: y + b.h + 70 };
});
const bg = `<rect width="1400" height="720" fill="#dfe9f5"/>`;
const svg = bubblesSvgDocument(bubbles, 1400, 720).replace('viewBox="0 0 1400 720">', 'viewBox="0 0 1400 720">' + bg);
fs.writeFileSync(path.join(out, 'bubbles.svg'), svg);
sharp(Buffer.from(svg)).png().toFile(path.join(out, 'bubbles.png')).then(() => console.log('ok'));
