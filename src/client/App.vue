<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type View = "home" | "stock-portfolio" | "fx";
const currentView = ref<View>("home");

const apiStatus = ref("checking...");

type PatternPick = {
  code: string;
  runDate: number;
  patterns: string;
  entryClose: number;
  name: string | null;
  patternN: number;
  patternWr30d: number | null;
  patternAvg30d: number | null;
};
type PatternAgg = {
  n: number;
  n5d: number;
  wr5d: number | null;
  avg5d: number | null;
  n15d: number;
  wr15d: number | null;
  avg15d: number | null;
  n30d: number;
  wr30d: number | null;
  avg30d: number | null;
  firstDate: number | null;
  lastDate: number | null;
};
type PatternHistoryRow = {
  runDate: number;
  n: number;
  avg5d: number | null;
  avg15d: number | null;
  avg30d: number | null;
};
const patternToday = ref<PatternPick[]>([]);
const patternAgg = ref<PatternAgg | null>(null);
const patternHistory = ref<PatternHistoryRow[]>([]);
const patternLatestDate = ref<number | null>(null);
const patternLoading = ref(false);

const fetchPatternPicks = async () => {
  patternLoading.value = true;
  try {
    const r = await fetch("/api/pattern-picks");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as {
      latestDate: number | null;
      today: PatternPick[];
      agg: PatternAgg;
      history: PatternHistoryRow[];
    };
    patternToday.value = j.today;
    patternAgg.value = j.agg;
    patternHistory.value = j.history;
    patternLatestDate.value = j.latestDate;
  } finally {
    patternLoading.value = false;
  }
};

