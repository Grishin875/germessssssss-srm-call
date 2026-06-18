import { test, expect } from "@playwright/test";
import { login, goto, USERS } from "./helpers";

// Smoke-тесты раздела A (виды/навигация) и M (UX) — требуют запущенный стек.
test.describe("Заказы: виды, фильтры, поиск", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, USERS.admin);
  });

  test("переключение видов таблица/канбан/календарь", async ({ page }) => {
    await goto(page, "/orders");
    await expect(page.getByRole("heading", { name: /Заказы/ })).toBeVisible();

    await page.getByRole("button", { name: /Канбан/ }).click();
    await expect(page.getByText(/К отгрузке|В работе|Создан/).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Календарь/ }).click();
    await expect(page.getByText(/Сегодня/).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Таблица/ }).click();
  });

  test("глобальный поиск Cmd+K открывается", async ({ page }) => {
    await goto(page, "/dashboard");
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder(/Поиск заказов/)).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });

  test("справка горячих клавиш по '?'", async ({ page }) => {
    await goto(page, "/dashboard");
    await page.keyboard.press("Shift+/");
    await expect(page.getByText(/Горячие клавиши/)).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
  });
});
