import { Database } from "bun:sqlite";
import { readdirSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Candle } from "./patterns/types";

const RANGE_WINDOW = 90;
const DRIFT_WINDOW = 252;
const MIN_AMPLITUDE = 0.15;
const MAX_DRIFT = 0.15;
const BUY_POSITION = 0.3;

const { values } = parseArgs({
  options: {
    startCapital: { type: "string", default: "500000" },
    positionSize: { type: "string", default: "100000" },
    maxPositions: { type: "string", default: "5" },
    holdDays: { type: "string", default: "90" },
    markets: { type: "string", default: "東S,東G,東P" },
    minPrice: { type: "string", default: "100" },
    maxPrice: { type: "string", default: "2000" },
    sourceUrl: { type: "string" },
  },
});

const START_CAPITAL = Number(values.startCapital);
const POSITION_SIZE = Number(values.positionSize);
const MAX_POSITIONS = Number(values.maxPositions);
const HOLD_DAYS = Number(values.holdDays);
const MARKETS = values.markets!.split(",").map((s) => s.trim());
const MIN_PRICE = Number(values.minPrice);
const MAX_PRICE = Number(values.maxPrice);

const findSqlitePath = (): string => {
  const dir = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  if (!files.length) throw new Error(`no sqlite in ${dir}`);
  const withSize = files.map((f) => ({ f, size: statSync(`${dir}/${f}`).size }));
  withSize.sort((a, b) => b.size - a.size);
  return `${dir}/${withSize[0].f}`;
};

type Signal = {
  signalDate: number;
  code: string;
  position: number;
};

type Trade = {
  code: string;
  signalDate: number;
  buyDate: number;
  buyPrice: number;
  sellDate: number;
  sellPrice: number;
  shares: number;
  investment: number;
  pnlYen: number;
  pnlPct: number;
};

type OpenPosition = {
  code: string;
  signalDate: number;
  buyDate: number;
  buyPrice: number;
  shares: number;
  investment: number;
  buyIdx: number;
};

const scanStock = (code: string, candles: Candle[]): Signal[] => {
  const signals: Signal[] = [];
  const minIdx = DRIFT_WINDOW;
  for (let idx = minIdx; idx < candles.length - 1; idx++) {
    const today = candles[idx];
    if (today.close <= today.open) continue;
    if (today.close < MIN_PRICE || today.close > MAX_PRICE) continue;

    let hi = -Infinity;
    let lo = Infinity;
    for (let i = idx - RANGE_WINDOW; i < idx; i++) {
      const c = candles[i].close;
      if (c > hi) hi = c;
      if (c < lo) lo = c;
    }
    if (lo <= 0) continue;
    const amplitude = (hi - lo) / lo;
    if (amplitude < MIN_AMPLITUDE) continue;

    const priceYearAgo = candles[idx - DRIFT_WINDOW].close;
    if (priceYearAgo <= 0) continue;
    const drift = Math.abs(today.close - priceYearAgo) / priceYearAgo;
    if (drift > MAX_DRIFT) continue;

    const position = (today.close - lo) / (hi - lo);
    if (position > BUY_POSITION) continue;

    signals.push({ signalDate: today.date, code, position });
  }
  return signals;
};

