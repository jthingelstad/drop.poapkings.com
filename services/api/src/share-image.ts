import { deflateSync } from "node:zlib";
import type { PublishedRunShareItem } from "./repository.js";

const WIDTH = 1_200;
const HEIGHT = 630;

const FONT: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
  ":": ["00000", "00110", "00110", "00000", "00110", "00110", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "#": ["01010", "11111", "01010", "01010", "11111", "01010", "01010"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

type Color = readonly [number, number, number, number?];

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data = Buffer.alloc(0)): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

class Canvas {
  readonly pixels = new Uint8Array(WIDTH * HEIGHT * 4);

  pixel(x: number, y: number, color: Color): void {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    const offset = (Math.floor(y) * WIDTH + Math.floor(x)) * 4;
    const alpha = color[3] ?? 255;
    if (alpha === 255) {
      this.pixels[offset] = color[0];
      this.pixels[offset + 1] = color[1];
      this.pixels[offset + 2] = color[2];
      this.pixels[offset + 3] = 255;
      return;
    }
    const inverse = 255 - alpha;
    this.pixels[offset] = Math.round(
      (color[0] * alpha + this.pixels[offset]! * inverse) / 255,
    );
    this.pixels[offset + 1] = Math.round(
      (color[1] * alpha + this.pixels[offset + 1]! * inverse) / 255,
    );
    this.pixels[offset + 2] = Math.round(
      (color[2] * alpha + this.pixels[offset + 2]! * inverse) / 255,
    );
    this.pixels[offset + 3] = 255;
  }

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    color: Color,
  ): void {
    for (let py = Math.max(0, y); py < Math.min(HEIGHT, y + height); py += 1)
      for (let px = Math.max(0, x); px < Math.min(WIDTH, x + width); px += 1)
        this.pixel(px, py, color);
  }

  rounded(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    color: Color,
  ): void {
    for (let py = y; py < y + height; py += 1) {
      for (let px = x; px < x + width; px += 1) {
        const dx = Math.max(x + radius - px, 0, px - (x + width - radius - 1));
        const dy = Math.max(y + radius - py, 0, py - (y + height - radius - 1));
        if (dx * dx + dy * dy <= radius * radius) this.pixel(px, py, color);
      }
    }
  }

  circle(cx: number, cy: number, radius: number, color: Color): void {
    for (let y = -radius; y <= radius; y += 1)
      for (let x = -radius; x <= radius; x += 1)
        if (x * x + y * y <= radius * radius) this.pixel(cx + x, cy + y, color);
  }

  text(
    value: string,
    x: number,
    y: number,
    scale: number,
    color: Color,
    maxChars = 40,
  ): void {
    const normalized = value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .slice(0, maxChars);
    let cursor = x;
    for (const char of normalized) {
      const glyph = FONT[char] ?? FONT["?"]!;
      glyph.forEach((row, rowIndex) => {
        for (let column = 0; column < row.length; column += 1) {
          if (row[column] === "1")
            this.rect(
              cursor + column * scale,
              y + rowIndex * scale,
              scale,
              scale,
              color,
            );
        }
      });
      cursor += scale * 6;
    }
  }

  png(): Buffer {
    const stride = WIDTH * 4 + 1;
    const raw = Buffer.alloc(stride * HEIGHT);
    for (let y = 0; y < HEIGHT; y += 1) {
      raw[y * stride] = 0;
      raw.set(
        this.pixels.subarray(y * WIDTH * 4, (y + 1) * WIDTH * 4),
        y * stride + 1,
      );
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(WIDTH, 0);
    header.writeUInt32BE(HEIGHT, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND"),
    ]);
  }
}

function modeName(mode: PublishedRunShareItem["mode"]): string {
  return {
    surge: "SURGE",
    trade: "TRADE",
    survival: "SURVIVAL",
    rain: "RAIN",
    "higher-lower": "HIGHER / LOWER",
  }[mode];
}

