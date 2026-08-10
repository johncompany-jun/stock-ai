CREATE TABLE `fx_features` (
	`pair` text NOT NULL,
	`date` text NOT NULL,
	`entry_ts_utc` integer NOT NULL,
	`entry_price` real NOT NULL,
	`ny_delta_pips` real,
	`morning_trend_bps` real,
	`gotoubi_flag` integer NOT NULL,
	`dow` integer NOT NULL,
	`label_995_pips` real,
	`tp_hit_min` integer,
	`sl_hit_min` integer,
	PRIMARY KEY(`pair`, `date`)
);
--> statement-breakpoint
CREATE INDEX `fx_features_date_idx` ON `fx_features` (`date`);