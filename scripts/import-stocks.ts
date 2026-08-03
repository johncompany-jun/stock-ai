import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CSV_PATH = resolve(process.cwd(), "screener_result.csv");
const OUT_PATH = resolve(process.cwd(), "data/seed_stocks.sql");

const sqlEscape = (s: string) => s.replace(/'/g, "''");

const parsePrice = (v: string): number | null => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const parseChange = (v: string): { abs: number | null; pct: number | null } => {
  const m = v.match(/([+-]?[\d.]+)\s*\(([+-]?[\d.]+)%\)/);
  if (!m) return { abs: null, pct: null };
  const abs = Number(m[1]);
  const pct = Number(m[2]);
  return {
    abs: Number.isFinite(abs) ? abs : null,
    pct: Number.isFinite(pct) ? pct : null,
  };
};

const parseCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
};

const raw = readFileSync(CSV_PATH, "utf8").replace(/^﻿/, "");
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
const [header, ...rows] = lines;

console.log(`header: ${header}`);
console.log(`rows:   ${rows.length}`);

const now = Math.floor(Date.now() / 1000);
const values: string[] = [];
let skipped = 0;

for (const line of rows) {
  const cols = parseCsvLine(line);
  if (cols.length < 5) {
    skipped++;
    continue;
  }
  const [code, name, market, priceStr, changeStr] = cols;
  const price = parsePrice(priceStr);
  const { abs, pct } = parseChange(changeStr);
  values.push(
    `('${sqlEscape(code)}','${sqlEscape(name)}','${sqlEscape(market)}',${price ?? "NULL"},${abs ?? "NULL"},${pct ?? "NULL"},${now})`,
  );
}

mkdirSync(dirname(OUT_PATH), { recursive: true });

const chunkSize = 500;
const chunks: string[] = ["DELETE FROM stocks;"];
for (let i = 0; i < values.length; i += chunkSize) {
  const slice = values.slice(i, i + chunkSize);
  chunks.push(
    `INSERT INTO stocks (code,name,market,price,change_abs,change_pct,updated_at) VALUES\n${slice.join(",\n")};`,
  );
}
writeFileSync(OUT_PATH, chunks.join("\n\n") + "\n", "utf8");

console.log(`wrote:  ${OUT_PATH}`);
console.log(`values: ${values.length} (skipped: ${skipped})`);
