import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

export type SavedPrediction = {
  pair: string;
  date: string;
  entryPrice: number;
  direction: "LONG" | "SHORT";
  probability: number;
  confidence: number;
  longWins: number;
  shortWins: number;
  avgLong: number;
  avgShort: number;
  k: number;
  seeds: number;
  actualLabelPips: number | null;
  actualTpHitMin: number | null;
  actualSlHitMin: number | null;
  pnlPips: number | null;
  hit: number | null;
  updatedAt: number;
};

export type Outcome = {
  actualLabelPips: number | null;
  actualTpHitMin: number | null;
  actualSlHitMin: number | null;
};

export type PredictionStore = {
  savePrediction: (p: Omit<SavedPrediction, "updatedAt">) => Promise<void>;
  getPrediction: (pair: string, date: string) => Promise<SavedPrediction | null>;
  updateOutcome: (
    pair: string,
    date: string,
    outcome: Outcome & { pnlPips: number | null; hit: number | null },
  ) => Promise<void>;
};

export const computePnl = (
  direction: "LONG" | "SHORT",
  outcome: Outcome,
  tpPips: number,
  slPips: number,
): { pnlPips: number | null; hit: number | null } => {
  const { actualLabelPips, actualTpHitMin, actualSlHitMin } = outcome;
  if (actualLabelPips === null) return { pnlPips: null, hit: null };
  const tp = actualTpHitMin;
  const sl = actualSlHitMin;
  let pnlLong: number;
  let pnlShort: number;
  if (tp === null && sl === null) {
    pnlLong = actualLabelPips;
    pnlShort = -actualLabelPips;
  } else if (tp !== null && sl === null) {
    pnlLong = tpPips;
    pnlShort = -slPips;
  } else if (sl !== null && tp === null) {
    pnlLong = -slPips;
    pnlShort = tpPips;
  } else {
    const tpFirst = (tp as number) < (sl as number);
    pnlLong = tpFirst ? tpPips : -slPips;
    pnlShort = tpFirst ? -slPips : tpPips;
  }
  const pnlPips = direction === "LONG" ? pnlLong : pnlShort;
  return { pnlPips, hit: pnlPips > 0 ? 1 : 0 };
};

const D1_ROOT = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const findLocalDb = (): string => {
  const files = readdirSync(D1_ROOT).filter((f) => f.endsWith(".sqlite"));
  if (files.length === 0) throw new Error("no local D1 sqlite");
  return resolve(D1_ROOT, files[0]);
};

const rowToPrediction = (r: Record<string, unknown>): SavedPrediction => ({
  pair: String(r.pair),
  date: String(r.date),
  entryPrice: Number(r.entry_price),
  direction: String(r.direction) as "LONG" | "SHORT",
  probability: Number(r.probability),
  confidence: Number(r.confidence),
  longWins: Number(r.long_wins),
  shortWins: Number(r.short_wins),
  avgLong: Number(r.avg_long),
  avgShort: Number(r.avg_short),
  k: Number(r.k),
  seeds: Number(r.seeds),
  actualLabelPips: r.actual_label_pips === null ? null : Number(r.actual_label_pips),
  actualTpHitMin: r.actual_tp_hit_min === null ? null : Number(r.actual_tp_hit_min),
  actualSlHitMin: r.actual_sl_hit_min === null ? null : Number(r.actual_sl_hit_min),
  pnlPips: r.pnl_pips === null ? null : Number(r.pnl_pips),
  hit: r.hit === null ? null : Number(r.hit),
  updatedAt: Number(r.updated_at),
});

