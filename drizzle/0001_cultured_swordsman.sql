CREATE TABLE `candles` (
	`code` text NOT NULL,
	`date` integer NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real NOT NULL,
	`adj_close` real,
	PRIMARY KEY(`code`, `date`)
);
--> statement-breakpoint
CREATE INDEX `candles_code_idx` ON `candles` (`code`);