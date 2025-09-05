// https://nuxt.com/docs/api/configuration/nuxt-config
import Aura from "@primeuix/themes/aura";

export default defineNuxtConfig({
  srcDir: ".",
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  modules: [
    "@nuxt/eslint",
    "@nuxt/icon",
    "@nuxt/image",
    "@primevue/nuxt-module",
  ],
  components: {
    dirs: ["~/components"],
  },
  pages: true,
  runtimeConfig: {
    public: {
      apiBase:
        process.env.NODE_ENV === "production" ? "" : "http://localhost:80",
    },
  },
  app: {
    head: {
      title: "Nona Metadata",
      htmlAttrs: {
        class: "dark",
      },
      meta: [
        {
          name: "description",
          content: "A tool for managing and processing your library's metadata",
        },
        { property: "og:title", content: "Nona Metadata" },
        {
          property: "og:description",
          content: "A tool for managing and processing your library's metadata",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: "Nona Metadata" },
        {
          name: "twitter:description",
          content: "A tool for managing and processing your library's metadata",
        },
      ],
    },
  },
  primevue: {
    autoImport: true,
    options: {
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: ".dark",
        },
      },
    },
  },
});
