import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { sendEmail } from "./lib/send-email";
import {
  computeOutcome,
  dowFromJst,
  dowLabel,
  jstDateStrParts,
  localCandleSource,
  predict,
  remoteCandleSource,
  todayJstDate,
  type CandleSource,
  type PredictResult,
} from "./lib/fx-predict";
import {
  computePnl,
  localPredictionStore,
  remotePredictionStore,
  type PredictionStore,
  type SavedPrediction,
} from "./lib/fx-signal-log";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    date: { type: "string" },
    k: { type: "string", default: "10" },
    modelDir: { type: "string", default: "data/fx/model" },
    tpPips: { type: "string", default: "20" },
    slPips: { type: "string", default: "20" },
    to: { type: "string" },
    remote: { type: "boolean", default: false },
    dryRun: { type: "boolean", default: false },
    skipLog: { type: "boolean", default: false },
  },
});

const PAIR = values.pair.toUpperCase();
const K = Number(values.k);
const TP_PIPS = Number(values.tpPips);
const SL_PIPS = Number(values.slPips);
const MODEL_DIR = resolve(process.cwd(), values.modelDir);
const TO = (values.to ?? process.env.NOTIFICATION_EMAIL ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const sign = (v: number | null, unit = "", digits = 1): string => {
  if (v === null) return "N/A";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}${unit}`;
};

const prevBusinessDay = (date: string): string => {
  const [y, m1, d] = jstDateStrParts(date);
  let cur = new Date(Date.UTC(y, m1 - 1, d));
  for (let i = 0; i < 7; i++) {
    cur = new Date(cur.getTime() - 86400 * 1000);
    const cy = cur.getUTCFullYear();
    const cm = cur.getUTCMonth() + 1;
    const cd = cur.getUTCDate();
    if (dowFromJst(cy, cm, cd) <= 5) {
      return `${cy}-${String(cm).padStart(2, "0")}-${String(cd).padStart(2, "0")}`;
    }
  }
  throw new Error(`no business day before ${date}`);
};

type YesterdayReport = {
  date: string;
  direction: "LONG" | "SHORT";
  confidence: number;
  entryPrice: number;
  actualLabelPips: number | null;
  actualTpHitMin: number | null;
  actualSlHitMin: number | null;
  pnlPips: number | null;
  hit: number | null;
  knnLongPct: number;
  knnShortPct: number;
};

const buildYesterdayReport = async (
  store: PredictionStore,
  source: CandleSource,
  pair: string,
  date: string,
): Promise<YesterdayReport | null> => {
  const yDate = prevBusinessDay(date);
  const saved = await store.getPrediction(pair, yDate);
  if (!saved) return null;
  const outcome = await computeOutcome(source, pair, yDate, {
    tpPips: TP_PIPS,
    slPips: SL_PIPS,
  });
  if (!outcome) {
    return {
      date: yDate,
      direction: saved.direction,
      confidence: saved.confidence,
      entryPrice: saved.entryPrice,
      actualLabelPips: saved.actualLabelPips,
      actualTpHitMin: saved.actualTpHitMin,
      actualSlHitMin: saved.actualSlHitMin,
      pnlPips: saved.pnlPips,
      hit: saved.hit,
      knnLongPct: (saved.longWins / saved.k) * 100,
      knnShortPct: (saved.shortWins / saved.k) * 100,
    };
  }
  const pnl = computePnl(
    saved.direction,
    {
      actualLabelPips: outcome.label995Pips,
      actualTpHitMin: outcome.tpHitMin,
      actualSlHitMin: outcome.slHitMin,
    },
    TP_PIPS,
    SL_PIPS,
  );
  if (!values.skipLog && !values.dryRun) {
    await store.updateOutcome(pair, yDate, {
      actualLabelPips: outcome.label995Pips,
      actualTpHitMin: outcome.tpHitMin,
      actualSlHitMin: outcome.slHitMin,
      pnlPips: pnl.pnlPips,
      hit: pnl.hit,
    });
  }
  return {
    date: yDate,
    direction: saved.direction,
    confidence: saved.confidence,
    entryPrice: saved.entryPrice,
    actualLabelPips: outcome.label995Pips,
    actualTpHitMin: outcome.tpHitMin,
    actualSlHitMin: outcome.slHitMin,
    pnlPips: pnl.pnlPips,
    hit: pnl.hit,
    knnLongPct: (saved.longWins / saved.k) * 100,
    knnShortPct: (saved.shortWins / saved.k) * 100,
  };
};

const describeOutcome = (y: YesterdayReport): string => {
  if (y.pnlPips === null) return "結果未確定 (バー未整備)";
  const tp = y.actualTpHitMin;
  const sl = y.actualSlHitMin;
  if (tp !== null && sl !== null) {
    const first = tp < sl ? "TP" : "SL";
    return `${first} 先着 (${tp}m/${sl}m)`;
  }
  if (tp !== null) return `TP hit (${tp}m)`;
  if (sl !== null) return `SL hit (${sl}m)`;
  return `TP/SL 未達, 終値 ${sign(y.actualLabelPips, "p")}`;
};

const buildSubject = (r: PredictResult, y: YesterdayReport | null): string => {
  const [y1, m1, d] = jstDateStrParts(r.date);
  const dow = dowLabel(dowFromJst(y1, m1, d));
  const conf = (r.confidence * 100).toFixed(0);
  const suffix =
    y && y.pnlPips !== null
      ? ` [前日 ${y.hit ? "◯" : "✕"} ${sign(y.pnlPips, "p")}]`
      : "";
  return `【FX】${r.date} (${dow}) ${r.pair}: ${r.direction} (${conf}%)${suffix}`;
};

const buildText = (r: PredictResult, y: YesterdayReport | null): string => {
  const f = r.features;
  const [y1, m1, d] = jstDateStrParts(r.date);
  const dow = dowLabel(dowFromJst(y1, m1, d));
  const lines: string[] = [];
  lines.push(`FX シグナル [${r.pair}]  ${r.date} (${dow})  8:30 JST`);
  lines.push("");
  if (y) {
    const [yy, ym, yd] = jstDateStrParts(y.date);
    const ydow = dowLabel(dowFromJst(yy, ym, yd));
    lines.push(`━━ 昨日の答え合わせ (${y.date} ${ydow}) ━━`);
    lines.push(
      `  予測: ${y.direction} (${(y.confidence * 100).toFixed(0)}%)  エントリー ${y.entryPrice.toFixed(3)}`,
    );
    if (y.pnlPips !== null) {
      lines.push(
        `  結果: ${y.hit ? "◯ 勝ち" : "✕ 負け"} ${sign(y.pnlPips, "p")}  (${describeOutcome(y)})`,
      );
    } else {
      lines.push(`  結果: ${describeOutcome(y)}`);
    }
    lines.push(
      `  参考 kNN: LONG ${y.knnLongPct.toFixed(0)}%  SHORT ${y.knnShortPct.toFixed(0)}%`,
    );
    lines.push("");
  }
  lines.push(`推奨: ${r.direction}  (確信度 ${(r.confidence * 100).toFixed(1)}%)`);
  lines.push(`エントリー参考価格: ${f.entry_price.toFixed(3)}`);
  lines.push("");
  lines.push("今朝の状況:");
  lines.push(`  NY 変化 (前日8:30比):     ${sign(f.ny_delta_pips, "p")}`);
  lines.push(`  朝のトレンド (7:00→8:29): ${sign(f.morning_trend_bps, "bps")}`);
  lines.push(`  ゴトー日:                 ${f.gotoubi_flag ? "はい" : "いいえ"}`);
  lines.push("");
  lines.push(`過去 ${r.historySize} 営業日で今朝と似ていた日 上位 ${K} 件:`);
  lines.push(`  #   date         mt         nd        曜  ゴ  LONG      SHORT`);
  for (let i = 0; i < r.neighbors.length; i++) {
    const h = r.neighbors[i];
    const mt = sign(h.morning_trend_bps, "b");
    const nd = sign(h.ny_delta_pips, "p");
    lines.push(
      `  ${String(i + 1).padStart(2)}  ${h.date}  ${mt.padStart(8)}   ${nd.padStart(8)}  ${dowLabel(h.dow)}   ${h.gotoubi_flag ? "○" : "-"}  ${sign(h.pnl_long, "p").padStart(8)}  ${sign(h.pnl_short, "p").padStart(8)}`,
    );
  }
  lines.push("");
  lines.push(`類似日集計:`);
  lines.push(`  LONG  勝ち ${r.longWins}/${K} (${((r.longWins / K) * 100).toFixed(0)}%)  平均 ${sign(r.avgLong, "p")}`);
  lines.push(`  SHORT 勝ち ${r.shortWins}/${K} (${((r.shortWins / K) * 100).toFixed(0)}%)  平均 ${sign(r.avgShort, "p")}`);
  lines.push("");
  lines.push("運用メモ:");
  lines.push("  ・エントリー: 8:30 JST 近辺で成行");
  lines.push(`  ・利確/損切目安: ±${TP_PIPS} pips`);
  lines.push("  ・タイムカット: 9:55 JST までに手仕舞い");
  lines.push("  ・最終判断は類似日パターンをご確認ください (執行と決済はご自身で)");
  return lines.join("\n");
};

