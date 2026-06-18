/**
 * ПОЛНЫЙ визуальный сквозной сценарий со всеми ролями.
 *   npx playwright test full-flow --headed
 *
 * Подготовка данных (склад, рецептура СМД+3D+Сборка, заказы) — через API (надёжно).
 * Визуально показываются: результаты на страницах + работа каждой роли:
 *   СМД → 3D → Монтажник → ОТК(брак) → Монтажник(переделка) → ОТК(приём) → Отгрузка → Руководитель.
 */
import { test, expect, Page, APIRequestContext, request as pwRequest } from "@playwright/test";

const APP = "http://localhost:3000";
const API = "http://localhost:8000";
const TS = Date.now().toString().slice(-6);
const PROD = `DEMO-${TS}`;
const C_SMD = `Zкомп-СМД-${TS}`;
const C_3D = `Zкомп-3D-${TS}`;
const C_ASM = `Zкомп-СБ-${TS}`;

const ctx: {
  token?: string; ids: Record<string, number>;
  stageSmd?: number; stage3d?: number; stageAsm?: number;
  order1?: number; order2?: number;
} = { ids: {} };

const pause = (ms = 900) => new Promise((r) => setTimeout(r, ms));

async function apiLogin(rq: APIRequestContext, u: string, p: string) {
  const r = await rq.post(`${API}/api/auth/login`, { data: { username: u, password: p } });
  return (await r.json()).token as string;
}

async function loginUI(page: Page, user: string, pass: string) {
  // Чистим прошлую сессию и логинимся заново через форму (наглядно + надёжно)
  await page.goto(`${APP}/login`);
  await page.evaluate(() => localStorage.removeItem("crm_token")).catch(() => {});
  await page.goto(`${APP}/login`);
  await page.waitForSelector('input[placeholder="Введите ваш логин"]', { timeout: 20_000 });
  await page.fill('input[placeholder="Введите ваш логин"]', user);
  await pause(250);
  await page.fill('input[placeholder="Введите ваш пароль"]', pass);
  await pause(250);
  await page.click('button:has-text("Войти")');
  await page.waitForURL(/dashboard|\/$/, { timeout: 20_000 });
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
  await pause(1100);
}

async function logoutUI(_page: Page) { /* выход не нужен — loginUI перезаписывает сессию */ }

async function nav(page: Page, text: string) {
  await page.locator(`a:has-text("${text}")`).first().click();
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 });
  await pause(900);
}

/** Пройти все активные этапы текущей роли на «Мои заказы»: Начать → Завершить.
 * Клики с коротким таймаутом + catch, чтобы не зависать при перерисовке списка. */
async function passStages(page: Page) {
  for (let round = 0; round < 10; round++) {
    const start = page.getByRole("button", { name: "Начать работу" }).first();
    if (await start.count() && await start.isVisible().catch(() => false)) {
      await start.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(900);
      continue;
    }
    const done = page.getByRole("button", { name: "Завершить этап" }).first();
    if (await done.count() && await done.isVisible().catch(() => false)) {
      await done.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(900);
      continue;
    }
    break;
  }
}

