"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { useTheme } from "../../lib/theme";
import { useI18n } from "../../lib/i18n";
import { PRODUCTION_ROLES, DEPT_PAGE, ROLE_LABELS } from "../../lib/roles";

// Сопоставление href → ключ перевода для пунктов меню
const NAV_KEY: Record<string, string> = {
  "/dashboard": "nav.dashboard", "/orders": "nav.orders", "/my-tasks": "nav.my_tasks",
  "/production": "nav.production", "/otk": "nav.otk", "/shipment": "nav.shipment",
  "/warehouse": "nav.warehouse", "/recipes": "nav.recipes", "/catalog": "nav.catalog",
  "/documents": "nav.documents", "/reports": "nav.reports", "/archive": "nav.archive",
  "/users": "nav.users", "/settings": "nav.settings", "/settings/system": "nav.settings_system",
  "/admin": "nav.admin",
};

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  perm?: string;
  role?: string;
  group?: string; // section header above this item
}

const Icon = ({ d, d2 }: { d: string; d2?: string }) => (
  <svg
    style={{ width: 17, height: 17, flexShrink: 0 }}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    {d2 && <path strokeLinecap="round" strokeLinejoin="round" d={d2} />}
  </svg>
);

const NAV: NavItem[] = [
  // ── Главная ──────────────────────────────────────────────────────────────
  {
    href: "/dashboard",
    label: "Главная",
    icon: <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  },
  {
    href: "/my-tasks",
    label: "Мои заказы",
    icon: <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
  },
  {
    href: "/chat",
    label: "Чат",
    icon: <Icon d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
  },
  // ── Склад ────────────────────────────────────────────────────────────────
  {
    href: "/warehouse",
    label: "Склад",
    group: "Склад",
    icon: <Icon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
    perm: "warehouse.view",
  },
  {
    href: "/production-stock",
    label: "Запасы производства",
    icon: <Icon d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />,
    perm: "warehouse.view",
  },
  {
    href: "/reserve",
    label: "Резерв по спецификации",
    icon: <Icon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    perm: "warehouse.view",
  },
  {
    href: "/procurement",
    label: "Закупка",
    icon: <Icon d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />,
    perm: "warehouse.view",
  },
  // ── Производство ─────────────────────────────────────────────────────────
  {
    href: "/catalog",
    label: "Каталог изделий",
    group: "Производство",
    icon: <Icon d="M19 11H7m12 0a9 9 0 11-18 0 9 9 0 0118 0zm-9-4v8m-4-4h8" />,
    perm: "recipes.view",
  },
  {
    href: "/recipes",
    label: "Рецептура",
    group: "Производство",
    icon: <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />,
    perm: "recipes.view",
  },
  {
    href: "/orders",
    label: "Заказы",
    icon: <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />,
    perm: "orders.view",
  },
  {
    href: "/production",
    label: "Производство",
    icon: <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" d2="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
    perm: "production.view",
  },
  // ── Отделы ───────────────────────────────────────────────────────────────
  {
    href: "/smd",
    label: "СМД",
    group: "Отделы",
    icon: <Icon d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />,
    perm: "production.view",
  },
  {
    href: "/assembly",
    label: "Монтаж",
    icon: <Icon d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />,
    perm: "production.view",
  },
  {
    href: "/3d-print",
    label: "3D Печать",
    icon: <Icon d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" d2="M9 12h6m-3-3v6" />,
    perm: "production.view",
  },
  // ── Качество & Отгрузка ──────────────────────────────────────────────────
  {
    href: "/otk",
    label: "ОТК",
    group: "Качество",
    icon: <Icon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    perm: "otk.view",
  },
  {
    href: "/shipment",
    label: "Отгрузка",
    icon: <Icon d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />,
    perm: "otk.view",
  },
  {
    href: "/sc",
    label: "Сервис-центр",
    icon: <Icon d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />,
    perm: "sc.view",
  },
  // ── Общее ─────────────────────────────────────────────────────────────────
  {
    href: "/training",
    label: "Учебный центр",
    group: "Общее",
    icon: <Icon d="M12 14l9-5-9-5-9 5 9 5z" d2="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />,
  },
  {
    href: "/shift-schedule",
    label: "График смен",
    icon: <Icon d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
    perm: "shift_schedule.view",
  },
  {
    href: "/archive",
    label: "Архив",
    icon: <Icon d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />,
    perm: "archive.view",
  },
  {
    href: "/documents",
    label: "Документы",
    icon: <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  },
  {
    href: "/reports",
    label: "Отчёты",
    icon: <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
    perm: "orders.view",
  },
  // ── Администрация ─────────────────────────────────────────────────────────
  {
    href: "/settings/system",
    label: "Настройки системы",
    icon: <Icon d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />,
    role: "admin",
    group: "Администрация",
  },
  {
    href: "/admin",
    label: "Администрирование",
    icon: <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" d2="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
    role: "admin",
    group: "Администрация",
  },
  {
    href: "/users",
    label: "Пользователи",
    icon: <Icon d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />,
    role: "admin",
  },
  {
    href: "/settings",
    label: "Настройки",
    icon: <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" d2="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
  },
];