const buildHtml = (r: PredictResult, y: YesterdayReport | null): string => {
  const f = r.features;
  const [y1, m1, d] = jstDateStrParts(r.date);
  const dow = dowLabel(dowFromJst(y1, m1, d));
  const dirColor = r.direction === "LONG" ? "#16a34a" : "#dc2626";
  const dirLabel = r.direction === "LONG" ? "LONG (買い)" : "SHORT (売り)";

  const rows = r.neighbors
    .map((h, i) => {
      const mt = sign(h.morning_trend_bps, "b");
      const nd = sign(h.ny_delta_pips, "p");
      const lpColor = h.pnl_long > 0 ? "#16a34a" : h.pnl_long < 0 ? "#dc2626" : "#6b7280";
      const spColor = h.pnl_short > 0 ? "#16a34a" : h.pnl_short < 0 ? "#dc2626" : "#6b7280";
      return `<tr>
  <td style="padding:4px 8px;color:#6b7280;">${i + 1}</td>
  <td style="padding:4px 8px;font-family:monospace;">${h.date}</td>
  <td style="padding:4px 8px;font-family:monospace;text-align:right;">${mt}</td>
  <td style="padding:4px 8px;font-family:monospace;text-align:right;">${nd}</td>
  <td style="padding:4px 8px;text-align:center;">${dowLabel(h.dow)}</td>
  <td style="padding:4px 8px;text-align:center;">${h.gotoubi_flag ? "○" : "—"}</td>
  <td style="padding:4px 8px;font-family:monospace;text-align:right;color:${lpColor};">${sign(h.pnl_long, "p")}</td>
  <td style="padding:4px 8px;font-family:monospace;text-align:right;color:${spColor};">${sign(h.pnl_short, "p")}</td>
</tr>`;
    })
    .join("\n");

  const longPct = ((r.longWins / K) * 100).toFixed(0);
  const shortPct = ((r.shortWins / K) * 100).toFixed(0);

  const yesterdayBlock = y
    ? (() => {
        const [yy, ym, yd] = jstDateStrParts(y.date);
        const ydow = dowLabel(dowFromJst(yy, ym, yd));
        const resultColor =
          y.pnlPips === null ? "#6b7280" : y.hit ? "#16a34a" : "#dc2626";
        const resultLabel =
          y.pnlPips === null
            ? "結果未確定"
            : `${y.hit ? "◯ 勝ち" : "✕ 負け"}  ${sign(y.pnlPips, "p")}`;
        return `
  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;margin-bottom:20px;">
    <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">昨日の答え合わせ  ·  ${y.date} (${ydow})</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;">
      <div style="font-size:14px;color:#374151;">
        予測 <strong>${y.direction}</strong> (${(y.confidence * 100).toFixed(0)}%)  ·  entry ${y.entryPrice.toFixed(3)}
      </div>
      <div style="font-size:18px;font-weight:700;color:${resultColor};">${resultLabel}</div>
    </div>
    <div style="font-size:12px;color:#6b7280;margin-top:6px;">
      ${describeOutcome(y)}  ·  kNN LONG ${y.knnLongPct.toFixed(0)}% / SHORT ${y.knnShortPct.toFixed(0)}%
    </div>
  </div>`;
      })()
    : "";

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:20px;">
  <h2 style="margin:0 0 4px 0;color:#111827;">FX シグナル ${r.pair}</h2>
  <p style="margin:0 0 20px 0;color:#6b7280;">${r.date} (${dow}) 8:30 JST</p>
${yesterdayBlock}
  <div style="background:${dirColor};color:#fff;padding:16px 20px;border-radius:8px;margin-bottom:20px;">
    <div style="font-size:28px;font-weight:700;">${dirLabel}</div>
    <div style="font-size:14px;opacity:0.9;margin-top:4px;">確信度 ${(r.confidence * 100).toFixed(1)}%  &nbsp;·&nbsp;  エントリー参考 ${f.entry_price.toFixed(3)}</div>
  </div>

  <h3 style="margin:0 0 8px 0;font-size:14px;color:#374151;">今朝の状況</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;">
    <tr><td style="padding:6px 0;color:#6b7280;width:200px;">NY 変化 (前日8:30比)</td><td style="font-family:monospace;">${sign(f.ny_delta_pips, "p")}</td></tr>
    <tr><td style="padding:6px 0;color:#6b7280;">朝のトレンド (7:00→8:29)</td><td style="font-family:monospace;">${sign(f.morning_trend_bps, "bps")}</td></tr>
    <tr><td style="padding:6px 0;color:#6b7280;">ゴトー日</td><td>${f.gotoubi_flag ? "はい" : "いいえ"}</td></tr>
  </table>

  <h3 style="margin:0 0 8px 0;font-size:14px;color:#374151;">過去 ${r.historySize} 営業日で今朝と似ていた日 上位 ${K} 件</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px;">
    <thead>
      <tr style="border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:left;">
        <th style="padding:6px 8px;">#</th>
        <th style="padding:6px 8px;">日付</th>
        <th style="padding:6px 8px;text-align:right;">朝トレンド</th>
        <th style="padding:6px 8px;text-align:right;">NY変化</th>
        <th style="padding:6px 8px;text-align:center;">曜</th>
        <th style="padding:6px 8px;text-align:center;">ゴ</th>
        <th style="padding:6px 8px;text-align:right;">LONG pnl</th>
        <th style="padding:6px 8px;text-align:right;">SHORT pnl</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div style="background:#f3f4f6;padding:12px 16px;border-radius:6px;font-size:14px;margin-bottom:24px;">
    <div><strong>LONG 勝ち</strong> ${r.longWins}/${K} (${longPct}%) &nbsp; 平均 ${sign(r.avgLong, "p")}</div>
    <div><strong>SHORT 勝ち</strong> ${r.shortWins}/${K} (${shortPct}%) &nbsp; 平均 ${sign(r.avgShort, "p")}</div>
  </div>

  <h3 style="margin:0 0 8px 0;font-size:14px;color:#374151;">運用メモ</h3>
  <ul style="margin:0 0 20px 0;padding-left:20px;font-size:13px;color:#374151;line-height:1.7;">
    <li>エントリー: 8:30 JST 近辺で成行</li>
    <li>利確/損切目安: <strong>±${TP_PIPS} pips</strong> (モデル学習前提)</li>
    <li>タイムカット: <strong>9:55 JST</strong> までに手仕舞い</li>
    <li>最終判断は上の類似日パターンをご確認ください (執行と決済はご自身で)</li>
  </ul>

  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;margin:0;">
    stock-ai /fx  ·  ${r.seeds}-seed MLP ensemble  ·  過去3年のデータで学習
  </p>
</body></html>`;
};

const buildSource = (): CandleSource => {
  if (!values.remote) return localCandleSource();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "remote モードには CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN が必要です",
    );
  }
  return remoteCandleSource({ accountId, databaseId, apiToken });
};

const buildStore = (): PredictionStore => {
  if (!values.remote) return localPredictionStore();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "remote モードには CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN が必要です",
    );
  }
  return remotePredictionStore({ accountId, databaseId, apiToken });
};

const main = async () => {
  const date = values.date ?? todayJstDate();
  const [y, m1, d] = jstDateStrParts(date);
  const dow = dowFromJst(y, m1, d);
  if (dow > 5) {
    console.error(`skip: ${date} (${dowLabel(dow)}) は週末`);
    process.exit(0);
  }
  if (TO.length === 0) {
    console.error("error: NOTIFICATION_EMAIL (env or --to) を設定してください");
    process.exit(1);
  }

  const source = buildSource();
  const store = buildStore();

  const r = await predict({ pair: PAIR, date, modelDir: MODEL_DIR, k: K, source });

  let yReport: YesterdayReport | null = null;
  try {
    yReport = await buildYesterdayReport(store, source, PAIR, date);
  } catch (e) {
    console.warn(`昨日の答え合わせ取得失敗 (継続): ${(e as Error).message}`);
  }

  const savedNow: Omit<SavedPrediction, "updatedAt"> = {
    pair: PAIR,
    date,
    entryPrice: r.features.entry_price,
    direction: r.direction,
    probability: r.probability,
    confidence: r.confidence,
    longWins: r.longWins,
    shortWins: r.shortWins,
    avgLong: r.avgLong,
    avgShort: r.avgShort,
    k: K,
    seeds: r.seeds,
    actualLabelPips: null,
    actualTpHitMin: null,
    actualSlHitMin: null,
    pnlPips: null,
    hit: null,
  };

  const subject = buildSubject(r, yReport);
  const text = buildText(r, yReport);
  const html = buildHtml(r, yReport);

  if (values.dryRun) {
    console.log(`--- SUBJECT ---\n${subject}\n\n--- TEXT ---\n${text}\n\n--- HTML (${html.length} chars) ---`);
    return;
  }

  const res = await sendEmail({ to: TO, subject, html, text });
  console.log(`sent  id=${res.id}  to=${TO.join(",")}  subject=${subject}`);

  if (!values.skipLog) {
    try {
      await store.savePrediction(savedNow);
      console.log(`logged prediction  pair=${PAIR} date=${date} direction=${r.direction}`);
    } catch (e) {
      console.warn(`予測ログ保存失敗: ${(e as Error).message}`);
    }
  }
};

await main();
