import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import * as tf from "@tensorflow/tfjs";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    tpPips: { type: "string", default: "20" },
    slPips: { type: "string", default: "20" },
    spreadPips: { type: "string", default: "0.4" },
    threshold: { type: "string", default: "0.60" },
    trainEnd: { type: "string", default: "2024-06-30" },
    valEnd: { type: "string", default: "2024-12-31" },
    seeds: { type: "string", default: "5" },
    epochs: { type: "string", default: "150" },
  },
});

const PAIR = values.pair.toUpperCase();
const TP = Number(values.tpPips);
const SL = Number(values.slPips);
const SPREAD = Number(values.spreadPips);
const THRESHOLD = Number(values.threshold);
const TRAIN_END = values.trainEnd;
const VAL_END = values.valEnd;
const SEEDS = Number(values.seeds);
const EPOCHS = Number(values.epochs);

type Row = {
  date: string;
  ny_delta_pips: number | null;
  morning_trend_bps: number | null;
  gotoubi_flag: number;
  dow: number;
  label_995_pips: number | null;
  tp_hit_min: number | null;
  sl_hit_min: number | null;
};

const D1_ROOT = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject";
const findLocalDb = () => {
  const files = readdirSync(D1_ROOT).filter((f) => f.endsWith(".sqlite"));
  if (files.length === 0) throw new Error("no local D1 sqlite");
  return resolve(D1_ROOT, files[0]);
};

const pnlLong = (r: Row): number => {
  const label = r.label_995_pips as number;
  const { tp_hit_min: tp, sl_hit_min: sl } = r;
  if (tp === null && sl === null) return label;
  if (tp !== null && sl === null) return TP;
  if (sl !== null && tp === null) return -SL;
  return (tp as number) < (sl as number) ? TP : -SL;
};

const pnlShort = (r: Row): number => {
  const label = r.label_995_pips as number;
  const { tp_hit_min: tp, sl_hit_min: sl } = r;
  if (tp === null && sl === null) return -label;
  if (sl !== null && tp === null) return TP;
  if (tp !== null && sl === null) return -SL;
  return (sl as number) < (tp as number) ? TP : -SL;
};

const featurize = (r: Row, mean: number[], std: number[]): number[] => {
  const mt = ((r.morning_trend_bps ?? 0) - mean[0]) / std[0];
  const nd = ((r.ny_delta_pips ?? 0) - mean[1]) / std[1];
  const dow1 = r.dow === 1 ? 1 : 0;
  const dow2 = r.dow === 2 ? 1 : 0;
  const dow3 = r.dow === 3 ? 1 : 0;
  const dow4 = r.dow === 4 ? 1 : 0;
  const dow5 = r.dow === 5 ? 1 : 0;
  return [mt, nd, r.gotoubi_flag, dow1, dow2, dow3, dow4, dow5];
};