export function shareScore(
  mode: PublishedRunShareItem["mode"],
  score: number,
): string {
  if (mode === "surge" || mode === "trade")
    return `${(score / 1_000).toFixed(3)}s`;
  if (mode === "rain") return `${score} CLEARED`;
  if (mode === "survival") return `${score} STREAK`;
  return `${score} CORRECT`;
}

function paintBackground(canvas: Canvas): void {
  for (let y = 0; y < HEIGHT; y += 1) {
    const mix = y / HEIGHT;
    const color: Color = [
      Math.round(18 + 18 * mix),
      Math.round(10 + 8 * mix),
      Math.round(48 + 46 * mix),
    ];
    canvas.rect(0, y, WIDTH, 1, color);
  }
  const drops = [
    [1070, 72, 34],
    [1120, 132, 15],
    [1020, 565, 22],
    [78, 530, 16],
    [114, 92, 10],
  ];
  for (const [x, y, radius] of drops)
    canvas.circle(x!, y!, radius!, [180, 128, 255, 34]);
}

function paintChart(canvas: Canvas, share: PublishedRunShareItem): void {
  const visual = share.visual;
  if (!visual?.values.length) {
    canvas.text("A RUN WORTH SHARING", 88, 405, 6, [201, 179, 255]);
    return;
  }
  const x = 88;
  const y = 366;
  const width = 746;
  const height = 132;
  const peak = Math.max(1, ...visual.values, ...(visual.refs ?? []));
  const gap = 5;
  const barWidth = Math.max(4, Math.floor(width / visual.values.length) - gap);
  visual.values.forEach((value, index) => {
    const barHeight = Math.max(4, Math.round((value / peak) * height));
    const barX = x + Math.floor((index * width) / visual.values.length);
    canvas.rounded(
      barX,
      y + height - barHeight,
      barWidth,
      barHeight,
      3,
      visual.bad?.[index] ? [241, 91, 105] : [174, 112, 255],
    );
    const ref = visual.refs?.[index];
    if (ref !== undefined) {
      const refY = y + height - Math.round((ref / peak) * height);
      canvas.rect(barX - 1, refY, barWidth + 2, 3, [255, 222, 116]);
    }
  });
  canvas.text(visual.unit, x, 520, 3, [181, 163, 215], 34);
}

export function renderRunShareImage(share: PublishedRunShareItem): Buffer {
  const canvas = new Canvas();
  paintBackground(canvas);
  canvas.rounded(48, 34, 1_104, 562, 34, [10, 7, 26, 225]);
  canvas.rounded(70, 56, 1_060, 518, 24, [27, 18, 55]);

  canvas.circle(100, 100, 23, [255, 209, 84]);
  canvas.circle(100, 100, 13, [116, 55, 185]);
  canvas.text("ELIXIR DROP", 142, 76, 7, [255, 255, 255]);
  canvas.text("FREE - NO ACCOUNT NEEDED", 143, 137, 3, [181, 163, 215]);

  canvas.text(share.player.publicName, 88, 206, 5, [205, 181, 255], 28);
  canvas.text(modeName(share.mode), 88, 262, 5, [255, 216, 102], 22);
  const score = shareScore(share.mode, share.score);
  const scoreScale = score.length > 12 ? 8 : score.length > 9 ? 10 : 12;
  canvas.text(score, 88, 306, scoreScale, [255, 255, 255], 18);

  paintChart(canvas, share);

  canvas.rounded(870, 190, 220, 310, 22, [67, 37, 112]);
  canvas.text("CAN", 925, 235, 8, [255, 255, 255]);
  canvas.text("YOU", 925, 308, 8, [255, 255, 255]);
  canvas.text("BEAT", 900, 381, 8, [255, 216, 102]);
  canvas.text("IT?", 925, 454, 8, [255, 216, 102]);

  canvas.text("DROP.POAPKINGS.COM", 870, 535, 3, [181, 163, 215], 24);
  return canvas.png();
}
