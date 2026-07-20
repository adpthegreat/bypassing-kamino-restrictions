/**
 * Render the Jupiter Lend `operate` delta tables as a black & white SVG (which
 * embeds in any markdown as an image and never overflows). Writes
 * docs/operate-deltas.svg.
 *
 *   yarn tsx scripts/operate-table-svg.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

type Row = string[];

const single = {
  title: "operate(new_col, new_debt) — single action",
  head: ["Action", "new_col", "new_debt"],
  rows: [
    ["Initialize", "0", "0"],
    ["Deposit", "+amount", "0"],
    ["Withdraw", "-amount", "0"],
    ["Borrow", "0", "+amount"],
    ["Repay", "0", "-amount"],
  ] as Row[],
};

const combined = {
  title: "operate — combined (both legs at once)",
  head: ["Combined action", "new_col", "new_debt"],
  rows: [
    ["Deposit + Borrow", "+deposit", "+borrow"],
    ["Repay + Withdraw", "-withdraw", "-repay"],
  ] as Row[],
};

// layout
const COLS = [230, 120, 120]; // column widths
const W = COLS.reduce((a, b) => a + b, 0);
const RH = 30; // row height
const PAD = 16;
const FS = 14;
const notes = [
  "new_col: +deposit / -withdraw   new_debt: +borrow / -repay",
  "i128::MIN (u64::MAX) = all  (withdraw-all / repay-all)",
];

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function table(x: number, y: number, t: typeof single): { svg: string; height: number } {
  const parts: string[] = [];
  // title
  parts.push(
    `<text x="${x}" y="${y - 8}" font-family="monospace" font-size="${FS}" font-weight="bold" fill="#000">${esc(t.title)}</text>`
  );
  const allRows = [t.head, ...t.rows];
  allRows.forEach((row, r) => {
    const ry = y + r * RH;
    const isHead = r === 0;
    // row background (header light gray for B&W distinction via subtle fill)
    parts.push(
      `<rect x="${x}" y="${ry}" width="${W}" height="${RH}" fill="${isHead ? "#eeeeee" : "#ffffff"}" stroke="#000" stroke-width="1"/>`
    );
    let cx = x;
    row.forEach((cell, c) => {
      if (c > 0)
        parts.push(`<line x1="${cx}" y1="${ry}" x2="${cx}" y2="${ry + RH}" stroke="#000" stroke-width="1"/>`);
      parts.push(
        `<text x="${cx + 10}" y="${ry + RH / 2 + FS / 3}" font-family="monospace" font-size="${FS}" ${isHead ? 'font-weight="bold"' : ""} fill="#000">${esc(cell)}</text>`
      );
      cx += COLS[c];
    });
  });
  return { svg: parts.join("\n"), height: allRows.length * RH + 24 };
}

function main() {
  const parts: string[] = [];
  let y = PAD + 24;
  const t1 = table(PAD, y, single);
  parts.push(t1.svg);
  y += t1.height + 28;
  const t2 = table(PAD, y, combined);
  parts.push(t2.svg);
  y += t2.height + 6;
  // notes
  notes.forEach((n) => {
    parts.push(
      `<text x="${PAD}" y="${y}" font-family="monospace" font-size="12" fill="#000">${esc(n)}</text>`
    );
    y += 20;
  });

  const totalW = W + PAD * 2;
  const totalH = y + PAD;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
<rect width="100%" height="100%" fill="#ffffff"/>
${parts.join("\n")}
</svg>`;

  mkdirSync(join(__dirname, "..", "docs"), { recursive: true });
  const out = join(__dirname, "..", "docs", "operate-deltas.svg");
  writeFileSync(out, svg);
  console.log("wrote", out, `(${totalW}x${totalH})`);
}

main();
