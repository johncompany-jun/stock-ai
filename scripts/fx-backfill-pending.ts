import { parseArgs } from "node:util";
import {
  computeOutcome,
  localCandleSource,
  remoteCandleSource,
  todayJstDate,
  type CandleSource,
} from "./lib/fx-predict";
import {
  computePnl,
  localPredictionStore,
  remotePredictionStore,
  type PredictionStore,
} from "./lib/fx-signal-log";

const { values } = parseArgs({
  options: {
    pair: { type: "string", default: "USDJPY" },
    tpPips: { type: "string", default: "20" },
    slPips: { type: "string", default: "20" },
    remote: { type: "boolean", default: false },
  },
});

const PAIR = values.pair!.toUpperCase();
const TP_PIPS = Number(values.tpPips);
const SL_PIPS = Number(values.slPips);

const buildSource = (): CandleSource => {
  if (!values.remote) return localCandleSource();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "remote モードには CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN が必要です",
    );
  }
  return remoteCandleSource({ accountId, databaseId, apiToken });
};

const buildStore = (): PredictionStore => {
  if (!values.remote) return localPredictionStore();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "remote モードには CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_D1_DATABASE_ID / CLOUDFLARE_API_TOKEN が必要です",
    );
  }
  return remotePredictionStore({ accountId, databaseId, apiToken });
};

const main = async () => {
  const today = todayJstDate();
  const source = buildSource();
  const store = buildStore();

  const pending = await store.listPendingPredictions(PAIR, today);
  console.log(`pending: ${pending.length} (pair=${PAIR}, before=${today})`);

  let resolved = 0;
  let skipped = 0;
  for (const p of pending) {
    const outcome = await computeOutcome(source, PAIR, p.date, {
      tpPips: TP_PIPS,
      slPips: SL_PIPS,
    });
    if (!outcome) {
      console.log(`skip ${p.date} (バー未整備)`);
      skipped++;
      continue;
    }
    const pnl = computePnl(
      p.direction,
      {
        actualLabelPips: outcome.label995Pips,
        actualTpHitMin: outcome.tpHitMin,
        actualSlHitMin: outcome.slHitMin,
      },
      TP_PIPS,
      SL_PIPS,
    );
    await store.updateOutcome(PAIR, p.date, {
      actualLabelPips: outcome.label995Pips,
      actualTpHitMin: outcome.tpHitMin,
      actualSlHitMin: outcome.slHitMin,
      pnlPips: pnl.pnlPips,
      hit: pnl.hit,
    });
    console.log(`backfilled ${p.date} ${p.direction} pnl=${pnl.pnlPips} hit=${pnl.hit}`);
    resolved++;
  }

  console.log(`\nresult: resolved=${resolved} skipped=${skipped} total=${pending.length}`);
};

await main();
