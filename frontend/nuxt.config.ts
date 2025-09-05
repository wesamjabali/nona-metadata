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
      htmlAttrs: {
        class: "dark",
      },
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
