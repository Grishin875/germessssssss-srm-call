import { Page, expect } from "@playwright/test";

export const USERS = {
  admin:    { username: "admin", password: "admin123" },
  operator: { username: "123",   password: "123"      },
  otk:      { username: "111",   password: "111"      },
};

const API_URL = "http://localhost:8000";

/**
 * Получает JWT-токен через REST API и вставляет его в localStorage браузера.
 * Это надёжнее чем логин через UI — не зависит от скорости рендера React.
 */
export async function login(page: Page, user: { username: string; password: string }) {
  // 1. Получаем токен через API (Node.js fetch, не браузер)
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ username: user.username, password: user.password }),
  });

  if (!res.ok) throw new Error(`Не удалось залогиниться как ${user.username}: HTTP ${res.status}`);
  const { token } = await res.json() as { token: string };
  if (!token) throw new Error(`Нет токена в ответе для ${user.username}`);

  // 2. Открываем пустую страницу приложения и вставляем токен в localStorage
  await page.goto("http://localhost:3000");
  await page.evaluate((t) => localStorage.setItem("crm_token", t), token);

  console.log(`  🔑 Залогинен как ${user.username} (токен вставлен в localStorage)`);
}

/**
 * Переходит на страницу и ждёт пока React-компонент отрендерит h1
 * (не null — т.е. auth-проверка завершилась).
 */
export async function goto(page: Page, path: string) {
  await page.goto(`http://localhost:3000${path}`);
  // Ждём пока исчезнет loading-состояние (h1 появится на странице)
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
}
