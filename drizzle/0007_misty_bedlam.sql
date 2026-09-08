CREATE TABLE `fx_predictions` (
	`pair` text NOT NULL,
	`date` text NOT NULL,
	`entry_price` real NOT NULL,
	`direction` text NOT NULL,
	`probability` real NOT NULL,
	`confidence` real NOT NULL,
	`long_wins` integer NOT NULL,
	`short_wins` integer NOT NULL,
	`avg_long` real NOT NULL,
	`avg_short` real NOT NULL,
	`k` integer NOT NULL,
	`seeds` integer NOT NULL,
	`actual_label_pips` real,
	`actual_tp_hit_min` integer,
	`actual_sl_hit_min` integer,
	`pnl_pips` real,
	`hit` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`pair`, `date`)
);
--> statement-breakpoint
CREATE INDEX `fx_predictions_date_idx` ON `fx_predictions` (`date`);