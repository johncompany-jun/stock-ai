import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    from: { type: "string", default: "2023-01-01" },
    to: { type: "string", default: "2025-12-31" },
    tpPips: { type: "string", default: "20" },
    slPips: { type: "string", default: "20" },
    local: { type: "boolean", default: true },
    remote: { type: "boolean", default: false },
    outDir: { type: "string", default: "data/fx" },
  },
});

const PAIR = values.pair.toUpperCase();
const FROM = values.from;
const TO = values.to;
const TP = Number(values.tpPips) / 100; // pips to price (JPY pair)
const SL = Number(values.slPips) / 100;
const OUT_DIR = resolve(process.cwd(), values.outDir);
const DB_NAME = "stock-ai";

const D1_ROOT = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const findLocalDb = (): string => {
  const files = readdirSync(D1_ROOT).filter((f) => f.endsWith(".sqlite"));
  if (files.length === 0) throw new Error(`no local D1 sqlite in ${D1_ROOT}`);
  return resolve(D1_ROOT, files[0]);
};

const applySql = (path: string, target: "--local" | "--remote") => {
  const res = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DB_NAME, target, "--file", path],
    { encoding: "utf8", stdio: "inherit", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error(`apply failed for ${path} (${target})`);
};

type Bar = { o: number; h: number; l: number; c: number };
type Feature = {
  date: string;
  entryTsUtc: number;
  entryPrice: number;
  nyDeltaPips: number | null;
  morningTrendBps: number | null;
  gotoubiFlag: number;
  dow: number;
  label995Pips: number | null;
  tpHitMin: number | null;
  slHitMin: number | null;
};

const isLastDayOfMonth = (d: Date): boolean => {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.getUTCMonth() !== d.getUTCMonth();
};

const isGotoubi = (jstYear: number, jstMonth1: number, jstDay: number): boolean => {
  if ([5, 10, 15, 20, 25].includes(jstDay)) return true;
  const jstDate = new Date(Date.UTC(jstYear, jstMonth1 - 1, jstDay));
  return isLastDayOfMonth(jstDate);
};

