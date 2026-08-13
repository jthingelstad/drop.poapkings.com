import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  publicDir: fileURLToPath(new URL("../web/public", import.meta.url)),
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8780",
    },
  },
});
