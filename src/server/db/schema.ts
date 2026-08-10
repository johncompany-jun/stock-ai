import { sqliteTable, text, real, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

export const stocks = sqliteTable(
  "stocks",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    market: text("market").notNull(),
    price: real("price"),
    changeAbs: real("change_abs"),
    changePct: real("change_pct"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    marketIdx: index("stocks_market_idx").on(t.market),
    nameIdx: index("stocks_name_idx").on(t.name),
  }),
);

export type Stock = typeof stocks.$inferSelect;

export const candles = sqliteTable(
  "candles",
  {
    code: text("code").notNull(),
    date: integer("date").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume").notNull(),
    adjClose: real("adj_close"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.code, t.date] }),
    codeIdx: index("candles_code_idx").on(t.code),
  }),
);

export type Candle = typeof candles.$inferSelect;

export const predictions = sqliteTable(
  "predictions",
  {
    code: text("code").notNull(),
    modelName: text("model_name").notNull(),
    runAt: integer("run_at").notNull(),
    lastDate: integer("last_date").notNull(),
    lastClose: real("last_close").notNull(),
    horizonDays: integer("horizon_days").notNull(),
    predictedClose: real("predicted_close").notNull(),
    expectedReturnPct: real("expected_return_pct").notNull(),
    predsJson: text("preds_json").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.code, t.modelName] }),
    returnIdx: index("predictions_return_idx").on(t.expectedReturnPct),
    modelIdx: index("predictions_model_idx").on(t.modelName),
  }),
);

export type Prediction = typeof predictions.$inferSelect;

export const predictionLog = sqliteTable(
  "prediction_log",
  {
    code: text("code").notNull(),
    runDate: integer("run_date").notNull(),
    horizonDays: integer("horizon_days").notNull(),
    modelName: text("model_name").notNull(),
    lastClose: real("last_close").notNull(),
    predictedClose: real("predicted_close").notNull(),
    actualClose: real("actual_close"),
    errorPct: real("error_pct"),
    directionHit: integer("direction_hit"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.code, t.runDate, t.horizonDays, t.modelName] }),
    horizonIdx: index("prediction_log_horizon_idx").on(t.horizonDays, t.modelName),
    runDateIdx: index("prediction_log_run_date_idx").on(t.runDate),
  }),
);

export type PredictionLog = typeof predictionLog.$inferSelect;

export const fxCandles = sqliteTable(
  "fx_candles",
  {
    pair: text("pair").notNull(),
    timestampUtc: integer("timestamp_utc").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.pair, t.timestampUtc] }),
    pairIdx: index("fx_candles_pair_idx").on(t.pair),
  }),
);

export type FxCandle = typeof fxCandles.$inferSelect;
