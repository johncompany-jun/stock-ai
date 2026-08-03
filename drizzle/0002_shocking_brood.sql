CREATE TABLE `predictions` (
	`code` text PRIMARY KEY NOT NULL,
	`run_at` integer NOT NULL,
	`last_date` integer NOT NULL,
	`last_close` real NOT NULL,
	`horizon_days` integer NOT NULL,
	`predicted_close` real NOT NULL,
	`expected_return_pct` real NOT NULL,
	`preds_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `predictions_return_idx` ON `predictions` (`expected_return_pct`);