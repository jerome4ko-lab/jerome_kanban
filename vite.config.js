import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { createApiHandler } from "./server/api.mjs";

function apiPlugin(env) {
  const handleApiRequest = createApiHandler({ env });

  function attachApiRoutes(middlewares) {
    middlewares.use(async (req, res, next) => {
      const handled = await handleApiRequest(req, res);
      if (!handled) {
        next();
      }
    });
  }

  return {
    name: "ai-study-api",
    configureServer(server) {
      attachApiRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      attachApiRoutes(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      apiPlugin(env),
      VitePWA({
        registerType: "autoUpdate",
        workbox: { skipWaiting: true, clientsClaim: true },
        includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png"],
        manifest: {
          name: "Pace",
          short_name: "Pace",
          description: "Pace 칸반 보드",
          display: "standalone",
          orientation: "portrait",
          background_color: "#0f172a",
          theme_color: "#0f172a",
          lang: "ko",
          start_url: "/",
          icons: [
            { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
      }),
    ],
  };
});
