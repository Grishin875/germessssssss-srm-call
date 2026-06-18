"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Lang = "ru" | "en" | "kz";
export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "ru", label: "Русский", flag: "🇷🇺" },
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "kz", label: "Қазақша", flag: "🇰🇿" },
];

// Словари. ru — базовый (fallback). Ключи — стабильные идентификаторы.
const DICT: Record<Lang, Record<string, string>> = {
  ru: {
    "nav.dashboard": "Дашборд", "nav.orders": "Заказы", "nav.my_tasks": "Мои задачи",
    "nav.production": "Производство", "nav.otk": "ОТК", "nav.shipment": "Отгрузка",
    "nav.warehouse": "Склад", "nav.recipes": "Рецептура", "nav.catalog": "Каталог изделий",
    "nav.documents": "Документы", "nav.reports": "Отчёты", "nav.archive": "Архив",
    "nav.users": "Пользователи", "nav.settings": "Настройки", "nav.settings_system": "Настройки системы",
    "nav.admin": "Администрирование",
    "common.create": "Создать", "common.save": "Сохранить", "common.cancel": "Отмена",
    "common.delete": "Удалить", "common.edit": "Изменить", "common.search": "Поиск",
    "common.export": "Экспорт", "common.import": "Импорт", "common.loading": "Загрузка…",
    "common.no_data": "Нет данных", "common.apply": "Применить", "common.close": "Закрыть",
    "settings.language": "Язык интерфейса", "settings.appearance": "Внешний вид",
    "settings.theme": "Тема", "settings.density": "Плотность интерфейса",
    // login
    "login.title": "Вход в систему", "login.subtitle": "CRM управления производством",
    "login.username": "Логин", "login.password": "Пароль", "login.submit": "Войти",
    "login.error": "Неверный логин или пароль",
    // common actions/buttons
    "common.add": "Добавить", "common.open": "Открыть", "common.back": "Назад",
    "common.send": "Отправить", "common.confirm": "Подтвердить", "common.reset": "Сброс",
    "common.refresh": "Обновить", "common.all": "Все", "common.yes": "Да", "common.no": "Нет",
    "common.actions": "Действия", "common.status": "Статус", "common.priority": "Приоритет",
    "common.qty": "Количество", "common.deadline": "Срок", "common.department": "Отдел",
    "common.operator": "Оператор", "common.created": "Создан", "common.comment": "Комментарий",
    "common.product": "Изделие", "common.template": "Шаблон", "common.found": "Найдено",
    // orders
    "orders.title": "Заказы на производство", "orders.create": "Создать заказ",
    "orders.search_ph": "Поиск по изделию или ID...", "orders.all_active": "Все активные",
    "orders.view_table": "Таблица", "orders.view_kanban": "Канбан", "orders.view_calendar": "Календарь",
    "orders.import": "Импорт Excel", "orders.columns": "Колонки", "orders.archive": "Архив",
    "orders.all_depts": "Все отделы", "orders.all_ops": "Все операторы", "orders.tags": "Метки",
    "orders.progress": "Прогресс", "orders.not_found": "Заказы не найдены",
    "orders.selected": "Выбрано", "orders.cancel_sel": "Отменить", "orders.group_by": "Группировка",
    "orders.save_filter": "Сохранить", "orders.fav": "Избранное",
    // dashboard
    "dash.welcome": "Добро пожаловать", "dash.new_orders": "Новые заказы", "dash.in_work": "В работе",
    "dash.paused": "На паузе", "dash.on_otk": "На ОТК", "dash.analytics": "Аналитика производства",
    "dash.online": "Онлайн", "dash.tasks": "Общие задачи", "dash.prod_tasks": "Производственные задачи",
    "dash.no_orders": "Нет активных заказов", "dash.no_tasks": "Нет задач", "dash.new_task": "Новая задача...",
    // my-tasks
    "mytasks.title": "Мои задачи", "mytasks.start": "Начать", "mytasks.complete": "Завершить",
    "mytasks.empty": "Нет назначенных задач", "mytasks.pending": "Ожидают", "mytasks.active": "В работе", "mytasks.done": "Выполнено",
    // statuses (для отображения)
    "status.Создан": "Создан", "status.В работе": "В работе", "status.На проверке ОТК": "На проверке ОТК",
    "status.Доработка": "Доработка", "status.Ожидает компонентов": "Ожидает компонентов",
    "status.Готов к отгрузке": "Готов к отгрузке", "status.Завершен": "Завершён", "status.Отменен": "Отменён",
    // priorities
    "prio.Срочный": "Срочный", "prio.Высокий": "Высокий", "prio.Обычный": "Обычный", "prio.Низкий": "Низкий",
  },
  en: {
    "nav.dashboard": "Dashboard", "nav.orders": "Orders", "nav.my_tasks": "My tasks",
    "nav.production": "Production", "nav.otk": "QC", "nav.shipment": "Shipment",
    "nav.warehouse": "Warehouse", "nav.recipes": "Recipes", "nav.catalog": "Product catalog",
    "nav.documents": "Documents", "nav.reports": "Reports", "nav.archive": "Archive",
    "nav.users": "Users", "nav.settings": "Settings", "nav.settings_system": "System settings",
    "nav.admin": "Administration",
    "common.create": "Create", "common.save": "Save", "common.cancel": "Cancel",
    "common.delete": "Delete", "common.edit": "Edit", "common.search": "Search",
    "common.export": "Export", "common.import": "Import", "common.loading": "Loading…",
    "common.no_data": "No data", "common.apply": "Apply", "common.close": "Close",
    "settings.language": "Interface language", "settings.appearance": "Appearance",
    "settings.theme": "Theme", "settings.density": "Interface density",
    "login.title": "Sign in", "login.subtitle": "Production management CRM",
    "login.username": "Username", "login.password": "Password", "login.submit": "Sign in",
    "login.error": "Invalid username or password",
    "common.add": "Add", "common.open": "Open", "common.back": "Back",
    "common.send": "Send", "common.confirm": "Confirm", "common.reset": "Reset",
    "common.refresh": "Refresh", "common.all": "All", "common.yes": "Yes", "common.no": "No",
    "common.actions": "Actions", "common.status": "Status", "common.priority": "Priority",
    "common.qty": "Quantity", "common.deadline": "Deadline", "common.department": "Department",
    "common.operator": "Operator", "common.created": "Created", "common.comment": "Comment",
    "common.product": "Product", "common.template": "Template", "common.found": "Found",
    "orders.title": "Production orders", "orders.create": "Create order",
    "orders.search_ph": "Search by product or ID...", "orders.all_active": "All active",
    "orders.view_table": "Table", "orders.view_kanban": "Kanban", "orders.view_calendar": "Calendar",
    "orders.import": "Import Excel", "orders.columns": "Columns", "orders.archive": "Archive",
    "orders.all_depts": "All departments", "orders.all_ops": "All operators", "orders.tags": "Tags",
    "orders.progress": "Progress", "orders.not_found": "No orders found",
    "orders.selected": "Selected", "orders.cancel_sel": "Cancel", "orders.group_by": "Group by",
    "orders.save_filter": "Save", "orders.fav": "Favorites",
    "dash.welcome": "Welcome", "dash.new_orders": "New orders", "dash.in_work": "In progress",
    "dash.paused": "Paused", "dash.on_otk": "In QC", "dash.analytics": "Production analytics",
    "dash.online": "Online", "dash.tasks": "General tasks", "dash.prod_tasks": "Production tasks",
    "dash.no_orders": "No active orders", "dash.no_tasks": "No tasks", "dash.new_task": "New task...",
    "mytasks.title": "My tasks", "mytasks.start": "Start", "mytasks.complete": "Complete",
    "mytasks.empty": "No assigned tasks", "mytasks.pending": "Pending", "mytasks.active": "In progress", "mytasks.done": "Done",
    "status.Создан": "Created", "status.В работе": "In progress", "status.На проверке ОТК": "In QC",
    "status.Доработка": "Rework", "status.Ожидает компонентов": "Awaiting parts",
    "status.Готов к отгрузке": "Ready to ship", "status.Завершен": "Completed", "status.Отменен": "Cancelled",
    "prio.Срочный": "Urgent", "prio.Высокий": "High", "prio.Обычный": "Normal", "prio.Низкий": "Low",
  },
  kz: {
    "nav.dashboard": "Бақылау тақтасы", "nav.orders": "Тапсырыстар", "nav.my_tasks": "Менің тапсырмаларым",
    "nav.production": "Өндіріс", "nav.otk": "ТБ", "nav.shipment": "Жөнелту",
    "nav.warehouse": "Қойма", "nav.recipes": "Рецептура", "nav.catalog": "Өнім каталогы",
    "nav.documents": "Құжаттар", "nav.reports": "Есептер", "nav.archive": "Мұрағат",
    "nav.users": "Пайдаланушылар", "nav.settings": "Параметрлер", "nav.settings_system": "Жүйе параметрлері",
    "nav.admin": "Әкімшілік",
    "common.create": "Құру", "common.save": "Сақтау", "common.cancel": "Болдырмау",
    "common.delete": "Жою", "common.edit": "Өзгерту", "common.search": "Іздеу",
    "common.export": "Экспорт", "common.import": "Импорт", "common.loading": "Жүктелуде…",
    "common.no_data": "Деректер жоқ", "common.apply": "Қолдану", "common.close": "Жабу",
    "settings.language": "Интерфейс тілі", "settings.appearance": "Сыртқы түрі",
    "settings.theme": "Тақырып", "settings.density": "Интерфейс тығыздығы",
    "login.title": "Жүйеге кіру", "login.subtitle": "Өндірісті басқару CRM",
    "login.username": "Логин", "login.password": "Құпиясөз", "login.submit": "Кіру",
    "login.error": "Қате логин немесе құпиясөз",
    "common.add": "Қосу", "common.open": "Ашу", "common.back": "Артқа",
    "common.send": "Жіберу", "common.confirm": "Растау", "common.reset": "Тазалау",
    "common.refresh": "Жаңарту", "common.all": "Барлығы", "common.yes": "Иә", "common.no": "Жоқ",
    "common.actions": "Әрекеттер", "common.status": "Күйі", "common.priority": "Маңыздылық",
    "common.qty": "Саны", "common.deadline": "Мерзім", "common.department": "Бөлім",
    "common.operator": "Оператор", "common.created": "Жасалды", "common.comment": "Түсініктеме",
    "common.product": "Өнім", "common.template": "Үлгі", "common.found": "Табылды",
    "orders.title": "Өндіріс тапсырыстары", "orders.create": "Тапсырыс құру",
    "orders.search_ph": "Өнім немесе ID бойынша іздеу...", "orders.all_active": "Барлық белсенді",
    "orders.view_table": "Кесте", "orders.view_kanban": "Канбан", "orders.view_calendar": "Күнтізбе",
    "orders.import": "Excel импорты", "orders.columns": "Бағандар", "orders.archive": "Мұрағат",
    "orders.all_depts": "Барлық бөлімдер", "orders.all_ops": "Барлық операторлар", "orders.tags": "Белгілер",
    "orders.progress": "Орындалуы", "orders.not_found": "Тапсырыстар табылмады",
    "orders.selected": "Таңдалды", "orders.cancel_sel": "Болдырмау", "orders.group_by": "Топтау",
    "orders.save_filter": "Сақтау", "orders.fav": "Таңдаулылар",
    "dash.welcome": "Қош келдіңіз", "dash.new_orders": "Жаңа тапсырыстар", "dash.in_work": "Жұмыста",
    "dash.paused": "Кідіртілген", "dash.on_otk": "ТБ-да", "dash.analytics": "Өндіріс аналитикасы",
    "dash.online": "Желіде", "dash.tasks": "Жалпы тапсырмалар", "dash.prod_tasks": "Өндіріс тапсырмалары",
    "dash.no_orders": "Белсенді тапсырыстар жоқ", "dash.no_tasks": "Тапсырмалар жоқ", "dash.new_task": "Жаңа тапсырма...",
    "mytasks.title": "Менің тапсырмаларым", "mytasks.start": "Бастау", "mytasks.complete": "Аяқтау",
    "mytasks.empty": "Тағайындалған тапсырмалар жоқ", "mytasks.pending": "Күтуде", "mytasks.active": "Жұмыста", "mytasks.done": "Орындалды",
    "status.Создан": "Жасалды", "status.В работе": "Жұмыста", "status.На проверке ОТК": "ТБ тексеруінде",
    "status.Доработка": "Пысықтау", "status.Ожидает компонентов": "Компоненттерді күтуде",
    "status.Готов к отгрузке": "Жөнелтуге дайын", "status.Завершен": "Аяқталды", "status.Отменен": "Болдырылмады",
    "prio.Срочный": "Шұғыл", "prio.Высокий": "Жоғары", "prio.Обычный": "Қалыпты", "prio.Низкий": "Төмен",
  },
};

interface I18nCtx { lang: Lang; setLang: (l: Lang) => void; t: (key: string, fallback?: string) => string; }
const Ctx = createContext<I18nCtx>({ lang: "ru", setLang: () => {}, t: (k, f) => f ?? k });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ru");
  useEffect(() => {
    const saved = (typeof window !== "undefined" ? localStorage.getItem("germess_lang") : null) as Lang | null;
    if (saved && DICT[saved]) setLangState(saved);
  }, []);
  const setLang = useCallback((l: Lang) => { setLangState(l); localStorage.setItem("germess_lang", l); document.documentElement.setAttribute("lang", l); }, []);
  const t = useCallback((key: string, fallback?: string) => DICT[lang][key] ?? DICT.ru[key] ?? fallback ?? key, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n() { return useContext(Ctx); }
