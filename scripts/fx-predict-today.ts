import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { dowFromJst, dowLabel, jstDateStrParts, predict, todayJstDate } from "./lib/fx-predict";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    date: { type: "string" },
    k: { type: "string", default: "10" },
    modelDir: { type: "string", default: "data/fx/model" },
  },
});

const PAIR = values.pair.toUpperCase();
const K = Number(values.k);
const MODEL_DIR = resolve(process.cwd(), values.modelDir);

const main = async () => {
  const date = values.date ?? todayJstDate();
  const [y, m1, d] = jstDateStrParts(date);
  const dow = dowFromJst(y, m1, d);
  if (dow > 5) {
    console.error(`skip: ${date} (${dowLabel(dow)}) は週末`);
    process.exit(1);
  }

  const r = await predict({ pair: PAIR, date, modelDir: MODEL_DIR, k: K });
  const { features: f, neighbors: scored, direction, confidence, probability: prob } = r;

  console.log(`=== FX シグナル [${PAIR}]  ${date} (${dowLabel(dow)})  8:30 JST ===\n`);
  console.log(`エントリー参考価格: ${f.entry_price.toFixed(3)}`);
  console.log(`今朝の状況:`);
  console.log(`  NY 変化 (前日8:30比):     ${f.ny_delta_pips !== null ? (f.ny_delta_pips >= 0 ? "+" : "") + f.ny_delta_pips.toFixed(1) + "p" : "N/A"}`);
  console.log(`  朝のトレンド (7:00→8:29): ${f.morning_trend_bps !== null ? (f.morning_trend_bps >= 0 ? "+" : "") + f.morning_trend_bps.toFixed(1) + "bps" : "N/A"}`);
  console.log(`  ゴトー日:                 ${f.gotoubi_flag ? "はい" : "いいえ"}`);
  console.log("");
  console.log(`[モデル判定 — ${r.seeds}-seed ensemble]`);
  console.log(`  方向: ${direction}`);
  console.log(`  確信度: ${(confidence * 100).toFixed(1)}%  (raw prob=${prob.toFixed(3)})`);
  console.log("");
  console.log(`[過去 ${r.historySize} 営業日で今朝と似ていた日 上位 ${K} 件]`);
  console.log(`  #   date         mt        nd       曜  ゴ  LONG      SHORT`);
  for (let i = 0; i < scored.length; i++) {
    const h = scored[i];
    const mt = h.morning_trend_bps !== null ? (h.morning_trend_bps >= 0 ? "+" : "") + h.morning_trend_bps.toFixed(1) : "N/A";
    const nd = h.ny_delta_pips !== null ? (h.ny_delta_pips >= 0 ? "+" : "") + h.ny_delta_pips.toFixed(1) + "p" : "N/A";
    const lp = (h.pnl_long >= 0 ? "+" : "") + h.pnl_long.toFixed(1) + "p";
    const sp = (h.pnl_short >= 0 ? "+" : "") + h.pnl_short.toFixed(1) + "p";
    console.log(
      `  ${String(i + 1).padStart(2)}  ${h.date}  ${mt.padStart(7)}b  ${nd.padStart(8)}  ${dowLabel(h.dow)}   ${h.gotoubi_flag ? "○" : "-"}  ${lp.padStart(8)}  ${sp.padStart(8)}`,
    );
  }
  console.log("");
  console.log(`  → LONG 勝ち: ${r.longWins}/${K} (${((r.longWins / K) * 100).toFixed(0)}%)  平均 ${r.avgLong >= 0 ? "+" : ""}${r.avgLong.toFixed(1)}p`);
  console.log(`  → SHORT 勝ち: ${r.shortWins}/${K} (${((r.shortWins / K) * 100).toFixed(0)}%)  平均 ${r.avgShort >= 0 ? "+" : ""}${r.avgShort.toFixed(1)}p`);
  console.log("");
  console.log(`推奨: ${direction}  (最終判断は上の類似日パターンをご確認ください)`);
};

await main();
