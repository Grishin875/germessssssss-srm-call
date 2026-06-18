import { test, expect } from "@playwright/test";

test("debug auth", async ({ page }) => {
  // Получаем токен через API
  const res = await fetch("http://localhost:8000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  const data = await res.json() as { token: string };
  console.log("Token получен:", data.token.slice(0, 30));

  // Открываем корень и вставляем токен
  await page.goto("http://localhost:3000");
  await page.evaluate((t) => localStorage.setItem("crm_token", t), data.token);
  
  // Проверяем что токен в localStorage
  const stored = await page.evaluate(() => localStorage.getItem("crm_token"));
  console.log("В localStorage:", stored?.slice(0, 30));

  // Переходим на /orders
  await page.goto("http://localhost:3000/orders");
  
  // Что на странице после 3 сек?
  await page.waitForTimeout(3000);
  const url = page.url();
  console.log("Текущий URL:", url);
  
  // Что в localStorage после перехода?
  const storedAfter = await page.evaluate(() => localStorage.getItem("crm_token"));
  console.log("localStorage после goto:", storedAfter?.slice(0, 30) ?? "ПУСТО");
  
  // Делаем запрос /api/auth/me прямо из браузера
  const meResult = await page.evaluate(async (token) => {
    try {
      const r = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
      return { status: r.status, body: await r.text() };
    } catch(e) {
      return { error: String(e) };
    }
  }, data.token);
  console.log("/api/auth/me из браузера:", JSON.stringify(meResult).slice(0, 200));

  expect(url).not.toContain("/login");
});
