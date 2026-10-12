import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "data/pattern_picks_backfill.sql" },
    apply: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});

const OUT_PATH = resolve(process.cwd(), values.out!);
const DB_NAME = "stock-ai";
const REMOTE_FLAG = values.remote ? "--remote" : "--local";

const HORIZONS = [5, 15, 30] as const;

type NeedRow = {
  code: string;
  run_date: number;
  entry_close: number;
};

const buildSelectSql = (horizon: number): string =>
  `WITH ranked AS (
    SELECT p.code, p.run_date, p.entry_close, c.date AS c_date, c.close AS c_close,
      ROW_NUMBER() OVER (PARTITION BY p.code, p.run_date ORDER BY c.date ASC) AS rn
    FROM pattern_picks p
    JOIN candles c ON c.code = p.code AND c.date > p.run_date
    WHERE p.actual_${horizon}d_close IS NULL
  )
  SELECT code, run_date, entry_close, c_date AS actual_date, c_close AS actual_close
  FROM ranked WHERE rn = ${horizon}`;

type ResolvedRow = {
  code: string;
  run_date: number;
  entry_close: number;
  actual_date: number;
  actual_close: number;
};

const queryResolvable = (horizon: number): ResolvedRow[] => {
  const res = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DB_NAME, REMOTE_FLAG, "--json", "--command", buildSelectSql(horizon)],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    console.error(res.stderr);
    throw new Error("d1 query failed");
  }
  const parsed = JSON.parse(res.stdout) as Array<{ results: ResolvedRow[] }>;
  return parsed[0]?.results ?? [];
};

const main = async () => {
  const now = Math.floor(Date.now() / 1000);
  const stmts: string[] = [];
  let total = 0;

  for (const h of HORIZONS) {
    const rows = queryResolvable(h);
    console.log(`h=${h}d: ${rows.length} resolvable`);
    for (const r of rows) {
      const returnPct = ((r.actual_close - r.entry_close) / r.entry_close) * 100;
      const code = r.code.replace(/'/g, "''");
      stmts.push(
        `UPDATE pattern_picks SET actual_${h}d_close=${r.actual_close}, actual_${h}d_date=${r.actual_date}, return_${h}d_pct=${returnPct}, updated_at=${now} WHERE code='${code}' AND run_date=${r.run_date};`,
      );
    }
    total += rows.length;
  }

  if (total === 0) {
    console.log("nothing to backfill");
    return;
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, stmts.join("\n") + "\n", "utf8");
  console.log(`wrote: ${OUT_PATH} (${stmts.length} updates)`);

  if (values.apply) {
    const res = spawnSync(
      "bunx",
      ["wrangler", "d1", "execute", DB_NAME, REMOTE_FLAG, "--file", OUT_PATH],
      { encoding: "utf8", stdio: "inherit", maxBuffer: 256 * 1024 * 1024 },
    );
    if (res.status !== 0) throw new Error("apply failed");
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
