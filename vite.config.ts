import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import devServer from "@hono/vite-dev-server";
import adapter from "@hono/vite-dev-server/cloudflare";

export default defineConfig({
  plugins: [
    vue(),
    devServer({
      entry: "src/server/index.ts",
      adapter,
      exclude: [
        /.*\.(ts|tsx|vue|css|scss|sass|less|styl)$/,
        /.*\.(svg|png|jpe?g|gif|webp|ico|bmp)$/,
        /^\/@.+$/,
        /^\/(src|public|node_modules)\/.*/,
        /^\/favicon\.ico$/,
        /^\/$/,
        /^\/index\.html$/,
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
