CREATE TABLE `external_daily` (
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`close` real NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`symbol`, `date`)
);
--> statement-breakpoint
CREATE INDEX `external_daily_symbol_idx` ON `external_daily` (`symbol`);--> statement-breakpoint
ALTER TABLE `fx_features` ADD COLUMN `nikkei_prev_return_bps` real;