const main = () => {
  const path = findSqlitePath();
  console.log(`sqlite: ${path}`);
  const db = new Database(path);

  const placeholders = MARKETS.map(() => "?").join(",");
  const stocksRows = db
    .query(`SELECT code FROM stocks WHERE market IN (${placeholders})`)
    .all(...MARKETS) as { code: string }[];
  console.log(`stocks: ${stocksRows.length}`);

  const candlesByCode = new Map<string, Candle[]>();
  const candleStmt = db.query(
    "SELECT date, open, high, low, close, volume FROM candles WHERE code = ? AND close > 0 ORDER BY date ASC",
  );
  for (const { code } of stocksRows) {
    const rows = candleStmt.all(code) as Candle[];
    if (rows.length >= DRIFT_WINDOW + 2) candlesByCode.set(code, rows);
  }
  console.log(`loaded candles for ${candlesByCode.size} stocks`);

  const idxByCode = new Map<string, Map<number, number>>();
  for (const [code, candles] of candlesByCode) {
    const m = new Map<number, number>();
    for (let i = 0; i < candles.length; i++) m.set(candles[i].date, i);
    idxByCode.set(code, m);
  }

  const t0 = Date.now();
  const allSignals: Signal[] = [];
  for (const [code, candles] of candlesByCode) {
    allSignals.push(...scanStock(code, candles));
  }
  console.log(
    `signals: ${allSignals.length}  scan ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  const signalsByDate = new Map<number, Signal[]>();
  for (const s of allSignals) {
    const list = signalsByDate.get(s.signalDate) ?? [];
    list.push(s);
    signalsByDate.set(s.signalDate, list);
  }

  const allDates = Array.from(
    new Set(
      Array.from(candlesByCode.values()).flatMap((cs) => cs.map((c) => c.date)),
    ),
  ).sort((a, b) => a - b);

  const nextDateIdx = new Map<number, number>();
  for (let i = 0; i < allDates.length; i++) nextDateIdx.set(allDates[i], i);

  let cash = START_CAPITAL;
  const openPositions: OpenPosition[] = [];
  const trades: Trade[] = [];
  const equitySeries: Array<{ date: number; equity: number }> = [];

  for (const d of allDates) {
    const dIdx = nextDateIdx.get(d)!;

    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      const posCandles = candlesByCode.get(pos.code)!;
      const posIdx = idxByCode.get(pos.code)!.get(d);
      if (posIdx == null) continue;
      if (posIdx - pos.buyIdx < HOLD_DAYS) continue;
      const sellPrice = posCandles[posIdx].close;
      const sellValue = sellPrice * pos.shares;
      cash += sellValue;
      trades.push({
        code: pos.code,
        signalDate: pos.signalDate,
        buyDate: pos.buyDate,
        buyPrice: pos.buyPrice,
        sellDate: d,
        sellPrice,
        shares: pos.shares,
        investment: pos.investment,
        pnlYen: sellValue - pos.investment,
        pnlPct: ((sellPrice - pos.buyPrice) / pos.buyPrice) * 100,
      });
      openPositions.splice(i, 1);
    }

    const todaySignals = signalsByDate.get(d) ?? [];
    todaySignals.sort((a, b) => a.position - b.position);

    for (const sig of todaySignals) {
      if (openPositions.length >= MAX_POSITIONS) break;
      if (cash < POSITION_SIZE) break;
      if (openPositions.some((p) => p.code === sig.code)) continue;

      const sigCandles = candlesByCode.get(sig.code)!;
      const sigIdx = idxByCode.get(sig.code)!.get(d);
      if (sigIdx == null || sigIdx + 1 >= sigCandles.length) continue;
      const buyIdx = sigIdx + 1;
      const buyDate = sigCandles[buyIdx].date;
      const buyPrice = sigCandles[buyIdx].open;
      if (buyPrice <= 0) continue;
      const lots = Math.floor(POSITION_SIZE / (buyPrice * 100));
      if (lots <= 0) continue;
      const shares = lots * 100;
      const investment = buyPrice * shares;
      if (cash < investment) continue;
      cash -= investment;
      openPositions.push({
        code: sig.code,
        signalDate: sig.signalDate,
        buyDate,
        buyPrice,
        shares,
        investment,
        buyIdx,
      });
    }

    let heldValue = 0;
    for (const pos of openPositions) {
      const posIdx = idxByCode.get(pos.code)!.get(d);
      if (posIdx != null) {
        heldValue += candlesByCode.get(pos.code)![posIdx].close * pos.shares;
      } else {
        heldValue += pos.investment;
      }
    }
    equitySeries.push({ date: d, equity: cash + heldValue });
  }

  for (const pos of openPositions) {
    const posCandles = candlesByCode.get(pos.code)!;
    const lastIdx = posCandles.length - 1;
    const sellPrice = posCandles[lastIdx].close;
    cash += sellPrice * pos.shares;
    trades.push({
      code: pos.code,
      signalDate: pos.signalDate,
      buyDate: pos.buyDate,
      buyPrice: pos.buyPrice,
      sellDate: posCandles[lastIdx].date,
      sellPrice,
      shares: pos.shares,
      investment: pos.investment,
      pnlYen: sellPrice * pos.shares - pos.investment,
      pnlPct: ((sellPrice - pos.buyPrice) / pos.buyPrice) * 100,
    });
  }

  const finalEquity = cash;
  const totalReturn = ((finalEquity - START_CAPITAL) / START_CAPITAL) * 100;
  const n = trades.length;
  const wins = trades.filter((t) => t.pnlYen > 0).length;
  const winRate = (wins / n) * 100;
  const avgPnl = trades.reduce((s, t) => s + t.pnlYen, 0) / n;
  const avgPct = trades.reduce((s, t) => s + t.pnlPct, 0) / n;
  const totalPnl = trades.reduce((s, t) => s + t.pnlYen, 0);

  let peak = START_CAPITAL;
  let maxDrawdown = 0;
  for (const { equity } of equitySeries) {
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const yrSpan = (allDates[allDates.length - 1] - allDates[0]) / 10000;

  console.log("\n=== Simulation Result ===");
  console.log(`期間: ${allDates[0]} 〜 ${allDates[allDates.length - 1]} (~${yrSpan.toFixed(1)}年)`);
  console.log(`開始残高: ${START_CAPITAL.toLocaleString()}円`);
  console.log(`終了残高: ${Math.round(finalEquity).toLocaleString()}円`);
  console.log(`トータル損益: ${Math.round(totalPnl).toLocaleString()}円 (${totalReturn.toFixed(2)}%)`);
  console.log(`年率換算: ${(totalReturn / yrSpan).toFixed(2)}%`);
  console.log(`最大ドローダウン: ${maxDrawdown.toFixed(2)}%`);
  console.log(``);
  console.log(`トレード数: ${n}`);
  console.log(`勝率: ${winRate.toFixed(2)}%  (勝ち ${wins} / 負け ${n - wins})`);
  console.log(`平均損益: ${Math.round(avgPnl).toLocaleString()}円 / トレード (${avgPct.toFixed(2)}%)`);
  console.log(``);
  const bestTrade = [...trades].sort((a, b) => b.pnlYen - a.pnlYen)[0];
  const worstTrade = [...trades].sort((a, b) => a.pnlYen - b.pnlYen)[0];
  console.log(`ベストトレード: ${bestTrade.code} ${bestTrade.buyDate}→${bestTrade.sellDate}  ${Math.round(bestTrade.pnlYen).toLocaleString()}円 (${bestTrade.pnlPct.toFixed(2)}%)`);
  console.log(`ワーストトレード: ${worstTrade.code} ${worstTrade.buyDate}→${worstTrade.sellDate}  ${Math.round(worstTrade.pnlYen).toLocaleString()}円 (${worstTrade.pnlPct.toFixed(2)}%)`);

  console.log(``);
  console.log(`=== Equity Curve (月初ピックアップ) ===`);
  let lastMonth = -1;
  for (const { date, equity } of equitySeries) {
    const month = Math.floor(date / 100);
    if (month !== lastMonth) {
      console.log(`  ${date}  ${Math.round(equity).toLocaleString()}円  (${(((equity - START_CAPITAL) / START_CAPITAL) * 100).toFixed(2)}%)`);
      lastMonth = month;
    }
  }

  db.close();
};

main();
