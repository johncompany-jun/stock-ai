<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

type View = "home" | "portfolio" | "fx";
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
type MonthlyStat = {
  buy_month: number;
  n: number;
  wr_90d: number;
  avg_90d: number;
};
const patternToday = ref<PatternPick[]>([]);
const patternAgg = ref<PatternAgg | null>(null);
const patternHistory = ref<PatternHistoryRow[]>([]);
const patternLatestDate = ref<number | null>(null);
const patternMonthly = ref<MonthlyStat[]>([]);
const patternCurrentMonth = ref<number>(0);
const patternCurrentMonthStat = ref<MonthlyStat | null>(null);
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
      monthly: MonthlyStat[];
      currentMonth: number;
      currentMonthStat: MonthlyStat | null;
    };
    patternToday.value = j.today;
    patternAgg.value = j.agg;
    patternHistory.value = j.history;
    patternLatestDate.value = j.latestDate;
    patternMonthly.value = j.monthly;
    patternCurrentMonth.value = j.currentMonth;
    patternCurrentMonthStat.value = j.currentMonthStat;
  } finally {
    patternLoading.value = false;
  }
};

const monthRank = computed(() => {
  const sorted = [...patternMonthly.value].sort((a, b) => b.avg_90d - a.avg_90d);
  return {
    best: sorted.slice(0, 3),
    worst: sorted.slice(-3).reverse(),
  };
});
const currentMonthVerdict = computed(() => {
  const s = patternCurrentMonthStat.value;
  if (!s) return { label: "データなし", tone: "neutral" };
  const avg = s.avg_90d;
  if (avg >= 5) return { label: "★★★ 絶好の種まき月", tone: "pos-strong" };
  if (avg >= 3) return { label: "★★ 良い種まき月", tone: "pos" };
  if (avg >= 1) return { label: "★ 普通の月", tone: "neutral-pos" };
  if (avg >= 0) return { label: "△ 弱め、様子見推奨", tone: "neutral-neg" };
  return { label: "✗ 休耕月、見送り推奨", tone: "neg" };
});

const recommendedWindow = computed(() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const buyStart = new Date(y, m, now.getDate());
  while (buyStart.getDay() === 0 || buyStart.getDay() === 6) {
    buyStart.setDate(buyStart.getDate() + 1);
  }
  const buyEnd = new Date(y, m + 1, 0);
  while (buyEnd.getDay() === 0 || buyEnd.getDay() === 6) {
    buyEnd.setDate(buyEnd.getDate() - 1);
  }
  const sellCenter = new Date(buyStart);
  let count = 0;
  while (count < 90) {
    sellCenter.setDate(sellCenter.getDate() + 1);
    if (sellCenter.getDay() !== 0 && sellCenter.getDay() !== 6) count++;
  }
  const sellStart = new Date(sellCenter);
  sellStart.setDate(sellStart.getDate() - 10);
  const sellEnd = new Date(sellCenter);
  sellEnd.setDate(sellEnd.getDate() + 10);

  const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  const fmtMonth = (d: Date) => `${d.getMonth() + 1}月`;
  const sellStat = patternMonthly.value.find((r) => r.buy_month === sellCenter.getMonth() + 1);

  return {
    buyLabel: `${fmt(buyStart)} 〜 ${fmt(buyEnd)}`,
    sellLabel: `${fmtMonth(sellStart)}中旬 〜 ${fmtMonth(sellEnd)}上旬`,
    sellCenter: fmt(sellCenter),
    sellMonthStat: sellStat ?? null,
  };
});

const nextStrongMonth = computed(() => {
  const now = new Date();
  const current = now.getMonth() + 1;
  const future: MonthlyStat[] = [];
  for (let i = 1; i <= 11; i++) {
    const m = ((current - 1 + i) % 12) + 1;
    const stat = patternMonthly.value.find((r) => r.buy_month === m);
    if (stat && stat.avg_90d > (patternCurrentMonthStat.value?.avg_90d ?? 0) + 1.5) {
      future.push(stat);
    }
  }
  return future[0] ?? null;
});

