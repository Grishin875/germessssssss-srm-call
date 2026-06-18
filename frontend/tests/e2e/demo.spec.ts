import { test, expect } from "@playwright/test";

/**
 * Наглядный демо-сценарий «всё тыкается на фронте».
 * Запуск с видимым браузером:
 *     npx playwright test demo --headed
 * (медленно, с паузами — чтобы видеть каждый шаг)
 */

const APP = "http://localhost:3000";
const pause = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

test("Демо: логин → дашборд → рецептура → заказы → создание заказа", async ({ page }) => {
  test.setTimeout(180_000);

  // ── 1. Вход через форму ──────────────────────────────
  console.log("▶ Шаг 1: открываем форму входа");
  await page.goto(`${APP}/login`);
  await pause();
  console.log("▶ Шаг 2: вводим логин и пароль");
  await page.fill('input[placeholder="Введите ваш логин"]', "admin");
  await pause(600);
  await page.fill('input[placeholder="Введите ваш пароль"]', "admin");
  await pause(600);
  console.log("▶ Шаг 3: нажимаем «Войти»");
  await page.click('button:has-text("Войти")');
  await page.waitForURL(/dashboard|\/$/, { timeout: 20_000 });
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
  await pause(1800);

  // ── 2. Прогулка по дашборду ──────────────────────────
  console.log("▶ Шаг 4: дашборд — наводим на карточки");
  for (const sel of [".card-elev"]) {
    const cards = page.locator(sel);
    const n = Math.min(await cards.count(), 4);
    for (let i = 0; i < n; i++) { await cards.nth(i).hover(); await pause(450); }
  }
  await pause(800);

  // ── 3. Рецептура: свернуть/развернуть ────────────────
  console.log("▶ Шаг 5: открываем Рецептуру");
  await page.click('a:has-text("Рецептура")');
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
  await pause(1500);
  const collapseAll = page.locator('button:has-text("Свернуть все")');
  if (await collapseAll.count()) {
    console.log("▶ Шаг 6: сворачиваем все рецепты");
    await collapseAll.first().click();
    await pause(1500);
    const expandAll = page.locator('button:has-text("Развернуть все")');
    if (await expandAll.count()) { console.log("▶ Шаг 7: разворачиваем обратно"); await expandAll.first().click(); await pause(1200); }
  }

  // ── 4. Заказы: открыть модалку создания ──────────────
  console.log("▶ Шаг 8: открываем Заказы");
  await page.click('a:has-text("Заказы")');
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
  await pause(1500);

  console.log("▶ Шаг 9: жмём «Создать заказ»");
  const createBtn = page.locator('button:has-text("Создать заказ")').first();
  if (await createBtn.count()) {
    await createBtn.click();
    await pause(1500);
    console.log("▶ Шаг 10: закрываем модалку (Esc)");
    await page.keyboard.press("Escape");
    await pause(1000);
  }

  // ── 5. Прогулка по разделам ──────────────────────────
  for (const link of ["Склад", "ОТК", "Отгрузка", "Главная"]) {
    const a = page.locator(`a:has-text("${link}")`).first();
    if (await a.count()) {
      console.log(`▶ Переходим: ${link}`);
      await a.click();
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
      await pause(1300);
    }
  }

  console.log("✓ Демо завершено");
  await pause(1500);
});