const jstDateStr = (y: number, m1: number, d: number): string =>
  `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const jstDateToEntryUtcSec = (y: number, m1: number, d: number): number => {
  // Entry: 8:30 JST on (y,m1,d) = 23:30 UTC on (y,m1,d-1)
  const jstMidnightUtc = Date.UTC(y, m1 - 1, d) - 9 * 3600 * 1000; // 00:00 JST on target date, in UTC ms
  return Math.floor((jstMidnightUtc + 8.5 * 3600 * 1000) / 1000);
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const dbPath = findLocalDb();
  if (!existsSync(dbPath)) throw new Error(`no local D1 file: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  const fromUtcSec = Math.floor(new Date(`${FROM}T00:00:00Z`).getTime() / 1000) - 2 * 86400;
  const toUtcSec = Math.floor(new Date(`${TO}T23:59:59Z`).getTime() / 1000) + 2 * 86400;

  console.log(
    `pair=${PAIR}  range=${FROM}..${TO}  TP=${TP.toFixed(2)}  SL=${SL.toFixed(2)}  db=${dbPath}`,
  );

  const rows = db
    .query<{ ts: number; o: number; h: number; l: number; c: number }, [string, number, number]>(
      "SELECT timestamp_utc AS ts, open AS o, high AS h, low AS l, close AS c FROM fx_candles WHERE pair = ? AND timestamp_utc BETWEEN ? AND ? ORDER BY timestamp_utc",
    )
    .all(PAIR, fromUtcSec, toUtcSec);
  db.close();
  console.log(`loaded ${rows.length} candles from local D1`);

  const byTs = new Map<number, Bar>();
  for (const r of rows) byTs.set(r.ts, { o: r.o, h: r.h, l: r.l, c: r.c });

  const features: Feature[] = [];
  const start = new Date(`${FROM}T00:00:00Z`);
  const end = new Date(`${TO}T00:00:00Z`);
  let prevTradingEntryPrice: number | null = null;
  let skipped = 0;

  for (
    let cur = new Date(start);
    cur.getTime() <= end.getTime();
    cur = new Date(cur.getTime() + 86400 * 1000)
  ) {
    const y = cur.getUTCFullYear();
    const m1 = cur.getUTCMonth() + 1;
    const d = cur.getUTCDate();
    const dowIso = ((cur.getUTCDay() + 6) % 7) + 1; // Mon=1 .. Sun=7
    if (dowIso > 5) continue; // weekend

    const entryTs = jstDateToEntryUtcSec(y, m1, d);
    const entryBar = byTs.get(entryTs);
    if (!entryBar) {
      skipped++;
      continue;
    }
    const entryPrice = entryBar.o;

    // Exit at 9:55 JST = 00:55 UTC same UTC day = entryTs + 85 min (23:30 UTC + 85 min = 00:55 UTC)
    const exitBar = byTs.get(entryTs + 85 * 60);
    const label995Pips = exitBar ? (exitBar.c - entryPrice) * 100 : null;

    // TP/SL first-hit within window [entryTs .. entryTs + 85*60]
    let tpHitMin: number | null = null;
    let slHitMin: number | null = null;
    for (let off = 0; off <= 85; off++) {
      const bar = byTs.get(entryTs + off * 60);
      if (!bar) continue;
      if (tpHitMin === null && bar.h >= entryPrice + TP) tpHitMin = off;
      if (slHitMin === null && bar.l <= entryPrice - SL) slHitMin = off;
      if (tpHitMin !== null && slHitMin !== null) break;
    }

    // Morning trend: 22:00 UTC prev day (7:00 JST) -> 23:29 UTC prev day (8:29 JST)
    const morningStart = entryTs - 90 * 60;
    const morningEndBar = byTs.get(entryTs - 60);
    const morningStartBar = byTs.get(morningStart);
    const morningTrendBps =
      morningStartBar && morningEndBar && morningStartBar.o > 0
        ? ((morningEndBar.c - morningStartBar.o) / morningStartBar.o) * 10000
        : null;

    // NY delta: entry today - entry prev trading day, in pips
    const nyDeltaPips =
      prevTradingEntryPrice !== null ? (entryPrice - prevTradingEntryPrice) * 100 : null;

    features.push({
      date: jstDateStr(y, m1, d),
      entryTsUtc: entryTs,
      entryPrice,
      nyDeltaPips,
      morningTrendBps,
      gotoubiFlag: isGotoubi(y, m1, d) ? 1 : 0,
      dow: dowIso,
      label995Pips,
      tpHitMin,
      slHitMin,
    });

    prevTradingEntryPrice = entryPrice;
  }

  console.log(`built ${features.length} feature rows (skipped ${skipped} dates without entry bar)`);
  if (features.length === 0) return;

  const filePath = `${OUT_DIR}/fx_features_${PAIR}_${FROM}_${TO}.sql`;
  const BATCH = 500;
  const chunks: string[] = [];
  for (let i = 0; i < features.length; i += BATCH) {
    const slice = features.slice(i, i + BATCH);
    const vals = slice
      .map((f) => {
        const cell = (v: number | null): string => (v === null ? "NULL" : String(v));
        return `('${PAIR}','${f.date}',${f.entryTsUtc},${f.entryPrice},${cell(f.nyDeltaPips)},${cell(f.morningTrendBps)},${f.gotoubiFlag},${f.dow},${cell(f.label995Pips)},${cell(f.tpHitMin)},${cell(f.slHitMin)})`;
      })
      .join(",\n");
    chunks.push(
      `INSERT OR REPLACE INTO fx_features (pair,date,entry_ts_utc,entry_price,ny_delta_pips,morning_trend_bps,gotoubi_flag,dow,label_995_pips,tp_hit_min,sl_hit_min) VALUES\n${vals};`,
    );
  }
  writeFileSync(filePath, chunks.join("\n\n") + "\n", "utf8");
  console.log(`wrote ${filePath.split("/").pop()} (${chunks.length} statements)`);

  if (values.local) applySql(filePath, "--local");
  if (values.remote) applySql(filePath, "--remote");
  unlinkSync(filePath);
  console.log("done");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