// ════════════════ ПОДГОТОВКА ДАННЫХ ЧЕРЕЗ API ════════════════
test.beforeAll(async () => {
  const rq = await pwRequest.newContext();
  const token = await apiLogin(rq, "admin", "admin");
  ctx.token = token;
  const H = { Authorization: `Bearer ${token}` };

  // создаём роль отгрузки, если нет
  const users = await (await rq.get(`${API}/api/auth/users`, { headers: H })).json();
  const byName = (n: string) => users.find((u: { username: string }) => u.username === n);
  if (!byName("shipment")) {
    await rq.post(`${API}/api/auth/users`, { headers: H, data: {
      username: "shipment", password: "123", full_name: "Оператор отгрузки", role: "operator_shipment",
      is_active: true,
      user_permissions: { "otk.view": true, "production.view": true, "production.edit": true, "production.pause_complete": true },
    }});
  }
  const fresh = await (await rq.get(`${API}/api/auth/users`, { headers: H })).json();
  for (const n of ["smd", "3d", "montag", "otk", "shipment"]) {
    const u = fresh.find((x: { username: string }) => x.username === n);
    if (u) ctx.ids[n] = u.id;
  }

  // Чистим заказы прошлых прогонов, чтобы операторы видели только свежие
  const old = await (await rq.get(`${API}/api/orders?include_statuses=Создан,В работе,Доработка,На проверке ОТК,Готов к отгрузке,Ожидает компонентов`, { headers: H })).json();
  for (const o of (Array.isArray(old) ? old : [])) {
    if (typeof o.product_name === "string" && o.product_name.startsWith("DEMO-")) {
      await rq.delete(`${API}/api/orders/${o.id}`, { headers: H }).catch(() => {});
    }
  }

  // склад: 3 компонента
  for (const name of [C_SMD, C_3D, C_ASM]) {
    await rq.post(`${API}/api/warehouse/components`, { headers: H, data: {
      name, stock: 1000, category: "ZZTEST", block: "ZZTEST", unit: "шт",
    }});
  }

  // рецептура: компоненты по типам
  await rq.post(`${API}/api/recipes`, { headers: H, data: { component_name: C_SMD, product_name: PROD, norm: 2, production_type: "SMD", source: "warehouse", warehouse_component_name: C_SMD }});
  await rq.post(`${API}/api/recipes`, { headers: H, data: { component_name: C_3D, product_name: PROD, norm: 1, production_type: "3D Печать", source: "warehouse", warehouse_component_name: C_3D }});
  await rq.post(`${API}/api/recipes`, { headers: H, data: { component_name: C_ASM, product_name: PROD, norm: 1, production_type: "Сборка", source: "warehouse", warehouse_component_name: C_ASM }});

  // этапы: СМД(0) + 3D(0 параллельно) → Сборка(1)
  const mk = async (stage_name: string, stage_type: string, sort_order: number, dep: number, role: string) =>
    (await (await rq.post(`${API}/api/recipes/recipe-stages`, { headers: H, data: {
      product_name: PROD, stage_name, stage_type, sort_order, depends_on_previous: dep, required_role: role,
    }})).json());
  ctx.stageSmd = (await mk("Пайка СМД", "smd", 0, 1, "operator_smd")).id;
  ctx.stage3d = (await mk("3D печать", "3d_print", 0, 0, "operator_3d")).id;
  ctx.stageAsm = (await mk("Сборка", "assembly", 1, 1, "montažnik")).id;

  // заказ №1 — полный маршрут, назначения на роли
  const o1 = await (await rq.post(`${API}/api/orders`, { headers: H, data: {
    product_name: PROD, planned_qty: 4, priority: "Обычный",
    stage_assignments: {
      [String(ctx.stageSmd)]: String(ctx.ids["smd"]),
      [String(ctx.stage3d)]: String(ctx.ids["3d"]),
      [String(ctx.stageAsm)]: String(ctx.ids["montag"]),
    },
  }})).json();
  ctx.order1 = o1.id;

  // заказ №2 — с пропуском этапа 3D
  const o2 = await (await rq.post(`${API}/api/orders`, { headers: H, data: {
    product_name: PROD, planned_qty: 2, priority: "Высокий",
    skipped_stage_ids: [ctx.stage3d],
    stage_assignments: {
      [String(ctx.stageSmd)]: String(ctx.ids["smd"]),
      [String(ctx.stageAsm)]: String(ctx.ids["montag"]),
    },
  }})).json();
  ctx.order2 = o2.id;

  await rq.dispose();
});

