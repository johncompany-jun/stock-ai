import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgpu";

const WINDOW = 30;

async function init() {
  let backend = "cpu";
  for (const candidate of ["webgpu", "webgl", "cpu"] as const) {
    try {
      await tf.setBackend(candidate);
      await tf.ready();
      backend = candidate;
      break;
    } catch {}
  }
  postMessage({ type: "ready", backend });
}

type PredictRequest = {
  type: "predict";
  requestId: number;
  normalized: number[];
  horizon: number;
};

async function trainAndPredict(normalized: number[], horizon: number) {
  if (normalized.length < WINDOW + 10) {
    return { predictions: [] as number[], error: "not enough data" };
  }

  const prevBackend = tf.getBackend();
  if (prevBackend !== "cpu") {
    await tf.setBackend("cpu");
    await tf.ready();
  }
  console.log("[worker] training on", tf.getBackend(), "samples=", normalized.length - WINDOW);

  try {
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
        tf.layers.lstm({ units: 16, inputShape: [WINDOW, 1] }),
        tf.layers.dense({ units: 1 }),
      ],
    });
    model.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });

    const t0 = performance.now();
    await model.fit(xsT, ysT, {
      epochs: 20,
      batchSize: 32,
      shuffle: true,
      verbose: 0,
    });
    console.log("[worker] fit done in", Math.round(performance.now() - t0), "ms");

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

    console.log("[worker] predictions", preds);
    return { predictions: preds };
  } finally {
    if (prevBackend !== "cpu") {
      await tf.setBackend(prevBackend);
      await tf.ready();
    }
  }
}

self.onmessage = async (e: MessageEvent) => {
  const data = e.data as { type: string } & Partial<PredictRequest>;
  console.log("[worker] received", data.type, "req=", data.requestId);
  if (data.type === "predict") {
    const { normalized, horizon, requestId } = data as PredictRequest;
    try {
      const result = await trainAndPredict(normalized, horizon);
      postMessage({ type: "predict-result", requestId, ...result });
    } catch (err) {
      console.error("[worker] predict error", err);
      postMessage({
        type: "predict-result",
        requestId,
        error: (err as Error).message || String(err),
      });
    }
  } else if (data.type === "test") {
    const t = tf.tensor1d([1, 2, 3]);
    const sum = (await t.sum().data())[0];
    t.dispose();
    postMessage({ type: "result", value: sum });
  }
};

self.addEventListener("error", (e) => {
  console.error("[worker] uncaught", e.message);
});

init();
