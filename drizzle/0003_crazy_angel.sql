CREATE TABLE `prediction_log` (
	`code` text NOT NULL,
	`run_date` integer NOT NULL,
	`horizon_days` integer NOT NULL,
	`model_name` text NOT NULL,
	`last_close` real NOT NULL,
	`predicted_close` real NOT NULL,
	`actual_close` real,
	`error_pct` real,
	`direction_hit` integer,
	PRIMARY KEY(`code`, `run_date`, `horizon_days`, `model_name`)
);
--> statement-breakpoint
CREATE INDEX `prediction_log_horizon_idx` ON `prediction_log` (`horizon_days`,`model_name`);--> statement-breakpoint
CREATE INDEX `prediction_log_run_date_idx` ON `prediction_log` (`run_date`);