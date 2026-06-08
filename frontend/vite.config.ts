import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

type VitestConfig = UserConfig & {
  test: {
    environment: string;
    setupFiles: string[];
  };
};

const config = {
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8765",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
} satisfies VitestConfig;

export default defineConfig(config as UserConfig);
