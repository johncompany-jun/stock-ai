import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    out: { type: "string", default: "data/daily_picks_backfill.sql" },
    apply: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});

const OUT_PATH = resolve(process.cwd(), values.out!);
const DB_NAME = "stock-ai";
const REMOTE_FLAG = values.remote ? "--remote" : "--local";

type Row = {
  code: string;
  run_date: number;
  last_close: number;
  predicted_close: number;
  actual_date: number;
  actual_close: number;
};

const SELECT_SQL = `WITH ranked AS (SELECT p.code, p.run_date, p.horizon_days, p.last_close, p.predicted_close, c.date AS c_date, c.close AS c_close, ROW_NUMBER() OVER (PARTITION BY p.code, p.run_date ORDER BY c.date ASC) AS rn FROM daily_picks p JOIN candles c ON c.code = p.code AND c.date > p.run_date WHERE p.direction_hit IS NULL) SELECT code, run_date, last_close, predicted_close, c_date AS actual_date, c_close AS actual_close FROM ranked WHERE rn = horizon_days`;

const queryResolvable = (): Row[] => {
  const res = spawnSync(
    "bunx",
    [
      "wrangler",
      "d1",
      "execute",
      DB_NAME,
      REMOTE_FLAG,
      "--json",
      "--command",
      SELECT_SQL,
    ],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    console.error(res.stderr);
    throw new Error("d1 query failed");
  }
  const parsed = JSON.parse(res.stdout) as Array<{ results: Row[] }>;
  return parsed[0]?.results ?? [];
};

const applySql = (path: string) => {
  const res = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", DB_NAME, REMOTE_FLAG, "--file", path],
    { encoding: "utf8", stdio: "inherit", maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error("apply failed");
};

const main = async () => {
  const rows = queryResolvable();
  console.log(`resolvable picks: ${rows.length}`);
  if (rows.length === 0) {
    console.log("nothing to backfill");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const stmts = rows.map((r) => {
    const returnPct = ((r.actual_close - r.last_close) / r.last_close) * 100;
    const predictedUp = r.predicted_close > r.last_close;
    const predictedDown = r.predicted_close < r.last_close;
    const actualUp = r.actual_close > r.last_close;
    const actualDown = r.actual_close < r.last_close;
    const hit =
      (predictedUp && actualUp) || (predictedDown && actualDown) ? 1 : 0;
    const code = r.code.replace(/'/g, "''");
    return `UPDATE daily_picks SET actual_close=${r.actual_close}, actual_date=${r.actual_date}, return_pct=${returnPct}, direction_hit=${hit}, updated_at=${now} WHERE code='${code}' AND run_date=${r.run_date};`;
  });

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, stmts.join("\n") + "\n", "utf8");
  console.log(`wrote: ${OUT_PATH} (${stmts.length} rows)`);

  if (values.apply) applySql(OUT_PATH);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