const fmtYmd = (ymd: number | null): string => {
  if (!ymd) return "";
  const s = String(ymd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtYen = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString()}円`;

const ymdToDate = (ymd: number): Date => {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor((ymd / 100) % 100);
  const d = ymd % 100;
  return new Date(y, m - 1, d);
};
const dateToYmdString = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const nextBusinessDay = (ymd: number): string => {
  const d = ymdToDate(ymd);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return dateToYmdString(d);
};
const addBusinessDays = (startYmd: number, days: number): string => {
  const d = ymdToDate(startYmd);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  let count = 1;
  while (count < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return dateToYmdString(d);
};

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

type OpenHolding = {
  id: number;
  code: string;
  name: string | null;
  signalDate: number;
  buyDate: number;
  buyPrice: number;
  shares: number;
  investmentYen: number;
  currentPrice: number;
  currentDate: number | null;
  currentValue: number;
  unrealizedYen: number;
  unrealizedPct: number;
};
type ClosedTrade = {
  id: number;
  code: string;
  name: string | null;
  buyDate: number;
  buyPrice: number;
  shares: number;
  investmentYen: number;
  sellDate: number | null;
  sellPrice: number | null;
  pnlYen: number | null;
  pnlPct: number | null;
};
type Portfolio = {
  startCapital: number;
  cash: number;
  holdingsValue: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  returnPct: number;
  open: OpenHolding[];
  closed: ClosedTrade[];
};
const portfolio = ref<Portfolio | null>(null);
const portfolioLoading = ref(false);
const buyLots = ref<Record<string, number>>({});
const buying = ref<Record<string, boolean>>({});
const selling = ref<Record<number, boolean>>({});

const fetchPortfolio = async () => {
  portfolioLoading.value = true;
  try {
    const r = await fetch("/api/portfolio");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    portfolio.value = (await r.json()) as Portfolio;
  } finally {
    portfolioLoading.value = false;
  }
};

const buyPick = async (p: PatternPick) => {
  const lots = buyLots.value[p.code] ?? 1;
  const shares = lots * 100;
  const investment = p.entryClose * shares;
  if (!confirm(`${p.code} ${p.name ?? ""} を ${lots}口 (${shares}株) 購入\n投資額: ${investment.toLocaleString()}円`)) return;
  buying.value[p.code] = true;
  try {
    const r = await fetch("/api/portfolio/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: p.code,
        signalDate: p.runDate,
        buyPrice: p.entryClose,
        shares,
      }),
    });
    const j = (await r.json()) as { error?: string };
    if (!r.ok) {
      alert(`購入失敗: ${j.error}`);
      return;
    }
    await fetchPortfolio();
    alert(`購入しました: ${p.code} ${lots}口`);
  } finally {
    buying.value[p.code] = false;
  }
};

const sellHolding = async (h: OpenHolding) => {
  if (!confirm(`${h.code} ${h.name ?? ""} ${h.shares}株 を売却\n現在値 ${Math.round(h.currentPrice)}円 (${h.unrealizedPct > 0 ? "+" : ""}${h.unrealizedPct.toFixed(2)}%)`)) return;
  selling.value[h.id] = true;
  try {
    const r = await fetch("/api/portfolio/sell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: h.id }),
    });
    const j = (await r.json()) as { error?: string; pnlYen?: number; pnlPct?: number };
    if (!r.ok) {
      alert(`売却失敗: ${j.error}`);
      return;
    }
    await fetchPortfolio();
    alert(`売却しました: ${fmtYen(j.pnlYen ?? 0)} (${(j.pnlPct ?? 0) > 0 ? "+" : ""}${j.pnlPct}%)`);
  } finally {
    selling.value[h.id] = false;
  }
};

const openFx = () => {
  currentView.value = "fx";
  if (fxTrades.value.length === 0) fetchFxSignals();
};
const openPortfolio = () => {
  currentView.value = "portfolio";
  fetchPortfolio();
};
const openHome = () => {
  currentView.value = "home";
  if (!portfolio.value) fetchPortfolio();
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
  fetchPortfolio();
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
        <button :class="{ nav: true, active: currentView === 'portfolio' }" @click="openPortfolio">
          ポートフォリオ
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

      <div v-if="patternCurrentMonthStat" class="season-banner" :class="currentMonthVerdict.tone">
        <div class="season-title">
          <strong>{{ patternCurrentMonth }}月の種まき判定: {{ currentMonthVerdict.label }}</strong>
        </div>
        <div class="season-stats">
          過去 {{ patternCurrentMonthStat.n }}件、90日保有の勝率
          <strong>{{ patternCurrentMonthStat.wr_90d }}%</strong> / 平均
          <strong>{{ patternCurrentMonthStat.avg_90d > 0 ? "+" : "" }}{{ patternCurrentMonthStat.avg_90d }}%</strong>
        </div>
        <div class="season-window">
          <div class="season-window-row">
            <span class="season-window-label buy">🌱 推奨買付期間</span>
            <strong>{{ recommendedWindow.buyLabel }}</strong>
          </div>
          <div class="season-window-row">
            <span class="season-window-label sell">🌾 推奨売却期間</span>
            <strong>{{ recommendedWindow.sellLabel }}</strong>
            <span v-if="recommendedWindow.sellMonthStat" class="season-rank-item">
              (売月実績: 平均{{ recommendedWindow.sellMonthStat.avg_90d > 0 ? "+" : "" }}{{ recommendedWindow.sellMonthStat.avg_90d }}%)
            </span>
          </div>
          <div v-if="nextStrongMonth" class="season-window-row hint">
            💡 待てば{{ nextStrongMonth.buy_month }}月 (平均+{{ nextStrongMonth.avg_90d }}%, 勝率{{ nextStrongMonth.wr_90d }}%) に強月あり
          </div>
        </div>
        <div class="season-rank">
          <span class="season-rank-group">
            <span class="season-rank-label pos">強い月</span>
            <span v-for="m in monthRank.best" :key="'b' + m.buy_month" class="season-rank-item">
              {{ m.buy_month }}月({{ m.avg_90d > 0 ? "+" : "" }}{{ m.avg_90d }}%)
            </span>
          </span>
          <span class="season-rank-group">
            <span class="season-rank-label neg">弱い月</span>
            <span v-for="m in monthRank.worst" :key="'w' + m.buy_month" class="season-rank-item">
              {{ m.buy_month }}月({{ m.avg_90d > 0 ? "+" : "" }}{{ m.avg_90d }}%)
            </span>
          </span>
        </div>
      </div>
      <div v-if="patternLoading" class="pattern-msg">読み込み中...</div>
      <div v-else-if="!patternToday.length" class="pattern-msg">本日は候補なし（マッチゼロ）</div>
      <table v-else class="pattern-table">
        <thead>
          <tr>
            <th>コード</th>
            <th>銘柄名</th>
            <th class="num">エントリー</th>
            <th>買付予定</th>
            <th>売却予定</th>
            <th class="num">口数</th>
            <th>購入</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in patternToday" :key="p.code">
            <td>{{ p.code }}</td>
            <td>{{ p.name ?? "-" }}</td>
            <td class="num">{{ Math.round(p.entryClose).toLocaleString() }}円</td>
            <td>{{ nextBusinessDay(p.runDate) }}</td>
            <td>{{ addBusinessDays(p.runDate, 90) }} <span class="pattern-n">(90取引日後)</span></td>
            <td class="num">
              <select v-model.number="buyLots[p.code]" class="lot-select">
                <option v-for="n in 10" :key="n" :value="n">{{ n }}口 ({{ (n * 100 * p.entryClose).toLocaleString() }}円)</option>
              </select>
            </td>
            <td>
              <button class="buy-btn" :disabled="buying[p.code]" @click="buyPick(p)">
                {{ buying[p.code] ? "処理中..." : "買う" }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

    </section>

    <section v-else-if="currentView === 'portfolio'" class="pattern-panel">
      <header class="pattern-header">
        <h2>ポートフォリオ</h2>
        <span class="pattern-meta">50万円スタート / 手動買付売却</span>
      </header>

      <div v-if="portfolioLoading" class="pattern-msg">読み込み中...</div>
      <div v-else-if="!portfolio" class="pattern-msg">データなし</div>

      <div v-else>
        <div class="fx-summary">
          <div class="fx-card">
            <span class="fx-card-label">残高</span>
            <span class="fx-card-value">{{ portfolio.cash.toLocaleString() }}円</span>
            <span class="fx-card-sub">保有評価額 {{ portfolio.holdingsValue.toLocaleString() }}円</span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">資産合計</span>
            <span
              class="fx-card-value big"
              :class="{ pos: portfolio.returnPct > 0, neg: portfolio.returnPct < 0 }"
            >{{ portfolio.equity.toLocaleString() }}円</span>
            <span
              class="fx-card-sub"
              :class="{ pos: portfolio.returnPct > 0, neg: portfolio.returnPct < 0 }"
            >
              {{ fmtYen(portfolio.totalPnl) }} ({{ portfolio.returnPct > 0 ? "+" : "" }}{{ Math.round(portfolio.returnPct) }}%)
            </span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">実現損益</span>
            <span class="fx-card-value" :class="{ pos: portfolio.realizedPnl > 0, neg: portfolio.realizedPnl < 0 }">
              {{ fmtYen(portfolio.realizedPnl) }}
            </span>
            <span class="fx-card-sub">決済済み</span>
          </div>
          <div class="fx-card">
            <span class="fx-card-label">含み損益</span>
            <span class="fx-card-value" :class="{ pos: portfolio.unrealizedPnl > 0, neg: portfolio.unrealizedPnl < 0 }">
              {{ fmtYen(portfolio.unrealizedPnl) }}
            </span>
            <span class="fx-card-sub">保有中</span>
          </div>
        </div>

        <h3 class="fx-section-title">保有銘柄 ({{ portfolio.open.length }}件)</h3>
        <table v-if="portfolio.open.length" class="pattern-stats-table fx-trades">
          <thead>
            <tr>
              <th>買付日</th>
              <th>コード</th>
              <th>銘柄名</th>
              <th class="num">買値</th>
              <th class="num">株数</th>
              <th class="num">投資額</th>
              <th class="num">現在値</th>
              <th class="num">評価額</th>
              <th class="num">含み損益</th>
              <th>売却</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in portfolio.open" :key="h.id">
              <td>{{ fmtYmd(h.buyDate) }}</td>
              <td>{{ h.code }}</td>
              <td>{{ h.name ?? "-" }}</td>
              <td class="num">{{ Math.round(h.buyPrice) }}円</td>
              <td class="num">{{ h.shares }}</td>
              <td class="num">{{ Math.round(h.investmentYen).toLocaleString() }}円</td>
              <td class="num">{{ Math.round(h.currentPrice) }}円</td>
              <td class="num">{{ Math.round(h.currentValue).toLocaleString() }}円</td>
              <td class="num" :class="{ pos: h.unrealizedYen > 0, neg: h.unrealizedYen < 0 }">
                {{ fmtYen(h.unrealizedYen) }}
                <span class="pattern-n">({{ h.unrealizedPct > 0 ? "+" : "" }}{{ h.unrealizedPct.toFixed(1) }}%)</span>
              </td>
              <td>
                <button class="sell-btn" :disabled="selling[h.id]" @click="sellHolding(h)">
                  {{ selling[h.id] ? "処理中..." : "売る" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="pattern-msg">保有銘柄なし。「株」タブでピックを購入してください。</div>

        <h3 class="fx-section-title">決済済みトレード ({{ portfolio.closed.length }}件)</h3>
        <table v-if="portfolio.closed.length" class="pattern-stats-table fx-trades">
          <thead>
            <tr>
              <th>買付</th>
              <th>売却</th>
              <th>コード</th>
              <th>銘柄名</th>
              <th class="num">買値</th>
              <th class="num">売値</th>
              <th class="num">株数</th>
              <th class="num">損益</th>
              <th class="num">率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in portfolio.closed" :key="t.id">
              <td>{{ fmtYmd(t.buyDate) }}</td>
              <td>{{ t.sellDate != null ? fmtYmd(t.sellDate) : "-" }}</td>
              <td>{{ t.code }}</td>
              <td>{{ t.name ?? "-" }}</td>
              <td class="num">{{ Math.round(t.buyPrice) }}</td>
              <td class="num">{{ t.sellPrice != null ? Math.round(t.sellPrice) : "-" }}</td>
              <td class="num">{{ t.shares }}</td>
              <td class="num" :class="{ pos: (t.pnlYen ?? 0) > 0, neg: (t.pnlYen ?? 0) < 0 }">
                {{ t.pnlYen != null ? fmtYen(t.pnlYen) : "-" }}
              </td>
              <td class="num" :class="{ pos: (t.pnlPct ?? 0) > 0, neg: (t.pnlPct ?? 0) < 0 }">
                {{ t.pnlPct != null ? (t.pnlPct > 0 ? "+" : "") + t.pnlPct.toFixed(1) + "%" : "-" }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="pattern-msg">決済履歴なし</div>
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
.season-banner {
  margin: 0.4rem 0 0.75rem;
  padding: 0.65rem 0.85rem;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.82rem;
}
.season-banner.pos-strong {
  background: #d1fae5;
  border-color: #a7f3d0;
}
.season-banner.pos {
  background: #ecfdf5;
  border-color: #bbf7d0;
}
.season-banner.neutral-pos,
.season-banner.neutral-neg {
  background: #fefce8;
  border-color: #fde68a;
}
.season-banner.neg {
  background: #fee2e2;
  border-color: #fecaca;
}
.season-title strong {
  font-size: 0.95rem;
}
.season-stats {
  color: #333;
}
.season-rank {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: 0.75rem;
  color: #555;
}
.season-rank-group {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}
.season-rank-label {
  padding: 0.05rem 0.4rem;
  border-radius: 3px;
  font-weight: 600;
  font-size: 0.7rem;
}
.season-rank-label.pos {
  background: #d1fae5;
  color: #065f46;
}
.season-rank-label.neg {
  background: #fee2e2;
  color: #991b1b;
}
.season-rank-item {
  color: #444;
}
.season-window {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.4rem 0;
  border-top: 1px dashed rgba(0, 0, 0, 0.1);
  border-bottom: 1px dashed rgba(0, 0, 0, 0.1);
  font-size: 0.85rem;
}
.season-window-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.season-window-row.hint {
  color: #555;
  font-size: 0.75rem;
}
.season-window-label {
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
}
.season-window-label.buy {
  background: #d1fae5;
  color: #065f46;
}
.season-window-label.sell {
  background: #fef3c7;
  color: #92400e;
}
.lot-select {
  padding: 0.2rem 0.3rem;
  border: 1px solid #cbd2da;
  border-radius: 4px;
  font-size: 0.75rem;
  background: #fff;
}
.buy-btn {
  padding: 0.3rem 0.7rem;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
}
.buy-btn:hover {
  background: #1d4ed8;
}
.buy-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}
.sell-btn {
  padding: 0.3rem 0.7rem;
  background: #dc2626;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
}
.sell-btn:hover {
  background: #b91c1c;
}
.sell-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}
</style>
