<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Chart, registerables } from "chart.js";
import {
  denormalize,
  extractCloses,
  formatDate,
  minMaxNormalize,
  nextBusinessDates,
  type Candle,
} from "./ml/preprocess";

const HORIZON = 5;

Chart.register(...registerables);

type Stock = {
  code: string;
  name: string;
  market: string;
  price: number | null;
  changeAbs: number | null;
  changePct: number | null;
};

const apiStatus = ref("checking...");
const tfBackend = ref("initializing...");

const selected = ref<Stock | null>(null);
const chartLoading = ref(false);
const chartError = ref<string | null>(null);
const chartCanvas = ref<HTMLCanvasElement | null>(null);
const chartPanel = ref<HTMLElement | null>(null);
const predicting = ref(false);
const predictionError = ref<string | null>(null);
type PredictionResult = {
  lastClose: number;
  target: number;
  pct: number;
};
const predictionResult = ref<PredictionResult | null>(null);
let chartInstance: Chart | null = null;
let worker: Worker | null = null;

type PredictContext = {
  candles: Candle[];
  closes: number[];
  min: number;
  max: number;
};
const pendingPredict = new Map<number, PredictContext>();

type Ranking = {
  code: string;
  name: string;
  market: string;
  modelName: string;
  currentClose: number;
  currentDate: number;
  predictedClose: number;
  expectedReturnPct: number;
  lastDate: number;
  runAt: number;
  buyableLots: number;
  expectedProfitYen: number;
  predictionsByModel: Record<string, number | null>;
  agreement: number;
  agreementTotal: number;
  returnStdevPct: number;
  confidence: number;
};

const BUDGET_PRESETS = [50000, 100000, 300000, 500000];
const budget = ref(100000);
const sortMode = ref<"profit" | "return">("profit");
const rankings = ref<Ranking[]>([]);
const rankingsLoading = ref(false);
const rankingsRunAt = ref<number | null>(null);

type BacktestHorizon = {
  horizonDays: number;
  n: number;
  maePct: number;
  rmsePct: number;
  hitPct: number;
  biasPct: number;
};
type BacktestResponse = {
  model: string;
  meta: { rows: number; stocks: number; runDates: number };
  byHorizon: BacktestHorizon[];
};
type AgreementBucket = {
  horizonDays: number;
  agreement: number;
  agreementTotal: number;
  n: number;
  hitPct: number;
};
type AgreementResponse = { model: string; buckets: AgreementBucket[] };
type ModelOption = { key: string; label: string; shortLabel: string; ensemble?: boolean };
const MODEL_OPTIONS: ModelOption[] = [
  { key: "ensemble_v1", label: "アンサンブル (加重平均)", shortLabel: "MIX", ensemble: true },
  { key: "lstm_v1", label: "LSTM (深層学習)", shortLabel: "LSTM" },
  { key: "sma_cross_v1", label: "SMAクロス (移動平均)", shortLabel: "SMA" },
  { key: "rsi_reversal_v1", label: "RSI逆張り", shortLabel: "RSI" },
  { key: "volume_breakout_v1", label: "出来高ブレイク", shortLabel: "VOL" },
];
const BACKTEST_MODEL_OPTIONS = MODEL_OPTIONS.filter((m) => !m.ensemble);
const selectedModel = ref<string>("ensemble_v1");
const selectedBacktestModel = ref<string>("lstm_v1");
const AGREEMENT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "全て" },
  { value: 2, label: "2以上" },
  { value: 3, label: "3以上" },
  { value: 4, label: "4のみ" },
];
const minAgreement = ref<number>(0);
const backtest = ref<BacktestResponse | null>(null);
const agreement = ref<AgreementResponse | null>(null);
const backtestLoading = ref(false);
const backtestError = ref<string | null>(null);
let backtestSeq = 0;
const fetchBacktest = async () => {
  const my = ++backtestSeq;
  backtestLoading.value = true;
  backtestError.value = null;
  try {
    const params = new URLSearchParams({ model: selectedBacktestModel.value });
    const [r1, r2] = await Promise.all([
      fetch(`/api/backtest?${params}`),
      fetch(`/api/backtest-agreement?${params}`),
    ]);
    if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
    const j1 = (await r1.json()) as BacktestResponse;
    const j2 = r2.ok ? ((await r2.json()) as AgreementResponse) : null;
    if (my !== backtestSeq) return;
    backtest.value = j1;
    agreement.value = j2;
  } catch (e) {
    if (my === backtestSeq) backtestError.value = String(e);
  } finally {
    if (my === backtestSeq) backtestLoading.value = false;
  }
};

