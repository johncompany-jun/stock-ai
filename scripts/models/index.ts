import { createLstmModel } from "./lstm";
import { createRsiReversalModel } from "./rsi_reversal";
import { createSmaCrossModel } from "./sma_cross";
import type { ModelDef } from "./types";

export type ModelKey = "lstm_v1" | "sma_cross_v1" | "rsi_reversal_v1";

export const buildModel = (
  key: ModelKey,
  opts: { window?: number; epochs?: number; units?: number } = {},
): ModelDef => {
  switch (key) {
    case "lstm_v1":
      return createLstmModel(opts);
    case "sma_cross_v1":
      return createSmaCrossModel();
    case "rsi_reversal_v1":
      return createRsiReversalModel();
  }
};

export const ALL_MODEL_KEYS: ModelKey[] = ["lstm_v1", "sma_cross_v1", "rsi_reversal_v1"];

export type { ModelDef } from "./types";