const main = async () => {
  const db = new Database(findLocalDb(), { readonly: true });
  const raw = db
    .query<Row, [string]>(
      "SELECT date, ny_delta_pips, morning_trend_bps, gotoubi_flag, dow, label_995_pips, tp_hit_min, sl_hit_min FROM fx_features WHERE pair = ? ORDER BY date",
    )
    .all(PAIR);
  db.close();

  const rows = raw.filter((r) => r.label_995_pips !== null);
  const train = rows.filter((r) => r.date <= TRAIN_END);
  const val = rows.filter((r) => r.date > TRAIN_END && r.date <= VAL_END);
  const test = rows.filter((r) => r.date > VAL_END);
  console.log(`splits: train=${train.length}  val=${val.length}  test=${test.length}  threshold=${THRESHOLD}  seeds=${SEEDS}\n`);

  // Normalization stats from train only
  const mts = train.map((r) => r.morning_trend_bps ?? 0);
  const nds = train.map((r) => r.ny_delta_pips ?? 0);
  const meanArr = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const stdArr = (a: number[], m: number) => Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1;
  const mtMean = meanArr(mts);
  const mtStd = stdArr(mts, mtMean);
  const ndMean = meanArr(nds);
  const ndStd = stdArr(nds, ndMean);
  const mean = [mtMean, ndMean];
  const std = [mtStd, ndStd];

  const X = (rs: Row[]) => rs.map((r) => featurize(r, mean, std));
  const Y = (rs: Row[]) => rs.map((r) => (pnlLong(r) > 0 ? 1 : 0));

  const trainX = X(train);
  const trainY = Y(train);
  const valX = X(val);
  const valY = Y(val);
  const testX = X(test);
  const trainPos = trainY.reduce((a, b) => a + b, 0);
  console.log(`train label balance: pos=${trainPos}/${trainY.length} (${((trainPos / trainY.length) * 100).toFixed(1)}%)\n`);

  const inputDim = trainX[0].length;

  // Multi-seed ensemble
  const testProbsAcc = new Array(test.length).fill(0);
  const valProbsAcc = new Array(val.length).fill(0);
  for (let seed = 0; seed < SEEDS; seed++) {
    tf.util.shuffle([]); // no-op; tfjs does not expose seed cleanly, but init randomness varies per call
    const model = tf.sequential({
      layers: [
        tf.layers.dense({ inputShape: [inputDim], units: 16, activation: "relu", kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }) }),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({ units: 8, activation: "relu" }),
        tf.layers.dense({ units: 1, activation: "sigmoid" }),
      ],
    });
    model.compile({ optimizer: tf.train.adam(1e-3), loss: "binaryCrossentropy", metrics: ["accuracy"] });

    const xt = tf.tensor2d(trainX);
    const yt = tf.tensor2d(trainY.map((v) => [v]));
    const xv = tf.tensor2d(valX);
    const yv = tf.tensor2d(valY.map((v) => [v]));

    let bestValLoss = Infinity;
    let bestWeights: tf.Tensor[] | null = null;
    let patience = 0;
    const MAX_PATIENCE = 20;
    for (let ep = 0; ep < EPOCHS; ep++) {
      const h = await model.fit(xt, yt, { epochs: 1, batchSize: 32, verbose: 0, shuffle: true });
      const [valLossT] = model.evaluate(xv, yv, { verbose: 0 }) as tf.Scalar[];
      const valLoss = (await valLossT.data())[0];
      valLossT.dispose();
      if (valLoss < bestValLoss - 1e-4) {
        bestValLoss = valLoss;
        if (bestWeights) bestWeights.forEach((w) => w.dispose());
        bestWeights = model.getWeights().map((w) => w.clone());
        patience = 0;
      } else {
        patience++;
        if (patience >= MAX_PATIENCE) break;
      }
      // suppress noisy logs
      void h;
    }
    if (bestWeights) model.setWeights(bestWeights);

    const testPred = model.predict(tf.tensor2d(testX)) as tf.Tensor;
    const testProbs = Array.from(await testPred.data());
    testPred.dispose();
    for (let i = 0; i < testProbs.length; i++) testProbsAcc[i] += testProbs[i] / SEEDS;

    const valPred = model.predict(xv) as tf.Tensor;
    const valProbs = Array.from(await valPred.data());
    valPred.dispose();
    for (let i = 0; i < valProbs.length; i++) valProbsAcc[i] += valProbs[i] / SEEDS;

    xt.dispose();
    yt.dispose();
    xv.dispose();
    yv.dispose();
    if (bestWeights) bestWeights.forEach((w) => w.dispose());
    model.dispose();
    process.stdout.write(`  seed ${seed + 1}/${SEEDS}: best_val_loss=${bestValLoss.toFixed(4)}\n`);
  }

  // Val: threshold sweep
  console.log("\n[val set — threshold sweep]");
  const sweep = [0.5, 0.55, 0.58, 0.6, 0.62, 0.65];
  for (const th of sweep) {
    const stats = evalSet(val, valProbsAcc, th);
    printSignalStats(`th=${th.toFixed(2)}`, stats);
  }

  // Test: threshold sweep (to see if any threshold works out-of-sample)
  console.log("\n[test set — threshold sweep]");
  for (const th of sweep) {
    const stats = evalSet(test, testProbsAcc, th);
    printSignalStats(`th=${th.toFixed(2)}`, stats);
  }

  // Test: baselines
  console.log("\n[test set — baselines]");
  const alwaysLong = evalRule(test, () => "LONG");
  printSignalStats("always LONG", alwaysLong);
  const gotoubiLong = evalRule(test, (r) => (r.gotoubi_flag === 1 ? "LONG" : "SKIP"));
  printSignalStats("gotoubi LONG only", gotoubiLong);
  const avoidMondayLong = evalRule(test, (r) => (r.dow === 1 ? "SKIP" : "LONG"));
  printSignalStats("LONG except Mon", avoidMondayLong);
};

type SignalStats = {
  n: number;
  longs: number;
  shorts: number;
  skips: number;
  wins: number;
  losses: number;
  sumPips: number;
  sumNetPips: number;
};

const evalSet = (rows: Row[], probs: number[], threshold: number): SignalStats => {
  const s: SignalStats = { n: rows.length, longs: 0, shorts: 0, skips: 0, wins: 0, losses: 0, sumPips: 0, sumNetPips: 0 };
  for (let i = 0; i < rows.length; i++) {
    const p = probs[i];
    const r = rows[i];
    let pnl = 0;
    let acted = false;
    if (p >= threshold) {
      pnl = pnlLong(r);
      acted = true;
      s.longs++;
    } else if (p <= 1 - threshold) {
      pnl = pnlShort(r);
      acted = true;
      s.shorts++;
    } else {
      s.skips++;
    }
    if (acted) {
      s.sumPips += pnl;
      s.sumNetPips += pnl - SPREAD;
      if (pnl > 0) s.wins++;
      else if (pnl < 0) s.losses++;
    }
  }
  return s;
};

const evalRule = (rows: Row[], rule: (r: Row) => "LONG" | "SHORT" | "SKIP"): SignalStats => {
  const s: SignalStats = { n: rows.length, longs: 0, shorts: 0, skips: 0, wins: 0, losses: 0, sumPips: 0, sumNetPips: 0 };
  for (const r of rows) {
    const act = rule(r);
    if (act === "SKIP") {
      s.skips++;
      continue;
    }
    const pnl = act === "LONG" ? pnlLong(r) : pnlShort(r);
    if (act === "LONG") s.longs++;
    else s.shorts++;
    s.sumPips += pnl;
    s.sumNetPips += pnl - SPREAD;
    if (pnl > 0) s.wins++;
    else if (pnl < 0) s.losses++;
  }
  return s;
};

const printSignalStats = (label: string, s: SignalStats) => {
  const trades = s.longs + s.shorts;
  if (trades === 0) {
    console.log(`  ${label.padEnd(28)}  trades=0 (all skipped)`);
    return;
  }
  const winRate = ((s.wins / trades) * 100).toFixed(1);
  const avgNet = (s.sumNetPips / trades).toFixed(2);
  const totalNet = s.sumNetPips.toFixed(0);
  console.log(
    `  ${label.padEnd(28)}  trades=${String(trades).padStart(3)}  L/S/skip=${s.longs}/${s.shorts}/${s.skips}  win%=${winRate.padStart(5)}  net_avg=${avgNet.padStart(6)}p  net_total=${totalNet.padStart(6)}p`,
  );
};

await main();
