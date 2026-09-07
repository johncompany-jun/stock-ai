-- LSTM + SMA が同方向 & 予測平均変化率のマグニチュード別 hit%
-- 「同意 + 強気」だけに絞ると勝率が上がるかを検証
WITH per_run AS (
  SELECT
    code, run_date, horizon_days, actual_close, last_close,
    MAX(CASE WHEN model_name = 'lstm_v1' THEN predicted_close END) AS pred_lstm,
    MAX(CASE WHEN model_name = 'sma_cross_v1' THEN predicted_close END) AS pred_sma
  FROM prediction_log
  WHERE actual_close IS NOT NULL
  GROUP BY code, run_date, horizon_days
),
scored AS (
  SELECT
    horizon_days, last_close, actual_close, pred_lstm, pred_sma,
    (pred_lstm - last_close) * 100.0 / last_close AS lstm_ret,
    (pred_sma  - last_close) * 100.0 / last_close AS sma_ret,
    CASE WHEN pred_lstm > last_close THEN 1 WHEN pred_lstm < last_close THEN -1 ELSE 0 END AS d_lstm,
    CASE WHEN pred_sma  > last_close THEN 1 WHEN pred_sma  < last_close THEN -1 ELSE 0 END AS d_sma,
    CASE WHEN actual_close > last_close THEN 1 WHEN actual_close < last_close THEN -1 ELSE 0 END AS d_actual
  FROM per_run
  WHERE pred_lstm IS NOT NULL AND pred_sma IS NOT NULL
),
agreed AS (
  SELECT
    horizon_days, d_lstm, d_actual,
    (lstm_ret + sma_ret) / 2.0 AS avg_ret
  FROM scored
  WHERE d_lstm = d_sma AND d_lstm != 0
)
SELECT
  horizon_days,
  CASE
    WHEN ABS(avg_ret) >= 10 THEN '5_>=10%'
    WHEN ABS(avg_ret) >= 5  THEN '4_5-10%'
    WHEN ABS(avg_ret) >= 3  THEN '3_3-5%'
    WHEN ABS(avg_ret) >= 1  THEN '2_1-3%'
    ELSE                        '1_<1%'
  END AS mag_bucket,
  COUNT(*) AS n,
  ROUND(AVG(CASE WHEN d_lstm = d_actual THEN 100.0 ELSE 0 END), 1) AS hit_pct,
  ROUND(AVG(avg_ret), 2) AS mean_pred_ret_pct
FROM agreed
GROUP BY horizon_days, mag_bucket
ORDER BY horizon_days, mag_bucket;
