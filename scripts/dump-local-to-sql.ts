import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    sqlite: { type: "string" },
    outDir: { type: "string", default: "data" },
    chunk: { type: "string", default: "500" },
  },
});

if (!values.sqlite) {
  console.error("usage: bun scripts/dump-local-to-sql.ts --sqlite <path>");
  process.exit(1);
}

const CHUNK = Number(values.chunk);
const db = new Database(values.sqlite);
const outDir = resolve(process.cwd(), values.outDir!);
mkdirSync(outDir, { recursive: true });

const dumpTable = (
  table: string,
  columns: string[],
  format: (row: any) => string,
) => {
  const rows = db.query(`SELECT ${columns.join(",")} FROM ${table}`).all() as any[];
  console.log(`${table}: ${rows.length} rows`);
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    chunks.push(
      `INSERT OR REPLACE INTO ${table} (${columns.join(",")}) VALUES\n${slice.map(format).join(",\n")};`,
    );
  }
  const out = resolve(outDir, `remote_${table}.sql`);
  writeFileSync(out, chunks.join("\n\n") + "\n", "utf8");
  console.log(`  wrote ${out}`);
};

const esc = (s: string) => `'${s.replace(/'/g, "''")}'`;
const num = (n: number | null | undefined) => (n == null ? "NULL" : String(n));

dumpTable(
  "stocks",
  ["code", "name", "market", "price", "change_abs", "change_pct", "updated_at"],
  (r) => `(${esc(r.code)},${esc(r.name)},${esc(r.market)},${num(r.price)},${num(r.change_abs)},${num(r.change_pct)},${num(r.updated_at)})`,
);

dumpTable(
  "candles",
  ["code", "date", "open", "high", "low", "close", "volume", "adj_close"],
  (r) => `(${esc(r.code)},${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume},${num(r.adj_close)})`,
);
