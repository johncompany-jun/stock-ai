import { readFile } from "node:fs/promises";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import devServer from "@hono/vite-dev-server";
import adapter from "@hono/vite-dev-server/cloudflare";

const mdAsText = (): Plugin => ({
  name: "md-as-text",
  async transform(_code, id) {
    if (!id.endsWith(".md")) return null;
    const file = id.split("?")[0];
    const raw = await readFile(file, "utf-8");
    return { code: `export default ${JSON.stringify(raw)};`, map: null };
  },
});

export default defineConfig({
  plugins: [
    vue(),
    mdAsText(),
    devServer({
      entry: "src/server/index.ts",
      adapter,
      exclude: [
        /.*\.(ts|tsx|vue|css|scss|sass|less|styl)$/,
        /.*\.(svg|png|jpe?g|gif|webp|ico|bmp)$/,
        /^\/@.+$/,
        /^\/(src|public|node_modules)\/.*/,
        /^\/favicon\.ico$/,
      ],
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      usePolling: true,
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
