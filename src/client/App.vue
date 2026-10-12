<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

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
    <h1>Stock AI</h1>
    <p class="meta">
      API: <strong>{{ apiStatus }}</strong>
    </p>

    <section class="pattern-panel">
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
.pattern-stats-table td.pos {
  color: #198754;
}
.pattern-stats-table td.neg {
  color: #c0392b;
}
.pattern-table td.pos {
  color: #198754;
}
.pattern-table td.neg {
  color: #c0392b;
}
.pattern-n {
  display: block;
  color: #999;
  font-size: 0.7rem;
  font-weight: normal;
}
</style>