export function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { user, hasPermission, logout, isProductionRole } = useAuth();
  const { isDark, setMode } = useTheme();

  const visible = NAV.filter((item) => {
    // Чат доступен всем авторизованным независимо от роли
    if (item.href === "/chat") return true;
    if (item.role && user?.role !== item.role) return false;
    // Производственные роли видят Главную, Мои заказы и страницу своего отдела
    if (isProductionRole) {
      const allowed = ["/dashboard", "/my-tasks"];
      const dept = DEPT_PAGE[user?.role ?? ""];
      if (dept) allowed.push(dept);
      if (!allowed.includes(item.href)) return false;
    }
    // ОТК-оператор видит Главную и ОТК
    if (user?.role === "operator_otk" && item.href !== "/dashboard" && item.href !== "/otk") return false;
    // Оператор отгрузки видит Главную и Отгрузку
    if (user?.role === "operator_shipment" && item.href !== "/dashboard" && item.href !== "/shipment") return false;
    if (item.perm && !hasPermission(item.perm)) return false;
    return true;
  });

  const initials = (user?.full_name || user?.username || "?")
    .split(" ")
    .map((w: string) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const [taskCount, setTaskCount] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    if (!user || !(PRODUCTION_ROLES as readonly string[]).includes(user.role)) return;
    import("../../lib/api").then(({ api }) => {
      api.getMyOrders().then(orders => {
        const count = orders.reduce((s: number, o: {my_stages?: {status: string}[]}) =>
          s + (o.my_stages || []).filter((st: {status: string}) => st.status === "pending" || st.status === "in_progress").length, 0
        );
        setTaskCount(count);
      }).catch(console.error);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const tick = () => import("../../lib/api").then(({ api }) =>
      api.getChatUnread().then(r => { if (alive) setChatUnread(r.unread); }).catch(() => {})
    );
    tick();
    const t = setInterval(tick, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  return (
    <aside
      className={"sidebar" + (mobileOpen ? " sidebar-open" : "")}
      style={{
        width: 248,
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--sidebar-bg)",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "20px 20px 18px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          position: "relative",
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: "linear-gradient(135deg, #6366f1, #a78bfa)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
            letterSpacing: "0.02em",
            fontFamily: "var(--font-display)",
            boxShadow: "0 6px 18px -4px rgba(99,102,241,0.7)",
          }}
        >
          B3
        </div>
        <div>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 14.5, lineHeight: 1.2, letterSpacing: "0.01em", fontFamily: "var(--font-display)" }}>
            CRM B3
          </div>
          <div style={{ color: "var(--sidebar-text)", fontSize: 10, marginTop: 3, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            Производство
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {visible.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <React.Fragment key={item.href}>
              {item.group && (
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 1.4,
                  textTransform: "uppercase", color: "var(--sidebar-text)",
                  opacity: 0.4, padding: "14px 12px 5px",
                }}>
                  {item.group}
                </div>
              )}
            <Link
              href={item.href}
              onClick={() => onClose?.()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 11px",
                borderRadius: 11,
                fontSize: 13.5,
                fontWeight: active ? 600 : 450,
                color: active ? "#fff" : "var(--sidebar-text)",
                background: active
                  ? "linear-gradient(135deg, rgba(99,102,241,0.95), rgba(139,92,246,0.75))"
                  : "transparent",
                textDecoration: "none",
                transition: "background 0.18s ease, color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease",
                boxShadow: active ? "0 6px 18px -6px rgba(99,102,241,0.7)" : "none",
                position: "relative",
              }}
              onMouseEnter={(e) => {
                const t = e.currentTarget as HTMLElement;
                if (!active) { t.style.background = "rgba(255,255,255,0.06)"; t.style.transform = "translateX(3px)"; t.style.color = "rgba(255,255,255,0.92)"; }
              }}
              onMouseLeave={(e) => {
                const t = e.currentTarget as HTMLElement;
                if (!active) { t.style.background = "transparent"; t.style.transform = ""; t.style.color = "var(--sidebar-text)"; }
              }}
            >
              <span style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                background: active ? "rgba(255,255,255,0.18)" : "transparent",
                opacity: active ? 1 : 0.7, transition: "background 0.18s",
              }}>
                {item.icon}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {NAV_KEY[item.href] ? t(NAV_KEY[item.href], item.label) : item.label}
              </span>
              {item.href === "/my-tasks" && taskCount > 0 && (
                <span className="glow-pulse" style={{
                  marginLeft: "auto",
                  minWidth: 19, height: 19,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 10, background: active ? "rgba(255,255,255,0.25)" : "linear-gradient(135deg, #6366f1, #818cf8)",
                  color: "#fff", fontSize: 10, fontWeight: 700, padding: "0 5px",
                  boxShadow: "0 2px 8px -2px rgba(99,102,241,0.8)",
                }}>{taskCount}</span>
              )}
              {item.href === "/chat" && chatUnread > 0 && (
                <span className="glow-pulse" style={{
                  marginLeft: "auto",
                  minWidth: 19, height: 19,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: 10, background: active ? "rgba(255,255,255,0.25)" : "linear-gradient(135deg, #6366f1, #818cf8)",
                  color: "#fff", fontSize: 10, fontWeight: 700, padding: "0 5px",
                  boxShadow: "0 2px 8px -2px rgba(99,102,241,0.8)",
                }}>{chatUnread > 99 ? "99+" : chatUnread}</span>
              )}
            </Link>
            </React.Fragment>
          );
        })}
      </nav>

      {/* User */}
      <div
        style={{
          padding: "12px 10px",
          borderTop: "1px solid var(--sidebar-border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #6366f1, #a78bfa)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: "0 4px 12px -3px rgba(99,102,241,0.6)",
            }}
          >
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: 1.3,
              }}
            >
              {user?.full_name || user?.username}
            </div>
            <div
              style={{
                color: "var(--sidebar-text)",
                fontSize: 11,
                marginTop: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
            </div>
          </div>
          {/* Quick theme toggle */}
          <button
            onClick={() => setMode(isDark ? "light" : "dark")}
            title={isDark ? "Светлая тема" : "Тёмная тема"}
            style={{
              flexShrink: 0, background: "none", border: "none", cursor: "pointer",
              color: "var(--sidebar-text)", display: "flex", alignItems: "center",
              padding: 4, borderRadius: 5, transition: "color 0.12s", fontSize: 14,
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#fff")}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "var(--sidebar-text)")}
          >
            {isDark ? "☀️" : "🌙"}
          </button>
          <button
            onClick={logout}
            title="Выйти"
            style={{
              flexShrink: 0,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--sidebar-text)",
              display: "flex",
              alignItems: "center",
              padding: 4,
              borderRadius: 5,
              transition: "color 0.12s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.color = "#ef4444")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.color = "var(--sidebar-text)")
            }
          >
            <svg
              style={{ width: 15, height: 15 }}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
