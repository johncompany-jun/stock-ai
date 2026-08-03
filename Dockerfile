FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install

FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["bun", "run", "dev"]