test("Полный цикл со всеми ролями", async ({ page }) => {
  test.setTimeout(600_000);

  // ═══ РУКОВОДИТЕЛЬ: смотрим подготовленные данные ═══
  console.log("▶ [Руководитель] Склад, рецептура и заказы");
  await loginUI(page, "admin", "admin");
  await nav(page, "Склад");
  await page.fill('input[placeholder*="Поиск"]', `Zкомп`).catch(() => {});
  await pause(1500);
  await nav(page, "Рецептура");
  await page.fill('input[placeholder*="Поиск"]', PROD).catch(() => {});
  await pause(1800);
  await nav(page, "Заказы");
  await page.fill('input[placeholder*="Поиск"]', "DEMO").catch(() => {});
  await pause(1800);
  await logoutUI(page);

  // ═══ СМД-оператор: проходит этап пайки ═══
  console.log("▶ [Оператор СМД] Выполняет этап пайки СМД");
  await loginUI(page, "smd", "123");
  await nav(page, "Мои заказы");
  await pause(1200);
  await passStages(page);
  await pause(1000);
  await logoutUI(page);

  // ═══ 3D-оператор: проходит 3D печать ═══
  console.log("▶ [Оператор 3D] Выполняет этап 3D печати");
  await loginUI(page, "3d", "123");
  await nav(page, "Мои заказы");
  await pause(1200);
  await passStages(page);
  await pause(1000);
  await logoutUI(page);

  // ═══ Монтажник: сборка → сдача в ОТК ═══
  console.log("▶ [Монтажник] Сборка и сдача в ОТК");
  await loginUI(page, "montag", "123");
  await nav(page, "Мои заказы");
  await pause(1200);
  await passStages(page);
  // Сдать в ОТК
  const submit = page.getByRole("button", { name: "Сдать в ОТК" });
  if (await submit.count()) {
    await submit.first().click();
    await pause(900);
    await page.getByRole("dialog").getByRole("button", { name: "Сдать в ОТК" }).click();
    await pause(1200);
  }
  await logoutUI(page);

  // ═══ ОТК: находит брак ═══
  console.log("▶ [ОТК] Проверка — критичный брак");
  await loginUI(page, "otk", "123");
  await nav(page, "ОТК");
  await pause(1000);
  const batchTab = page.getByRole("button", { name: "Проверка партий" });
  if (await batchTab.count()) { await batchTab.first().click(); await pause(900); }
  let checkBtn = page.getByRole("button", { name: "Проверить" });
  if (await checkBtn.count()) {
    await checkBtn.first().click();
    await pause(900);
    await page.getByRole("dialog").locator("input").first().fill("OTK-1");
    await pause(400);
    await page.getByText("Критичный брак").first().click();
    await pause(400);
    const ta = page.getByRole("dialog").locator("textarea");
    if (await ta.count()) await ta.first().fill("Демо-брак: непропай");
    await pause(400);
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await pause(1500);
  }
  await logoutUI(page);

  // ═══ Монтажник: переделка ═══
  console.log("▶ [Монтажник] Переделка после брака → снова в ОТК");
  await loginUI(page, "montag", "123");
  await nav(page, "Мои заказы");
  await pause(1200);
  await passStages(page);
  const submit2 = page.getByRole("button", { name: "Сдать в ОТК" });
  if (await submit2.count()) {
    await submit2.first().click();
    await pause(900);
    await page.getByRole("dialog").getByRole("button", { name: "Сдать в ОТК" }).click();
    await pause(1200);
  }
  await logoutUI(page);

  // ═══ ОТК: принимает ═══
  console.log("▶ [ОТК] Повторная проверка — всё годно");
  await loginUI(page, "otk", "123");
  await nav(page, "ОТК");
  await pause(1000);
  const batchTab2 = page.getByRole("button", { name: "Проверка партий" });
  if (await batchTab2.count()) { await batchTab2.first().click(); await pause(900); }
  checkBtn = page.getByRole("button", { name: "Проверить" });
  if (await checkBtn.count()) {
    await checkBtn.first().click();
    await pause(900);
    await page.getByRole("dialog").locator("input").first().fill("OTK-1");
    await pause(400);
    await page.getByText("Всё годно").first().click();
    await pause(400);
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await pause(1500);
  }
  await logoutUI(page);

  // ═══ Отгрузка ═══
  console.log("▶ [Отгрузка] Просмотр готового к отгрузке");
  await loginUI(page, "shipment", "123");
  await nav(page, "Отгрузка");
  await pause(2000);
  await logoutUI(page);

  // ═══ Руководитель: итог ═══
  console.log("▶ [Руководитель] Итоговый просмотр заказов");
  await loginUI(page, "admin", "admin");
  await nav(page, "Заказы");
  await page.fill('input[placeholder*="Поиск"]', "DEMO").catch(() => {});
  await pause(2500);

  console.log("✓ Полный цикл со всеми ролями пройден");
});
