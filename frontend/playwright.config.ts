import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,          // 90 sec на каждый тест
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    headless: false,          // true — для CI/CD, false — видно браузер
    screenshot: "only-on-failure",
    video: "off",
    locale: "ru-RU",
  },

  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" }, // реальный Google Chrome
    },
  ],
});
