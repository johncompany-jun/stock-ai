CREATE TABLE `daily_picks` (
	`code` text NOT NULL,
	`run_date` integer NOT NULL,
	`model_name` text NOT NULL,
	`horizon_days` integer NOT NULL,
	`last_close` real NOT NULL,
	`predicted_close` real NOT NULL,
	`expected_return_pct` real NOT NULL,
	`confidence` integer NOT NULL,
	`agreement` integer NOT NULL,
	`agreement_total` integer NOT NULL,
	`return_stdev_pct` real NOT NULL,
	`confidence_tier` text,
	`preds_json` text NOT NULL,
	`actual_close` real,
	`actual_date` integer,
	`direction_hit` integer,
	`return_pct` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`code`, `run_date`)
);
--> statement-breakpoint
CREATE INDEX `daily_picks_run_date_idx` ON `daily_picks` (`run_date`);--> statement-breakpoint
CREATE INDEX `daily_picks_confidence_idx` ON `daily_picks` (`confidence`);