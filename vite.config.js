import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base: "./" uses relative asset paths, so this works whether the repo is
// deployed at https://<user>.github.io/ (user/org site) or
// https://<user>.github.io/<repo>/ (project site) — no repo name to hardcode.
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "icons/favicon.png",
        "icons/apple-touch-icon.png",
      ],
      manifest: {
        name: "עומסי חשמל — מחשבון עומסים",
        short_name: "עומסי חשמל",
        description:
          "כלי שטח לחלוקת עומס חשמלי בין 3 פאזות בלוח 32A/63A, בלי להפיל את הלוח.",
        lang: "he",
        dir: "rtl",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f4f4f5",
        theme_color: "#18181b",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
        // Cache the Google Fonts request so the app still looks right offline
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