export const localPredictionStore = (dbPath?: string): PredictionStore => {
  const path = dbPath ?? findLocalDb();
  return {
    savePrediction: async (p) => {
      const db = new Database(path);
      try {
        db.query(
          `INSERT OR REPLACE INTO fx_predictions
           (pair, date, entry_price, direction, probability, confidence,
            long_wins, short_wins, avg_long, avg_short, k, seeds,
            actual_label_pips, actual_tp_hit_min, actual_sl_hit_min, pnl_pips, hit, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          p.pair,
          p.date,
          p.entryPrice,
          p.direction,
          p.probability,
          p.confidence,
          p.longWins,
          p.shortWins,
          p.avgLong,
          p.avgShort,
          p.k,
          p.seeds,
          p.actualLabelPips,
          p.actualTpHitMin,
          p.actualSlHitMin,
          p.pnlPips,
          p.hit,
          Math.floor(Date.now() / 1000),
        );
      } finally {
        db.close();
      }
    },
    getPrediction: async (pair, date) => {
      const db = new Database(path, { readonly: true });
      try {
        const row = db
          .query<Record<string, unknown>, [string, string]>(
            `SELECT * FROM fx_predictions WHERE pair = ? AND date = ?`,
          )
          .get(pair, date);
        return row ? rowToPrediction(row) : null;
      } finally {
        db.close();
      }
    },
    updateOutcome: async (pair, date, outcome) => {
      const db = new Database(path);
      try {
        db.query(
          `UPDATE fx_predictions
           SET actual_label_pips = ?, actual_tp_hit_min = ?, actual_sl_hit_min = ?,
               pnl_pips = ?, hit = ?, updated_at = ?
           WHERE pair = ? AND date = ?`,
        ).run(
          outcome.actualLabelPips,
          outcome.actualTpHitMin,
          outcome.actualSlHitMin,
          outcome.pnlPips,
          outcome.hit,
          Math.floor(Date.now() / 1000),
          pair,
          date,
        );
      } finally {
        db.close();
      }
    },
  };
};

const D1_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
type D1QueryResponse = {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: Array<{ results: Array<Record<string, unknown>>; success: boolean }>;
};

export const remotePredictionStore = (config: {
  accountId: string;
  databaseId: string;
  apiToken: string;
}): PredictionStore => {
  const url = `${D1_API_BASE}/${config.accountId}/d1/database/${config.databaseId}/query`;
  const query = async (
    sql: string,
    params: Array<string | number | null>,
  ): Promise<Array<Record<string, unknown>>> => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql,
        params: params.map((p) => (p === null ? null : typeof p === "number" ? String(p) : p)),
      }),
    });
    if (!res.ok) throw new Error(`D1 query failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as D1QueryResponse;
    if (!json.success) throw new Error(`D1 query error: ${JSON.stringify(json.errors)}`);
    return json.result?.[0]?.results ?? [];
  };
  return {
    savePrediction: async (p) => {
      await query(
        `INSERT OR REPLACE INTO fx_predictions
         (pair, date, entry_price, direction, probability, confidence,
          long_wins, short_wins, avg_long, avg_short, k, seeds,
          actual_label_pips, actual_tp_hit_min, actual_sl_hit_min, pnl_pips, hit, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.pair,
          p.date,
          p.entryPrice,
          p.direction,
          p.probability,
          p.confidence,
          p.longWins,
          p.shortWins,
          p.avgLong,
          p.avgShort,
          p.k,
          p.seeds,
          p.actualLabelPips,
          p.actualTpHitMin,
          p.actualSlHitMin,
          p.pnlPips,
          p.hit,
          Math.floor(Date.now() / 1000),
        ],
      );
    },
    getPrediction: async (pair, date) => {
      const rows = await query(
        `SELECT * FROM fx_predictions WHERE pair = ? AND date = ?`,
        [pair, date],
      );
      return rows[0] ? rowToPrediction(rows[0]) : null;
    },
    updateOutcome: async (pair, date, outcome) => {
      await query(
        `UPDATE fx_predictions
         SET actual_label_pips = ?, actual_tp_hit_min = ?, actual_sl_hit_min = ?,
             pnl_pips = ?, hit = ?, updated_at = ?
         WHERE pair = ? AND date = ?`,
        [
          outcome.actualLabelPips,
          outcome.actualTpHitMin,
          outcome.actualSlHitMin,
          outcome.pnlPips,
          outcome.hit,
          Math.floor(Date.now() / 1000),
          pair,
          date,
        ],
      );
    },
  };
};
