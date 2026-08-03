CREATE TABLE `stocks` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`market` text NOT NULL,
	`price` real,
	`change_abs` real,
	`change_pct` real,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stocks_market_idx` ON `stocks` (`market`);--> statement-breakpoint
CREATE INDEX `stocks_name_idx` ON `stocks` (`name`);