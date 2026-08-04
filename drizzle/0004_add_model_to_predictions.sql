PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_predictions` (
	`code` text NOT NULL,
	`model_name` text NOT NULL,
	`run_at` integer NOT NULL,
	`last_date` integer NOT NULL,
	`last_close` real NOT NULL,
	`horizon_days` integer NOT NULL,
	`predicted_close` real NOT NULL,
	`expected_return_pct` real NOT NULL,
	`preds_json` text NOT NULL,
	PRIMARY KEY(`code`, `model_name`)
);
--> statement-breakpoint
INSERT INTO `__new_predictions`("code", "model_name", "run_at", "last_date", "last_close", "horizon_days", "predicted_close", "expected_return_pct", "preds_json") SELECT "code", 'lstm_v1', "run_at", "last_date", "last_close", "horizon_days", "predicted_close", "expected_return_pct", "preds_json" FROM `predictions`;--> statement-breakpoint
DROP TABLE `predictions`;--> statement-breakpoint
ALTER TABLE `__new_predictions` RENAME TO `predictions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `predictions_return_idx` ON `predictions` (`expected_return_pct`);--> statement-breakpoint
CREATE INDEX `predictions_model_idx` ON `predictions` (`model_name`);