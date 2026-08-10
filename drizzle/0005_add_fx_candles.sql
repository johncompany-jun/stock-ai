CREATE TABLE `fx_candles` (
	`pair` text NOT NULL,
	`timestamp_utc` integer NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL,
	PRIMARY KEY(`pair`, `timestamp_utc`)
);
--> statement-breakpoint
CREATE INDEX `fx_candles_pair_idx` ON `fx_candles` (`pair`);