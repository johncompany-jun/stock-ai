import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { sendEmail } from "./lib/send-email";
import { dowFromJst, dowLabel, jstDateStrParts, predict, todayJstDate, type PredictResult } from "./lib/fx-predict";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    date: { type: "string" },
    k: { type: "string", default: "10" },
    modelDir: { type: "string", default: "data/fx/model" },
    to: { type: "string" },
    dryRun: { type: "boolean", default: false },
  },
});

const PAIR = values.pair.toUpperCase();
const K = Number(values.k);
const MODEL_DIR = resolve(process.cwd(), values.modelDir);
const TO = values.to ?? process.env.NOTIFICATION_EMAIL;

const sign = (v: number | null, unit = "", digits = 1): string => {
  if (v === null) return "N/A";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(digits)}${unit}`;
};

const buildSubject = (r: PredictResult): string => {
  const [y, m1, d] = jstDateStrParts(r.date);
  const dow = dowLabel(dowFromJst(y, m1, d));
  const conf = (r.confidence * 100).toFixed(0);
  return `【FX】${r.date} (${dow}) ${r.pair}: ${r.direction} (${conf}%)`;
};

const buildText = (r: PredictResult): string => {
  const f = r.features;
  const [y, m1, d] = jstDateStrParts(r.date);
  const dow = dowLabel(dowFromJst(y, m1, d));
  const lines: string[] = [];
  lines.push(`FX シグナル [${r.pair}]  ${r.date} (${dow})  8:30 JST`);
  lines.push("");
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
  lines.push("  ・利確/損切目安: ±20 pips");
  lines.push("  ・タイムカット: 9:55 JST までに手仕舞い");
  lines.push("  ・最終判断は類似日パターンをご確認ください (執行と決済はご自身で)");
  return lines.join("\n");
};

const buildHtml = (r: PredictResult): string => {
  const f = r.features;
  const [y, m1, d] = jstDateStrParts(r.date);
  const dow = dowLabel(dowFromJst(y, m1, d));
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

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:20px;">
  <h2 style="margin:0 0 4px 0;color:#111827;">FX シグナル ${r.pair}</h2>
  <p style="margin:0 0 20px 0;color:#6b7280;">${r.date} (${dow}) 8:30 JST</p>

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
    <li>利確/損切目安: <strong>±20 pips</strong> (モデル学習前提)</li>
    <li>タイムカット: <strong>9:55 JST</strong> までに手仕舞い</li>
    <li>最終判断は上の類似日パターンをご確認ください (執行と決済はご自身で)</li>
  </ul>

  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;margin:0;">
    stock-ai /fx  ·  ${r.seeds}-seed MLP ensemble  ·  過去3年のデータで学習
  </p>
</body></html>`;
};

const main = async () => {
  const date = values.date ?? todayJstDate();
  const [y, m1, d] = jstDateStrParts(date);
  const dow = dowFromJst(y, m1, d);
  if (dow > 5) {
    console.error(`skip: ${date} (${dowLabel(dow)}) は週末`);
    process.exit(0);
  }
  if (!TO) {
    console.error("error: NOTIFICATION_EMAIL (env or --to) を設定してください");
    process.exit(1);
  }

  const r = await predict({ pair: PAIR, date, modelDir: MODEL_DIR, k: K });
  const subject = buildSubject(r);
  const text = buildText(r);
  const html = buildHtml(r);

  if (values.dryRun) {
    console.log(`--- SUBJECT ---\n${subject}\n\n--- TEXT ---\n${text}\n\n--- HTML (${html.length} chars) ---`);
    return;
  }

  const res = await sendEmail({ to: TO, subject, html, text });
  console.log(`sent  id=${res.id}  to=${TO}  subject=${subject}`);
};

await main();