const agreementByHorizon = computed(() => {
  const buckets = agreement.value?.buckets ?? [];
  const map = new Map<number, AgreementBucket[]>();
  for (const b of buckets) {
    const arr = map.get(b.horizonDays) ?? [];
    arr.push(b);
    map.set(b.horizonDays, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([horizon, rows]) => ({ horizon, rows }));
});

let rankSeq = 0;
const fetchRankings = async () => {
  const my = ++rankSeq;
  rankingsLoading.value = true;
  try {
    const params = new URLSearchParams({
      budget: String(budget.value),
      limit: "20",
      sort: sortMode.value,
      model: selectedModel.value,
      minAgreement: String(minAgreement.value),
    });
    const r = await fetch(`/api/rankings?${params}`);
    const j = (await r.json()) as { items: Ranking[] };
    if (my !== rankSeq) return;
    rankings.value = j.items;
    rankingsRunAt.value = j.items[0]?.runAt ?? null;
  } finally {
    if (my === rankSeq) rankingsLoading.value = false;
  }
};

const selectRanking = (r: Ranking) => {
  selectStock({
    code: r.code,
    name: r.name,
    market: r.market,
    price: r.currentClose,
    changeAbs: null,
    changePct: null,
  });
};

const fmtYen = (n: number) => `${Math.round(n).toLocaleString()}円`;
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const confidenceTier = (c: number): string => {
  if (c >= 80) return "conf-high";
  if (c >= 60) return "conf-mid";
  if (c >= 40) return "conf-low";
  return "conf-none";
};
const fmtRunAt = (t: number | null) => {
  if (!t) return "";
  const d = new Date(t * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

let candleSeq = 0;
const selectStock = async (s: Stock) => {
  selected.value = s;
  chartError.value = null;
  chartLoading.value = true;
  predicting.value = false;
  predictionError.value = null;
  predictionResult.value = null;
  const my = ++candleSeq;

  await nextTick();
  chartPanel.value?.scrollIntoView({ behavior: "smooth", block: "start" });

  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  const toYmd = (d: Date) =>
    Number(
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
        d.getDate(),
      ).padStart(2, "0")}`,
    );

  try {
    const params = new URLSearchParams({
      from: String(toYmd(oneYearAgo)),
      to: String(toYmd(today)),
      limit: "500",
    });
    const r = await fetch(`/api/candles/${s.code}?${params}`);
    const j = (await r.json()) as { code: string; candles: Candle[] };
    if (my !== candleSeq) return;

    if (!j.candles.length) {
      chartError.value = "この銘柄のローソクデータがまだありません";
      destroyChart();
      return;
    }

    const closes = extractCloses(j.candles);
    const norm = minMaxNormalize(closes);

    await nextTick();
    drawChart(j.candles, closes);

    if (worker && closes.length >= 40) {
      predicting.value = true;
      pendingPredict.set(my, {
        candles: j.candles,
        closes,
        min: norm.min,
        max: norm.max,
      });
      worker.postMessage({
        type: "predict",
        requestId: my,
        normalized: norm.values,
        horizon: HORIZON,
      });
    } else if (closes.length < 40) {
      predictionError.value = "予測に必要なデータが不足しています (40営業日以上必要)";
    }
  } catch (e) {
    if (my === candleSeq) chartError.value = String(e);
  } finally {
    if (my === candleSeq) chartLoading.value = false;
  }
};

const destroyChart = () => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
};

const drawChart = (candles: Candle[], closes: number[], predictions?: number[]) => {
  if (!chartCanvas.value) {
    console.warn("[chart] canvas not ready");
    return;
  }

  const labels = candles.map((c) => formatDate(c.date));
  const historyData: (number | null)[] = closes.slice();
  const datasets: any[] = [
    {
      label: "終値",
      data: historyData,
      borderColor: "#2563eb",
      backgroundColor: "rgba(37, 99, 235, 0.1)",
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.15,
      fill: true,
    },
  ];

  if (predictions && predictions.length) {
    const futureLabels = nextBusinessDates(candles[candles.length - 1].date, predictions.length);
    labels.push(...futureLabels);
    for (let i = 0; i < predictions.length; i++) historyData.push(null);
    const predData: (number | null)[] = new Array(closes.length - 1).fill(null);
    predData.push(closes[closes.length - 1]);
    predData.push(...predictions);
    datasets.push({
      label: "予測",
      data: predData,
      borderColor: "#dc2626",
      borderWidth: 1.5,
      borderDash: [5, 4],
      pointRadius: 0,
      tension: 0.15,
      fill: false,
      spanGaps: true,
    });
    console.log("[chart] draw with predictions", {
      labels: labels.length,
      history: historyData.length,
      pred: predData.length,
      hasInstance: !!chartInstance,
    });
  }

  if (chartInstance) {
    chartInstance.data = { labels, datasets };
    chartInstance.options.plugins!.legend!.display = !!predictions;
    chartInstance.update();
    return;
  }

  try {
    chartInstance = new Chart(chartCanvas.value, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: !!predictions, position: "top", align: "end" } },
        scales: {
          x: { ticks: { maxTicksLimit: 8, autoSkip: true } },
          y: { ticks: { callback: (v) => Number(v).toLocaleString() } },
        },
      },
    });
  } catch (e) {
    console.error("[chart] failed to create", e);
  }
};

const closeChart = () => {
  selected.value = null;
  chartError.value = null;
  predictionError.value = null;
  predictionResult.value = null;
  predicting.value = false;
  pendingPredict.clear();
  destroyChart();
};

onMounted(async () => {
  try {
    const r = await fetch("/api/health");
    const j = (await r.json()) as { status: string };
    apiStatus.value = j.status;
  } catch {
    apiStatus.value = "error";
  }

  worker = new Worker(new URL("./ml/worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent) => {
    const data = e.data;
    if (data.type === "ready") {
      tfBackend.value = data.backend;
    } else if (data.type === "predict-result") {
      const ctx = pendingPredict.get(data.requestId);
      console.log("[main] predict-result", {
        req: data.requestId,
        candleSeq,
        hasCtx: !!ctx,
        len: (data.predictions as number[] | undefined)?.length,
      });
      if (!ctx || data.requestId !== candleSeq) return;
      pendingPredict.delete(data.requestId);
      predicting.value = false;
      if (data.error) {
        predictionError.value = `予測失敗: ${data.error}`;
        return;
      }
      const preds = denormalize(data.predictions as number[], ctx.min, ctx.max);
      const last = ctx.closes[ctx.closes.length - 1];
      const target = preds[preds.length - 1];
      const pct = ((target - last) / last) * 100;
      predictionResult.value = { lastClose: last, target, pct };
      drawChart(ctx.candles, ctx.closes, preds);
    }
  };

  fetchRankings();
  fetchBacktest();
});

watch([budget, sortMode, selectedModel, minAgreement], () => {
  fetchRankings();
});
watch(selectedBacktestModel, () => {
  fetchBacktest();
});

const fmt = (n: number | null) => (n === null ? "-" : n.toLocaleString());

const currentPrice = computed(
  () => predictionResult.value?.lastClose ?? selected.value?.price ?? null,
);
const buyableLots = computed(() => {
  const p = currentPrice.value;
  return p ? Math.floor(budget.value / (p * 100)) : 0;
});
const investmentAmount = computed(() => {
  const p = currentPrice.value;
  return p ? buyableLots.value * 100 * p : 0;
});
const expectedProfit = computed(() => {
  if (!predictionResult.value || buyableLots.value === 0) return null;
  const { lastClose, target } = predictionResult.value;
  return buyableLots.value * 100 * (target - lastClose);
});
</script>

<template>
  <main>
    <h1>Stock AI</h1>
    <p class="meta">
      API: <strong>{{ apiStatus }}</strong> / TFJS: <strong>{{ tfBackend }}</strong>
    </p>

    <section class="ranking-panel">
      <header class="ranking-header">
        <h2>予算内ランキング (5営業日後)</h2>
        <span v-if="rankingsRunAt" class="ranking-meta">予測: {{ fmtRunAt(rankingsRunAt) }}</span>
      </header>
      <div class="ranking-controls">
        <label class="budget-label">予算:</label>
        <button
          v-for="p in BUDGET_PRESETS"
          :key="p"
          :class="{ preset: true, active: budget === p }"
          @click="budget = p"
        >
          {{ (p / 10000).toLocaleString() }}万
        </button>
        <input
          v-model.number="budget"
          type="number"
          min="1000"
          step="10000"
          class="budget-input"
        />
        <span class="sort-toggle">
          <button :class="{ active: sortMode === 'profit' }" @click="sortMode = 'profit'">
            利益額順
          </button>
          <button :class="{ active: sortMode === 'return' }" @click="sortMode = 'return'">
            リターン%順
          </button>
        </span>
        <span class="sort-toggle model-toggle">
          <button
            v-for="m in MODEL_OPTIONS"
            :key="m.key"
            :class="{ active: selectedModel === m.key }"
            @click="selectedModel = m.key"
          >
            {{ m.shortLabel }}
          </button>
        </span>
        <span class="sort-toggle model-toggle">
          <button
            v-for="a in AGREEMENT_OPTIONS"
            :key="a.value"
            :class="{ active: minAgreement === a.value }"
            @click="minAgreement = a.value"
          >
            {{ a.label }}
          </button>
        </span>
      </div>
      <div v-if="rankingsLoading" class="ranking-msg">読み込み中...</div>
      <div v-else-if="!rankings.length" class="ranking-msg">
        該当する銘柄がありません。予算を上げるか、バッチ予測を実行してください。
      </div>
      <table v-else class="ranking-table">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>コード</th>
            <th>銘柄名</th>
            <th class="num">現在値</th>
            <th class="num">口数</th>
            <th class="num">予測値</th>
            <th class="num">リターン</th>
            <th class="num">利益(円)</th>
            <th class="num" title="方向一致数と予測値のばらつきから算出 (0-100)。同じ数字でも予測値がバラけていれば低くなる">
              信頼度
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(r, i) in rankings"
            :key="r.code"
            :class="{ active: selected?.code === r.code }"
            @click="selectRanking(r)"
          >
            <td class="num">{{ i + 1 }}</td>
            <td class="mono">{{ r.code }}</td>
            <td>{{ r.name }}</td>
            <td class="num">{{ fmt(r.currentClose) }}</td>
            <td class="num">{{ r.buyableLots }}</td>
            <td class="num">{{ fmt(Math.round(r.predictedClose)) }}</td>
            <td class="num" :class="r.expectedReturnPct >= 0 ? 'up' : 'down'">
              {{ fmtPct(r.expectedReturnPct) }}
            </td>
            <td class="num" :class="r.expectedProfitYen >= 0 ? 'up' : 'down'">
              {{ fmtYen(r.expectedProfitYen) }}
            </td>
            <td
              class="num agreement"
              :class="confidenceTier(r.confidence)"
              :title="`${r.agreement}/${r.agreementTotal} モデル一致 · 予測ばらつき ${r.returnStdevPct.toFixed(1)}%`"
            >
              {{ r.confidence }}
              <span class="agreement-sub">{{ r.agreement }}/{{ r.agreementTotal }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="backtest-panel">
      <header class="backtest-header">
        <h2>バックテスト精度 <span class="backtest-tag">検証中</span></h2>
        <div class="backtest-controls">
          <label class="backtest-model-label">
            モデル
            <select v-model="selectedBacktestModel" class="backtest-model-select">
              <option v-for="m in BACKTEST_MODEL_OPTIONS" :key="m.key" :value="m.key">{{ m.label }}</option>
            </select>
          </label>
          <span v-if="backtest?.meta" class="backtest-meta">
            {{ backtest.meta.rows.toLocaleString() }} 予測 / {{ backtest.meta.stocks }} 銘柄 /
            {{ backtest.meta.runDates }} 日付
          </span>
        </div>
      </header>
      <div v-if="backtestLoading" class="ranking-msg">読み込み中...</div>
      <div v-else-if="backtestError" class="ranking-msg">エラー: {{ backtestError }}</div>
      <div v-else-if="!backtest?.byHorizon.length" class="ranking-msg">
        まだバックテスト結果がありません。
      </div>
      <table v-else class="backtest-table">
        <thead>
          <tr>
            <th>予測期間</th>
            <th class="num">サンプル数</th>
            <th class="num">MAE%</th>
            <th class="num">RMSE%</th>
            <th class="num">方向的中率</th>
            <th class="num">偏り</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in backtest.byHorizon" :key="h.horizonDays">
            <td>{{ h.horizonDays }} 営業日後</td>
            <td class="num">{{ h.n }}</td>
            <td class="num">{{ h.maePct.toFixed(2) }}</td>
            <td class="num">{{ h.rmsePct.toFixed(2) }}</td>
            <td
              class="num"
              :class="h.hitPct >= 55 ? 'up' : h.hitPct < 50 ? 'down' : ''"
            >
              {{ h.hitPct.toFixed(1) }}%
            </td>
            <td class="num" :class="h.biasPct >= 0 ? 'up' : 'down'">
              {{ h.biasPct >= 0 ? "+" : "" }}{{ h.biasPct.toFixed(2) }}%
            </td>
          </tr>
        </tbody>
      </table>
      <p class="backtest-legend">
        MAE% = 平均絶対誤差 / RMSE% = 二乗平均平方根誤差 / 方向的中率 = 上下方向を当てた割合
        (50% = ランダム、55%以上で意味あり) / 偏り = 予測が上下どちらに偏っているか
      </p>

      <div v-if="agreementByHorizon.length" class="agreement-report">
        <h3>信頼度別 実測勝率</h3>
        <p class="agreement-note">
          選択モデルと他モデルで方向が一致した数(N/M)ごとに、実際の方向的中率を集計。
          一致数が多いほど勝率が高ければ、合議に意味があるということ。
        </p>
        <div class="agreement-groups">
          <div
            v-for="g in agreementByHorizon"
            :key="g.horizon"
            class="agreement-group"
          >
            <h4>{{ g.horizon }} 営業日後</h4>
            <table class="agreement-report-table">
              <thead>
                <tr>
                  <th>一致数</th>
                  <th class="num">サンプル</th>
                  <th class="num">実勝率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="b in g.rows" :key="b.agreement">
                  <td>{{ b.agreement }}/{{ b.agreementTotal }}</td>
                  <td class="num">{{ b.n }}</td>
                  <td
                    class="num"
                    :class="b.hitPct >= 55 ? 'up' : b.hitPct < 50 ? 'down' : ''"
                  >
                    {{ b.hitPct.toFixed(1) }}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <section v-if="selected" ref="chartPanel" class="chart-panel">
      <header>
        <h2>
          <span class="mono">{{ selected.code }}</span> {{ selected.name }}
          <span class="market-tag">{{ selected.market }}</span>
        </h2>
        <button class="close" @click="closeChart" aria-label="閉じる">×</button>
      </header>

      <div class="verdict-area">
        <p v-if="chartLoading" class="verdict-status">読み込み中...</p>
        <p v-else-if="chartError" class="verdict-status error">{{ chartError }}</p>
        <p v-else-if="predicting" class="verdict-status">
          5日後の予測を計算中... (数秒〜十数秒)
        </p>
        <p v-else-if="predictionError" class="verdict-status error">{{ predictionError }}</p>
        <div v-else-if="predictionResult" class="verdict">
          <div class="verdict-main">
            <span
              class="verdict-badge"
              :class="predictionResult.pct >= 0 ? 'up' : 'down'"
            >{{ predictionResult.pct >= 0 ? "↑ 上がる予測" : "↓ 下がる予測" }}</span>
            <div class="verdict-price">
              <span class="verdict-label">5営業日後の予測</span>
              <span class="verdict-price-value">
                {{ Math.round(predictionResult.target).toLocaleString()
                }}<span class="verdict-price-unit">円</span>
                <span
                  class="verdict-pct"
                  :class="predictionResult.pct >= 0 ? 'up' : 'down'"
                >
                  ({{ predictionResult.pct >= 0 ? "+" : ""
                  }}{{ predictionResult.pct.toFixed(2) }}%)
                </span>
              </span>
            </div>
          </div>
          <div class="budget-calc">
            <div class="calc-item">
              <span class="calc-label">予算</span>
              <span class="calc-value">{{ (budget / 10000).toLocaleString() }}万円</span>
            </div>
            <span class="calc-arrow">→</span>
            <div class="calc-item">
              <span class="calc-label">買える口数</span>
              <span class="calc-value">{{ buyableLots }}口</span>
              <span v-if="buyableLots > 0" class="calc-sub">
                ({{ (buyableLots * 100).toLocaleString() }}株)
              </span>
              <span v-else class="calc-sub warn">予算不足</span>
            </div>
            <span class="calc-arrow">→</span>
            <div class="calc-item">
              <span class="calc-label">投資額</span>
              <span v-if="investmentAmount > 0" class="calc-value invest">
                {{ investmentAmount.toLocaleString() }}円
              </span>
              <span v-else class="calc-value muted">-</span>
            </div>
            <span class="calc-arrow">→</span>
            <div class="calc-item">
              <span class="calc-label">予測利益</span>
              <span
                v-if="expectedProfit != null"
                class="calc-value profit"
                :class="expectedProfit >= 0 ? 'up' : 'down'"
              >
                {{ expectedProfit >= 0 ? "+" : ""
                }}{{ Math.round(expectedProfit).toLocaleString() }}円
              </span>
              <span v-else class="calc-value muted">-</span>
            </div>
          </div>

        </div>
      </div>

      <div class="chart-wrap chart-supplement">
        <canvas v-show="!chartLoading && !chartError" ref="chartCanvas"></canvas>
      </div>
    </section>
  </main>
</template>

<style scoped>
main {
  font-family: system-ui, sans-serif;
  max-width: 960px;
  margin: 2rem auto;
  padding: 1rem;
}
.meta {
  color: #666;
  font-size: 0.9rem;
}
.chart-panel {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fafafa;
}
.chart-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.chart-panel h2 {
  font-size: 1rem;
  margin: 0;
  font-weight: 600;
}
.market-tag {
  color: #666;
  font-size: 0.8rem;
  margin-left: 0.4rem;
}
.close {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: #666;
  padding: 0 0.4rem;
}
.close:hover {
  color: #000;
}
.chart-wrap {
  position: relative;
  height: 260px;
}
.chart-supplement {
  height: 180px;
  opacity: 0.9;
}
.verdict-area {
  margin-bottom: 0.75rem;
  min-height: 3rem;
}
.verdict-status {
  margin: 0;
  padding: 1rem 0.5rem;
  text-align: center;
  color: #666;
  font-size: 0.9rem;
}
.verdict-status.error {
  color: #dc2626;
}
.verdict {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.verdict-main {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.verdict-badge {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  font-weight: 700;
  font-size: 1rem;
  color: #fff;
  white-space: nowrap;
}
.verdict-badge.up {
  background: #16a34a;
  color: #fff;
}
.verdict-badge.down {
  background: #dc2626;
  color: #fff;
}
.verdict-price {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.verdict-label {
  color: #666;
  font-size: 0.72rem;
}
.verdict-price-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: #111;
  line-height: 1.1;
}
.verdict-price-unit {
  font-size: 1rem;
  font-weight: 500;
  color: #555;
  margin-left: 0.1rem;
}
.verdict-pct {
  font-size: 1rem;
  font-weight: 600;
  margin-left: 0.5rem;
}
.budget-calc {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.8rem;
  background: #f5f7fb;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  flex-wrap: wrap;
}
.calc-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.calc-label {
  color: #666;
  font-size: 0.72rem;
}
.calc-value {
  font-size: 1rem;
  font-weight: 600;
  color: #111;
}
.calc-value.invest,
.calc-value.profit {
  font-size: 1.35rem;
}
.calc-value.muted {
  color: #999;
  font-weight: 400;
}
.calc-sub {
  color: #666;
  font-size: 0.72rem;
}
.calc-sub.warn {
  color: #dc2626;
}
.calc-arrow {
  color: #999;
  font-size: 1.1rem;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th,
td {
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid #eee;
  text-align: left;
}
th {
  background: #f7f7f7;
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover {
  background: #f5f9ff;
}
tbody tr.active {
  background: #e0ecff;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.up {
  color: #16a34a;
}
.down {
  color: #dc2626;
}
.ranking-panel {
  border: 1px solid #d4dae2;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fff;
}
.ranking-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.ranking-header h2 {
  font-size: 1rem;
  margin: 0;
  font-weight: 600;
}
.ranking-meta {
  color: #666;
  font-size: 0.75rem;
}
.ranking-controls {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
.budget-label {
  font-size: 0.85rem;
  color: #444;
  margin-right: 0.2rem;
}
.ranking-controls .preset {
  padding: 0.25rem 0.6rem;
  border: 1px solid #ccc;
  background: #fff;
  cursor: pointer;
  font-size: 0.85rem;
  border-radius: 4px;
}
.ranking-controls .preset.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.budget-input {
  width: 8rem;
  padding: 0.25rem 0.4rem;
  font-size: 0.85rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.sort-toggle {
  display: inline-flex;
  gap: 0;
}
.sort-toggle:not(.model-toggle) {
  margin-left: auto;
}
.model-toggle {
  margin-left: 0.5rem;
}
.sort-toggle button {
  padding: 0.25rem 0.6rem;
  border: 1px solid #ccc;
  background: #fff;
  cursor: pointer;
  font-size: 0.85rem;
}
.sort-toggle button:first-child {
  border-radius: 4px 0 0 4px;
}
.sort-toggle button:not(:first-child) {
  border-left: none;
}
.sort-toggle button:last-child {
  border-radius: 0 4px 4px 0;
}
.sort-toggle button.active {
  background: #333;
  color: #fff;
  border-color: #333;
}
.ranking-msg {
  color: #666;
  text-align: center;
  padding: 1rem 0;
  font-size: 0.9rem;
}
.ranking-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.ranking-table th,
.ranking-table td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #eee;
}
.ranking-table th {
  background: #f7f7f7;
  text-align: left;
}
.ranking-table tbody tr {
  cursor: pointer;
}
.ranking-table tbody tr:hover {
  background: #f5f9ff;
}
.ranking-table tbody tr.active {
  background: #e0ecff;
}
.agreement {
  font-weight: 600;
  border-radius: 4px;
  line-height: 1.15;
}
.agreement-sub {
  display: block;
  font-size: 0.7rem;
  font-weight: 500;
  opacity: 0.75;
  margin-top: 0.1rem;
}
.agreement.conf-high {
  background: #d1fae5;
  color: #065f46;
}
.agreement.conf-mid {
  background: #fef3c7;
  color: #92400e;
}
.agreement.conf-low {
  background: #fee2e2;
  color: #991b1b;
}
.agreement.conf-none {
  background: #f3f4f6;
  color: #6b7280;
}
.agreement-report {
  margin-top: 0.9rem;
  padding-top: 0.75rem;
  border-top: 1px dashed #e0e4ea;
}
.agreement-report h3 {
  font-size: 0.9rem;
  margin: 0 0 0.3rem;
  font-weight: 600;
}
.agreement-note {
  margin: 0 0 0.6rem;
  color: #666;
  font-size: 0.75rem;
  line-height: 1.5;
}
.agreement-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}
.agreement-group h4 {
  font-size: 0.8rem;
  margin: 0 0 0.25rem;
  font-weight: 600;
  color: #444;
}
.agreement-report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.agreement-report-table th,
.agreement-report-table td {
  padding: 0.25rem 0.4rem;
  border-bottom: 1px solid #eee;
}
.agreement-report-table th {
  background: #f7f7f7;
  text-align: left;
}
.backtest-panel {
  border: 1px solid #d4dae2;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fff;
}
.backtest-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.backtest-header h2 {
  font-size: 1rem;
  margin: 0;
  font-weight: 600;
}
.backtest-tag {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.7rem;
  font-weight: 500;
  vertical-align: middle;
}
.backtest-meta {
  color: #666;
  font-size: 0.75rem;
}
.backtest-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.backtest-model-label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: #444;
}
.backtest-model-select {
  padding: 0.2rem 0.4rem;
  border: 1px solid #cbd2da;
  border-radius: 4px;
  background: #fff;
  font-size: 0.8rem;
}
.backtest-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.backtest-table th,
.backtest-table td {
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid #eee;
}
.backtest-table th {
  background: #f7f7f7;
  text-align: left;
}
.backtest-legend {
  margin: 0.6rem 0 0;
  color: #666;
  font-size: 0.72rem;
  line-height: 1.5;
}
</style>
