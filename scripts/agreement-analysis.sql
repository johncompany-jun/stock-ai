WITH per_run AS (
  SELECT
    code, run_date, horizon_days, actual_close, last_close,
    MAX(CASE WHEN model_name = 'lstm_v1' THEN predicted_close END) AS pred_lstm,
    MAX(CASE WHEN model_name = 'sma_cross_v1' THEN predicted_close END) AS pred_sma,
    MAX(CASE WHEN model_name = 'rsi_reversal_v1' THEN predicted_close END) AS pred_rsi
  FROM prediction_log
  WHERE actual_close IS NOT NULL
  GROUP BY code, run_date, horizon_days
),
dirs AS (
  SELECT
    horizon_days, last_close, actual_close,
    CASE WHEN pred_lstm > last_close THEN 1 WHEN pred_lstm < last_close THEN -1 ELSE 0 END AS d_lstm,
    CASE WHEN pred_sma > last_close THEN 1 WHEN pred_sma < last_close THEN -1 ELSE 0 END AS d_sma,
    CASE WHEN pred_rsi > last_close THEN 1 WHEN pred_rsi < last_close THEN -1 ELSE 0 END AS d_rsi,
    CASE WHEN actual_close > last_close THEN 1 WHEN actual_close < last_close THEN -1 ELSE 0 END AS d_actual
  FROM per_run
  WHERE pred_lstm IS NOT NULL AND pred_sma IS NOT NULL AND pred_rsi IS NOT NULL
),
bucketed AS (
  SELECT
    horizon_days, d_lstm, d_sma, d_rsi, d_actual,
    CASE
      WHEN d_lstm = d_sma AND d_rsi = d_lstm AND d_rsi != 0 THEN '3/3 全一致'
      WHEN d_lstm = d_sma AND (d_rsi = 0 OR d_rsi != d_lstm) THEN 'LSTM+SMA 一致'
      WHEN d_lstm != d_sma THEN 'LSTM vs SMA 対立'
      ELSE 'その他'
    END AS bucket,
    CASE
      WHEN d_lstm = d_sma THEN d_lstm
      ELSE 0
    END AS consensus_dir
  FROM dirs
)
SELECT
  horizon_days,
  bucket,
  COUNT(*) AS n,
  ROUND(AVG(CASE WHEN consensus_dir = d_actual AND consensus_dir != 0 THEN 100.0 ELSE 0 END), 1) AS hit_pct
FROM bucketed
GROUP BY horizon_days, bucket
ORDER BY horizon_days, bucket;
