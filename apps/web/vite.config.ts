import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";
import { gmPreload } from "./gm-preload-plugin";

const webPort = Number(process.env.WEB_PORT ?? 5296);
const serverPort = Number(process.env.SERVER_PORT ?? 3025);

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/carcassonne/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette), gmPreload()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/socket.io": { target: `http://localhost:${serverPort}`, ws: true },
      "/health": `http://localhost:${serverPort}`
    }
  }
});
