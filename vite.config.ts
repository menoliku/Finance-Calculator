import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/Finance-Calculator/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-32.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Finance Backtester",
        short_name: "Backtester",
        description:
          "Search a stock, backtest historical investments, and get educational stock analysis and recommendations.",
        start_url: "/Finance-Calculator/",
        scope: "/Finance-Calculator/",
        display: "standalone",
        background_color: "#0d0f1a",
        theme_color: "#536dfe",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Cache the app shell; API calls to the backend are always network,
        // never cached, so stock data/prices/auth are never served stale.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallbackDenylist: [/^\/(?!Finance-Calculator)/],
      },
    }),
  ],
});