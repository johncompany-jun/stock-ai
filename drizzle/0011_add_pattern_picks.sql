CREATE TABLE `pattern_picks` (
	`code` text NOT NULL,
	`run_date` integer NOT NULL,
	`patterns` text NOT NULL,
	`entry_close` real NOT NULL,
	`actual_5d_close` real,
	`actual_5d_date` integer,
	`return_5d_pct` real,
	`actual_15d_close` real,
	`actual_15d_date` integer,
	`return_15d_pct` real,
	`actual_30d_close` real,
	`actual_30d_date` integer,
	`return_30d_pct` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`code`, `run_date`)
);
--> statement-breakpoint
CREATE INDEX `pattern_picks_run_date_idx` ON `pattern_picks` (`run_date`);