const fmtYmd = (ymd: number | null): string => {
  if (!ymd) return "";
  const s = String(ymd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtYen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}円`;

const patternCumulative = computed(() => {
  const h = patternHistory.value;
  if (!h.length) return { avg5d: null, avg15d: null, avg30d: null };
  const compound = (key: "avg5d" | "avg15d" | "avg30d"): number | null => {
    let c = 1;
    let any = false;
    for (const r of h) {
      const v = r[key];
      if (v == null) continue;
      c *= 1 + v / 100;
      any = true;
    }
    return any ? (c - 1) * 100 : null;
  };
  return {
    avg5d: compound("avg5d"),
    avg15d: compound("avg15d"),
    avg30d: compound("avg30d"),
  };
});

type FxTrade = {
  date: string;
  direction: string;
  entryPrice: number;
  probability: number;
  confidence: number;
  pnlPips: number | null;
  pnlYen: number | null;
  hit: number | null;
  equityAfter: number | null;
};
type FxSummary = {
  n: number;
  resolved: number;
  pending: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPips: number;
  totalYen: number;
  finalEquity: number;
  returnPct: number;
  maxDrawdown: number;
};
const fxTrades = ref<FxTrade[]>([]);
const fxSummary = ref<FxSummary | null>(null);
const fxStartCapital = ref(500000);
const fxLotSize = ref(10000);
const fxPipYen = ref(100);
const fxLoading = ref(false);

const fetchFxSignals = async () => {
  fxLoading.value = true;
  try {
    const r = await fetch("/api/fx-signals");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as {
      startCapital: number;
      lotSize: number;
      pipYen: number;
      summary: FxSummary;
      trades: FxTrade[];
    };
    fxStartCapital.value = j.startCapital;
    fxLotSize.value = j.lotSize;
    fxPipYen.value = j.pipYen;
    fxSummary.value = j.summary;
    fxTrades.value = [...j.trades].reverse();
  } finally {
    fxLoading.value = false;
  }
};

type StockTrade = {
  id: number;
  code: string;
  signalDate: number;
  buyDate: number;
  buyPrice: number;
  shares: number;
  investmentYen: number;
  sellDate: number | null;
  sellPrice: number | null;
  pnlYen: number | null;
  pnlPct: number | null;
  exitReason: string | null;
  equityAfter: number | null;
  name: string | null;
};
type StockSummary = {
  n: number;
  resolved: number;
  pending: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  finalEquity: number;
  returnPct: number;
  annualizedPct: number | null;
  maxDrawdown: number;
  firstDate: number | null;
  lastDate: number | null;
  bestTrade: StockTrade | null;
  worstTrade: StockTrade | null;
};
const stockTrades = ref<StockTrade[]>([]);
const stockSummary = ref<StockSummary | null>(null);
const stockStartCapital = ref(500000);
const stockLoading = ref(false);

const fetchStockTrades = async () => {
  stockLoading.value = true;
  try {
    const r = await fetch("/api/stock-trades");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as {
      startCapital: number;
      summary: StockSummary;
      trades: StockTrade[];
    };
    stockStartCapital.value = j.startCapital;
    stockSummary.value = j.summary;
    stockTrades.value = [...j.trades].reverse();
  } finally {
    stockLoading.value = false;
  }
};

const openFx = () => {
  currentView.value = "fx";
  if (fxTrades.value.length === 0) fetchFxSignals();
};
const openStockPortfolio = () => {
  currentView.value = "stock-portfolio";
  if (stockTrades.value.length === 0) fetchStockTrades();
};
const openHome = () => {
  currentView.value = "home";
};

onMounted(async () => {
  try {
    const r = await fetch("/api/health");
    const j = (await r.json()) as { status: string };
    apiStatus.value = j.status;
  } catch {
    apiStatus.value = "error";
  }
  fetchPatternPicks();
});
</script>

<template>
  <main>
    <header class="app-header">
      <h1>Stock AI</h1>
      <nav class="app-nav">
        <button :class="{ nav: true, active: currentView === 'home' }" @click="openHome">
          株
        </button>
        <button :class="{ nav: true, active: currentView === 'stock-portfolio' }" @click="openStockPortfolio">
          株検証
        </button>
        <button :class="{ nav: true, active: currentView === 'fx' }" @click="openFx">
          FX
        </button>
      </nav>
    </header>
    <p class="meta">
      API: <strong>{{ apiStatus }}</strong>
    </p>

    <section v-if="currentView === 'home'" class="pattern-panel">
      <header class="pattern-header">
        <h2>本日のパターン候補 Top 5</h2>
        <span v-if="patternLatestDate" class="pattern-meta">{{ fmtYmd(patternLatestDate) }}</span>
      </header>
      <div v-if="patternLoading" class="pattern-msg">読み込み中...</div>
      <div v-else-if="!patternToday.length" class="pattern-msg">本日は候補なし（マッチゼロ）</div>
      <table v-else class="pattern-table">
        <thead>
          <tr>
            <th>コード</th>
            <th>銘柄名</th>
            <th class="num">エントリー</th>
            <th>パターン</th>
            <th class="num" title="過去同一パターンの30日後平均リターン">30d平均</th>
            <th class="num" title="過去同一パターンの30日勝率 (n=サンプル数)">30d勝率</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in patternToday" :key="p.code">
            <td>{{ p.code }}</td>
            <td>{{ p.name ?? "-" }}</td>
            <td class="num">{{ Math.round(p.entryClose).toLocaleString() }}円</td>
            <td class="pattern-tags">
              <span v-for="tag in p.patterns.split(',')" :key="tag" class="pattern-tag">{{ tag }}</span>
            </td>
            <td class="num" :class="{ pos: (p.patternAvg30d ?? 0) > 0, neg: (p.patternAvg30d ?? 0) < 0 }">
              {{ p.patternAvg30d != null ? fmtPct(p.patternAvg30d) : "-" }}
            </td>
            <td class="num">
              {{ p.patternWr30d != null ? p.patternWr30d.toFixed(1) + "%" : "-" }}
              <span class="pattern-n">n={{ p.patternN }}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="patternAgg" class="pattern-agg">
        <h3>過去実績
          <span class="pattern-meta" v-if="patternAgg.firstDate && patternAgg.lastDate">
            {{ fmtYmd(patternAgg.firstDate) }} 〜 {{ fmtYmd(patternAgg.lastDate) }} / {{ patternAgg.n.toLocaleString() }} 件
          </span>
        </h3>
        <table class="pattern-stats-table">
          <thead>
            <tr>
              <th>保有期間</th>
              <th class="num">サンプル</th>
              <th class="num">勝率</th>
              <th class="num">平均リターン</th>
              <th class="num">累積（複利）</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>15日</td>
              <td class="num">{{ patternAgg.n15d.toLocaleString() }}</td>
              <td class="num">{{ patternAgg.wr15d != null ? patternAgg.wr15d.toFixed(2) + "%" : "-" }}</td>
              <td class="num" :class="{ pos: (patternAgg.avg15d ?? 0) > 0, neg: (patternAgg.avg15d ?? 0) < 0 }">
                {{ patternAgg.avg15d != null ? fmtPct(patternAgg.avg15d) : "-" }}
              </td>
              <td class="num" :class="{ pos: (patternCumulative.avg15d ?? 0) > 0, neg: (patternCumulative.avg15d ?? 0) < 0 }">
                {{ patternCumulative.avg15d != null ? fmtPct(patternCumulative.avg15d) : "-" }}
              </td>
            </tr>
            <tr>
              <td>30日</td>
              <td class="num">{{ patternAgg.n30d.toLocaleString() }}</td>
              <td class="num">{{ patternAgg.wr30d != null ? patternAgg.wr30d.toFixed(2) + "%" : "-" }}</td>
              <td class="num" :class="{ pos: (patternAgg.avg30d ?? 0) > 0, neg: (patternAgg.avg30d ?? 0) < 0 }">
                {{ patternAgg.avg30d != null ? fmtPct(patternAgg.avg30d) : "-" }}
              </td>
              <td class="num" :class="{ pos: (patternCumulative.avg30d ?? 0) > 0, neg: (patternCumulative.avg30d ?? 0) < 0 }">
                {{ patternCumulative.avg30d != null ? fmtPct(patternCumulative.avg30d) : "-" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="currentView === 'stock-portfolio'" class="pattern-panel">
      <header class="pattern-header">
        <h2>株 検証ポートフォリオ (range_oscillator_v1)</h2>
        <span class="pattern-meta">
          50万円スタート / 10万円×5スロット / 90日保有
        </span>
      </header>

      <div v-if="stockLoading" class="pattern-msg">読み込み中...</div>
      <div v-else-if="!stockSummary" class="pattern-msg">データなし</div>

      <div v-else>
        <div class="fx-summary">
          <div class="fx-card">
            <span class="fx-card-label">開始残高</span>
            <span class="fx-card-value">{{ stockStartCapital.toLocaleString() }}円</span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">現在残高</span>
            <span
              class="fx-card-value big"
              :class="{ pos: stockSummary.returnPct > 0, neg: stockSummary.returnPct < 0 }"
            >{{ stockSummary.finalEquity.toLocaleString() }}円</span>
            <span
              class="fx-card-sub"
              :class="{ pos: stockSummary.returnPct > 0, neg: stockSummary.returnPct < 0 }"
            >
              {{ fmtYen(stockSummary.totalPnl) }} ({{ stockSummary.returnPct > 0 ? "+" : "" }}{{ Math.round(stockSummary.returnPct) }}%)
            </span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">年率</span>
            <span
              class="fx-card-value"
              :class="{ pos: (stockSummary.annualizedPct ?? 0) > 0, neg: (stockSummary.annualizedPct ?? 0) < 0 }"
            >
              {{ stockSummary.annualizedPct != null ? (stockSummary.annualizedPct > 0 ? "+" : "") + Math.round(stockSummary.annualizedPct) + "%" : "-" }}
            </span>
            <span class="fx-card-sub">最大DD {{ Math.round(stockSummary.maxDrawdown) }}%</span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">勝率</span>
            <span class="fx-card-value">
              {{ stockSummary.winRate != null ? Math.round(stockSummary.winRate) + "%" : "-" }}
            </span>
            <span class="fx-card-sub">
              {{ stockSummary.wins }}勝 {{ stockSummary.losses }}負 / 保留 {{ stockSummary.pending }}
            </span>
          </div>
        </div>

        <div v-if="stockSummary.bestTrade || stockSummary.worstTrade" class="stock-highlights">
          <div v-if="stockSummary.bestTrade" class="highlight-row">
            <span class="highlight-label pos">ベスト</span>
            {{ stockSummary.bestTrade.code }} {{ stockSummary.bestTrade.name ?? "" }}
            {{ fmtYmd(stockSummary.bestTrade.buyDate) }} → {{ fmtYmd(stockSummary.bestTrade.sellDate) }}
            <strong class="pos">{{ fmtYen(stockSummary.bestTrade.pnlYen ?? 0) }}</strong>
            ({{ Math.round(stockSummary.bestTrade.pnlPct ?? 0) }}%)
          </div>
          <div v-if="stockSummary.worstTrade" class="highlight-row">
            <span class="highlight-label neg">ワースト</span>
            {{ stockSummary.worstTrade.code }} {{ stockSummary.worstTrade.name ?? "" }}
            {{ fmtYmd(stockSummary.worstTrade.buyDate) }} → {{ fmtYmd(stockSummary.worstTrade.sellDate) }}
            <strong class="neg">{{ fmtYen(stockSummary.worstTrade.pnlYen ?? 0) }}</strong>
            ({{ Math.round(stockSummary.worstTrade.pnlPct ?? 0) }}%)
          </div>
        </div>

        <h3 class="fx-section-title">トレード履歴 ({{ stockTrades.length }}件)</h3>
        <table class="pattern-stats-table fx-trades">
          <thead>
            <tr>
              <th>買付</th>
              <th>売却</th>
              <th>コード</th>
              <th>銘柄名</th>
              <th class="num">買値</th>
              <th class="num">売値</th>
              <th class="num">損益</th>
              <th class="num">率</th>
              <th class="num">残高</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in stockTrades" :key="t.id">
              <td>{{ fmtYmd(t.buyDate) }}</td>
              <td>{{ t.sellDate != null ? fmtYmd(t.sellDate) : "-" }}</td>
              <td>{{ t.code }}</td>
              <td>{{ t.name ?? "-" }}</td>
              <td class="num">{{ Math.round(t.buyPrice) }}</td>
              <td class="num">{{ t.sellPrice != null ? Math.round(t.sellPrice) : "-" }}</td>
              <td class="num" :class="{ pos: (t.pnlYen ?? 0) > 0, neg: (t.pnlYen ?? 0) < 0 }">
                {{ t.pnlYen != null ? fmtYen(t.pnlYen) : "-" }}
              </td>
              <td class="num" :class="{ pos: (t.pnlPct ?? 0) > 0, neg: (t.pnlPct ?? 0) < 0 }">
                {{ t.pnlPct != null ? (t.pnlPct > 0 ? "+" : "") + Math.round(t.pnlPct) + "%" : "-" }}
              </td>
              <td class="num">
                {{ t.equityAfter != null ? Math.round(t.equityAfter).toLocaleString() + "円" : "-" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="currentView === 'fx'" class="pattern-panel">
      <header class="pattern-header">
        <h2>FX シグナル検証 (USDJPY)</h2>
        <span class="pattern-meta">
          1トレード {{ fxLotSize.toLocaleString() }}通貨 / 1pip={{ fxPipYen }}円
        </span>
      </header>

      <div v-if="fxLoading" class="pattern-msg">読み込み中...</div>
      <div v-else-if="!fxSummary" class="pattern-msg">データなし</div>

      <div v-else>
        <div class="fx-summary">
          <div class="fx-card">
            <span class="fx-card-label">開始残高</span>
            <span class="fx-card-value">{{ fxStartCapital.toLocaleString() }}円</span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">現在残高</span>
            <span
              class="fx-card-value big"
              :class="{ pos: fxSummary.returnPct > 0, neg: fxSummary.returnPct < 0 }"
            >{{ fxSummary.finalEquity.toLocaleString() }}円</span>
            <span
              class="fx-card-sub"
              :class="{ pos: fxSummary.returnPct > 0, neg: fxSummary.returnPct < 0 }"
            >
              {{ fmtYen(fxSummary.totalYen) }} ({{ fxSummary.returnPct > 0 ? "+" : "" }}{{ Math.round(fxSummary.returnPct) }}%)
            </span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">勝率</span>
            <span class="fx-card-value">
              {{ fxSummary.winRate != null ? Math.round(fxSummary.winRate) + "%" : "-" }}
            </span>
            <span class="fx-card-sub">
              {{ fxSummary.wins }}勝 {{ fxSummary.losses }}負 / 保留 {{ fxSummary.pending }}
            </span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">トータル pips</span>
            <span
              class="fx-card-value"
              :class="{ pos: fxSummary.totalPips > 0, neg: fxSummary.totalPips < 0 }"
            >
              {{ fxSummary.totalPips > 0 ? "+" : "" }}{{ Math.round(fxSummary.totalPips) }}
            </span>
            <span class="fx-card-sub">最大DD {{ Math.round(fxSummary.maxDrawdown) }}%</span>
          </div>
        </div>

        <h3 class="fx-section-title">トレード履歴 ({{ fxTrades.length }}件)</h3>
        <table class="pattern-stats-table fx-trades">
          <thead>
            <tr>
              <th>日付</th>
              <th>方向</th>
              <th class="num">エントリー</th>
              <th class="num">確度</th>
              <th>結果</th>
              <th class="num">pips</th>
              <th class="num">損益</th>
              <th class="num">残高</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in fxTrades" :key="t.date">
              <td>{{ t.date }}</td>
              <td>
                <span class="dir-badge" :class="t.direction.toLowerCase()">{{ t.direction }}</span>
              </td>
              <td class="num">{{ Math.round(t.entryPrice) }}</td>
              <td class="num">{{ Math.round(t.probability * 100) }}%</td>
              <td>
                <span v-if="t.hit == null" class="result-tag pending">保留</span>
                <span v-else-if="t.hit === 1" class="result-tag win">勝</span>
                <span v-else class="result-tag lose">負</span>
              </td>
              <td class="num" :class="{ pos: (t.pnlPips ?? 0) > 0, neg: (t.pnlPips ?? 0) < 0 }">
                {{ t.pnlPips != null ? (t.pnlPips > 0 ? "+" : "") + Math.round(t.pnlPips) : "-" }}
              </td>
              <td class="num" :class="{ pos: (t.pnlYen ?? 0) > 0, neg: (t.pnlYen ?? 0) < 0 }">
                {{ t.pnlYen != null ? fmtYen(t.pnlYen) : "-" }}
              </td>
              <td class="num">
                {{ t.equityAfter != null ? Math.round(t.equityAfter).toLocaleString() + "円" : "-" }}
              </td>
            </tr>
          </tbody>
        </table>
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
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}
.app-header h1 {
  margin: 0;
}
.app-nav {
  display: inline-flex;
}
.app-nav button.nav {
  padding: 0.4rem 1rem;
  border: 1px solid #ccc;
  background: #fff;
  cursor: pointer;
  font-size: 0.9rem;
  color: #333;
}
.app-nav button.nav:first-child {
  border-radius: 4px 0 0 4px;
}
.app-nav button.nav:last-child {
  border-left: none;
  border-radius: 0 4px 4px 0;
}
.app-nav button.nav.active {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}
.meta {
  color: #666;
  font-size: 0.9rem;
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.pattern-panel {
  border: 1px solid #d4dae2;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fff;
}
.pattern-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.pattern-header h2 {
  font-size: 1rem;
  margin: 0;
  font-weight: 600;
}
.pattern-meta {
  color: #666;
  font-size: 0.75rem;
  font-weight: normal;
}
.pattern-msg {
  padding: 1rem;
  color: #666;
  text-align: center;
  font-size: 0.9rem;
}
.pattern-table,
.pattern-stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.pattern-table th,
.pattern-table td,
.pattern-stats-table th,
.pattern-stats-table td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid #eef0f3;
  text-align: left;
}
.pattern-table th.num,
.pattern-table td.num,
.pattern-stats-table th.num,
.pattern-stats-table td.num {
  text-align: right;
}
.pattern-tags {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.pattern-tag {
  background: #eef3fb;
  color: #345;
  border-radius: 4px;
  padding: 0.1rem 0.4rem;
  font-size: 0.72rem;
}
.pattern-agg {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px dashed #d4dae2;
}
.pattern-agg h3 {
  font-size: 0.9rem;
  margin: 0 0 0.4rem;
  font-weight: 600;
}
.pattern-stats-table td.pos,
.pattern-table td.pos {
  color: #198754;
}
.pattern-stats-table td.neg,
.pattern-table td.neg {
  color: #c0392b;
}
.pattern-n {
  display: block;
  color: #999;
  font-size: 0.7rem;
  font-weight: normal;
}
.fx-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.fx-card {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.75rem;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  border-radius: 6px;
}
.fx-card-label {
  color: #666;
  font-size: 0.72rem;
}
.fx-card-value {
  font-size: 1.1rem;
  font-weight: 600;
}
.fx-card-value.big {
  font-size: 1.4rem;
}
.fx-card-value.pos,
.fx-card-sub.pos {
  color: #198754;
}
.fx-card-value.neg,
.fx-card-sub.neg {
  color: #c0392b;
}
.fx-card-sub {
  color: #666;
  font-size: 0.75rem;
}
.fx-section-title {
  font-size: 0.9rem;
  margin: 0.5rem 0 0.4rem;
  font-weight: 600;
}
.fx-trades td,
.fx-trades th {
  font-size: 0.8rem;
}
.dir-badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #fff;
}
.dir-badge.long {
  background: #16a34a;
}
.dir-badge.short {
  background: #dc2626;
}
.result-tag {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
}
.result-tag.win {
  background: #d1fae5;
  color: #065f46;
}
.result-tag.lose {
  background: #fee2e2;
  color: #991b1b;
}
.result-tag.pending {
  background: #f3f4f6;
  color: #6b7280;
}
.stock-highlights {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0.4rem 0 0.75rem;
  padding: 0.5rem 0.75rem;
  background: #fafbfc;
  border: 1px solid #eef0f3;
  border-radius: 6px;
  font-size: 0.8rem;
}
.highlight-row {
  color: #333;
}
.highlight-label {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  margin-right: 0.3rem;
}
.highlight-label.pos {
  background: #d1fae5;
  color: #065f46;
}
.highlight-label.neg {
  background: #fee2e2;
  color: #991b1b;
}
</style>
