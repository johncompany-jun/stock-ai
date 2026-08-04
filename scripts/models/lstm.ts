import * as tf from "@tensorflow/tfjs";
import type { ModelDef } from "./types";

export type LstmOptions = {
  window?: number;
  epochs?: number;
  units?: number;
};

export const createLstmModel = (opts: LstmOptions = {}): ModelDef => {
  const WINDOW = opts.window ?? 30;
  const EPOCHS = opts.epochs ?? 20;
  const UNITS = opts.units ?? 16;

  const predict = async (closes: number[], horizon: number): Promise<number[]> => {
    let min = Infinity;
    let max = -Infinity;
    for (const v of closes) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const normalized = closes.map((v) => (v - min) / span);

    const xs: number[][][] = [];
    const ys: number[][] = [];
    for (let i = 0; i <= normalized.length - WINDOW - 1; i++) {
      xs.push(normalized.slice(i, i + WINDOW).map((v) => [v]));
      ys.push([normalized[i + WINDOW]]);
    }
    const xsT = tf.tensor3d(xs, [xs.length, WINDOW, 1]);
    const ysT = tf.tensor2d(ys, [ys.length, 1]);

    const model = tf.sequential({
      layers: [
        tf.layers.lstm({ units: UNITS, inputShape: [WINDOW, 1] }),
        tf.layers.dense({ units: 1 }),
      ],
    });
    model.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });
    await model.fit(xsT, ysT, { epochs: EPOCHS, batchSize: 32, shuffle: true, verbose: 0 });

    const window = normalized.slice(-WINDOW);
    const preds: number[] = [];
    for (let i = 0; i < horizon; i++) {
      const input = tf.tensor3d([window.map((v) => [v])], [1, WINDOW, 1]);
      const p = model.predict(input) as tf.Tensor;
      const val = (await p.data())[0];
      preds.push(val);
      window.shift();
      window.push(val);
      input.dispose();
      p.dispose();
    }
    xsT.dispose();
    ysT.dispose();
    model.dispose();
    return preds.map((v) => v * span + min);
  };

  return { name: "lstm_v1", minCandles: WINDOW + 10, predict };
};
