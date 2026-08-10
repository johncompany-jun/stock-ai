import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import * as tf from "@tensorflow/tfjs";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    tpPips: { type: "string", default: "20" },
    slPips: { type: "string", default: "20" },
    trainEnd: { type: "string", default: "2024-12-31" },
    seeds: { type: "string", default: "5" },
    epochs: { type: "string", default: "80" },
    outDir: { type: "string", default: "data/fx/model" },
  },
});

const PAIR = values.pair.toUpperCase();
const TP = Number(values.tpPips);
const SL = Number(values.slPips);
const TRAIN_END = values.trainEnd;
const SEEDS = Number(values.seeds);
const EPOCHS = Number(values.epochs);
const OUT_DIR = resolve(process.cwd(), values.outDir);

type Row = {
  date: string;
  entry_price: number;
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

const featurize = (
  morning_trend_bps: number | null,
  ny_delta_pips: number | null,
  gotoubi_flag: number,
  dow: number,
  mean: [number, number],
  std: [number, number],
): number[] => {
  const mt = ((morning_trend_bps ?? 0) - mean[0]) / std[0];
  const nd = ((ny_delta_pips ?? 0) - mean[1]) / std[1];
  return [
    mt,
    nd,
    gotoubi_flag,
    dow === 1 ? 1 : 0,
    dow === 2 ? 1 : 0,
    dow === 3 ? 1 : 0,
    dow === 4 ? 1 : 0,
    dow === 5 ? 1 : 0,
  ];
};

const buildModel = (inputDim: number): tf.Sequential => {
  const m = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [inputDim], units: 16, activation: "relu", kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 }) }),
      tf.layers.dropout({ rate: 0.3 }),
      tf.layers.dense({ units: 8, activation: "relu" }),
      tf.layers.dense({ units: 1, activation: "sigmoid" }),
    ],
  });
  m.compile({ optimizer: tf.train.adam(1e-3), loss: "binaryCrossentropy", metrics: ["accuracy"] });
  return m;
};

const saveModel = async (model: tf.LayersModel, seedIdx: number, dir: string) => {
  const handler = tf.io.withSaveHandler(async (artifacts) => {
    writeFileSync(
      `${dir}/seed_${seedIdx}.json`,
      JSON.stringify({
        modelTopology: artifacts.modelTopology,
        weightSpecs: artifacts.weightSpecs,
        weightData: Buffer.from(artifacts.weightData as ArrayBuffer).toString("base64"),
      }),
    );
    return {
      modelArtifactsInfo: {
        dateSaved: new Date(),
        modelTopologyType: "JSON",
      },
    };
  });
  await model.save(handler);
};

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const db = new Database(findLocalDb(), { readonly: true });
  const raw = db
    .query<Row, [string]>(
      "SELECT date, entry_price, ny_delta_pips, morning_trend_bps, gotoubi_flag, dow, label_995_pips, tp_hit_min, sl_hit_min FROM fx_features WHERE pair = ? ORDER BY date",
    )
    .all(PAIR);
  db.close();

  const rows = raw.filter((r) => r.label_995_pips !== null);
  const train = rows.filter((r) => r.date <= TRAIN_END);
  console.log(`pair=${PAIR}  total=${rows.length}  train=${train.length} (through ${TRAIN_END})  seeds=${SEEDS}  epochs=${EPOCHS}`);

  const mts = train.map((r) => r.morning_trend_bps ?? 0);
  const nds = train.map((r) => r.ny_delta_pips ?? 0);
  const meanArr = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const stdArr = (a: number[], m: number) => Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) || 1;
  const mtMean = meanArr(mts);
  const mtStd = stdArr(mts, mtMean);
  const ndMean = meanArr(nds);
  const ndStd = stdArr(nds, ndMean);
  const mean: [number, number] = [mtMean, ndMean];
  const std: [number, number] = [mtStd, ndStd];

  writeFileSync(
    `${OUT_DIR}/normalization.json`,
    JSON.stringify({ mtMean, mtStd, ndMean, ndStd }, null, 2),
  );
  console.log(`saved normalization.json  (mt μ=${mtMean.toFixed(2)} σ=${mtStd.toFixed(2)}  nd μ=${ndMean.toFixed(2)} σ=${ndStd.toFixed(2)})`);

  const trainX = train.map((r) => featurize(r.morning_trend_bps, r.ny_delta_pips, r.gotoubi_flag, r.dow, mean, std));
  const trainY = train.map((r) => (pnlLong(r) > 0 ? 1 : 0));
  const inputDim = trainX[0].length;
  const trainPos = trainY.reduce((a, b) => a + b, 0);
  console.log(`train label balance: pos=${trainPos}/${trainY.length} (${((trainPos / trainY.length) * 100).toFixed(1)}%)`);

  for (let seed = 0; seed < SEEDS; seed++) {
    tf.util.shuffle([]);
    const model = buildModel(inputDim);
    const xt = tf.tensor2d(trainX);
    const yt = tf.tensor2d(trainY.map((v) => [v]));
    await model.fit(xt, yt, { epochs: EPOCHS, batchSize: 32, verbose: 0, shuffle: true });
    await saveModel(model, seed, OUT_DIR);
    xt.dispose();
    yt.dispose();
    model.dispose();
    process.stdout.write(`  seed ${seed + 1}/${SEEDS} saved\n`);
  }

  // kNN historical features: use ALL labeled rows (train + validation + test)
  // for the widest possible pool of "similar past days" to show as evidence.
  const knn = rows.map((r) => ({
    date: r.date,
    entry_price: r.entry_price,
    morning_trend_bps: r.morning_trend_bps,
    ny_delta_pips: r.ny_delta_pips,
    gotoubi_flag: r.gotoubi_flag,
    dow: r.dow,
    features: featurize(r.morning_trend_bps, r.ny_delta_pips, r.gotoubi_flag, r.dow, mean, std),
    pnl_long: pnlLong(r),
    pnl_short: pnlShort(r),
  }));
  writeFileSync(`${OUT_DIR}/features.json`, JSON.stringify(knn));
  console.log(`saved features.json  (${knn.length} historical days for kNN)`);

  writeFileSync(
    `${OUT_DIR}/meta.json`,
    JSON.stringify(
      {
        pair: PAIR,
        tp_pips: TP,
        sl_pips: SL,
        train_end: TRAIN_END,
        seeds: SEEDS,
        epochs: EPOCHS,
        saved_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`saved meta.json  →  ${OUT_DIR}`);
};

await main();
