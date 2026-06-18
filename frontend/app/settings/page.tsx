"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { useTheme, ACCENT_COLORS, ThemeMode, AccentColor, Density } from "../../lib/theme";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { api } from "../../lib/api";
import { useI18n, LANGS, Lang } from "../../lib/i18n";

// ─── Section wrapper ─────────────────────────────────────────────────────────
function Section({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h2>
        {description && <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--text-muted)" }}>{description}</p>}
      </div>
      <Card>{children}</Card>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────
function Row({ label, description, children }: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16, padding: "12px 0",
      borderBottom: "1px solid var(--border)",
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{description}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ─── Segment control ─────────────────────────────────────────────────────────
function Segment<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; icon?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", background: "var(--bg-tertiary)", borderRadius: 8, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 600, transition: "all 0.15s",
            background: value === o.value ? "var(--bg-secondary)" : "transparent",
            color: value === o.value ? "var(--primary)" : "var(--text-secondary)",
            boxShadow: value === o.value ? "var(--shadow-sm)" : "none",
          }}
        >
          {o.icon && <span style={{ marginRight: 5 }}>{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { mode, accent, density, setMode, setAccent, setDensity } = useTheme();
  const { lang, setLang } = useI18n();

  // Password change form
  const [pwdForm, setPwdForm]     = useState({ old: "", new1: "", new2: "" });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  // Workspace prefs (localStorage only)
  const [refreshInterval, setRefreshInterval] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem("germess_refresh") || "0" : "0"
  );
  const [defaultPriority, setDefaultPriority] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem("germess_priority") || "Обычный" : "Обычный"
  );

  if (loading || !user) return null;

  async function changePassword() {
    if (!pwdForm.old || !pwdForm.new1) { setPwdMsg({ ok: false, text: "Заполните все поля" }); return; }
    if (pwdForm.new1 !== pwdForm.new2)  { setPwdMsg({ ok: false, text: "Пароли не совпадают" }); return; }
    if (pwdForm.new1.length < 6)        { setPwdMsg({ ok: false, text: "Минимум 6 символов" }); return; }
    setPwdSaving(true); setPwdMsg(null);
    try {
      await api.changePassword(pwdForm.old, pwdForm.new1);
      setPwdMsg({ ok: true, text: "Пароль успешно изменён" });
      setPwdForm({ old: "", new1: "", new2: "" });
    } catch (e: unknown) {
      setPwdMsg({ ok: false, text: e instanceof Error ? e.message : "Ошибка" });
    }
    setPwdSaving(false);
  }

  function saveWorkspace() {
    localStorage.setItem("germess_refresh", refreshInterval);
    localStorage.setItem("germess_priority", defaultPriority);
    // Show brief toast-like feedback
    const el = document.getElementById("ws-saved");
    if (el) { el.style.opacity = "1"; setTimeout(() => { el.style.opacity = "0"; }, 2000); }
  }

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 720 }}>

        <div>
          <h1 style={{ margin: 0 }}>Настройки</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            Персонализация интерфейса и параметры аккаунта
          </p>
        </div>

        {/* ── Разделы настроек (хаб) ────────────────────────────────────────── */}
        {(user.role === "admin" || user.role === "manager") && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {[
              { href: "/settings/system", icon: "⚙️", title: "Система", desc: "Этапы, роли, статусы, приоритеты, SLA", show: true },
              { href: "/settings/fields", icon: "🏷️", title: "Кастомные поля", desc: "Доп. поля заказов", show: true },
              { href: "/catalog", icon: "📦", title: "Каталог изделий", desc: "Справочник продукции", show: true },
              { href: "/users", icon: "👥", title: "Пользователи", desc: "Учётные записи и роли", show: user.role === "admin" },
              { href: "/admin", icon: "🛠️", title: "Администрирование", desc: "Операторы, смены, задачи", show: user.role === "admin" },
              { href: "/settings/integrations", icon: "🔗", title: "Интеграции", desc: "Webhooks и подписки на уведомления", show: user.role === "admin" },
              { href: "/settings/backup", icon: "💾", title: "Резервная копия", desc: "Экспорт/импорт конфигурации", show: user.role === "admin" },
            ].filter(c => c.show).map(c => (
              <button
                key={c.href}
                onClick={() => router.push(c.href)}
                style={{
                  textAlign: "left", cursor: "pointer", padding: 16, borderRadius: 12,
                  border: "1px solid var(--border)", background: "var(--bg-secondary)",
                  display: "flex", flexDirection: "column", gap: 6, transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--primary)"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{ fontSize: 22 }}>{c.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.desc}</div>
              </button>
            ))}
          </div>
        )}

        {/* ── Внешний вид ──────────────────────────────────────────────────── */}
        <Section title="Внешний вид" description="Тема, цвет, плотность и язык интерфейса">

          {/* Language */}
          <Row label="Язык интерфейса" description="Русский · English · Қазақша">
            <Segment<Lang>
              value={lang}
              onChange={setLang}
              options={LANGS.map(l => ({ value: l.code, label: l.label, icon: l.flag }))}
            />
          </Row>

          {/* Theme */}
          <Row label="Тема" description="Светлая, тёмная или как в системе">
            <Segment<ThemeMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "light",  label: "Светлая", icon: "☀️" },
                { value: "dark",   label: "Тёмная",  icon: "🌙" },
                { value: "system", label: "Системная", icon: "💻" },
              ]}
            />
          </Row>

          {/* Accent color */}
          <Row label="Акцентный цвет" description="Основной цвет кнопок и элементов">
            <div style={{ display: "flex", gap: 8 }}>
              {(Object.entries(ACCENT_COLORS) as [AccentColor, typeof ACCENT_COLORS[AccentColor]][]).map(([key, c]) => (
                <button
                  key={key}
                  title={c.label}
                  onClick={() => setAccent(key)}
                  style={{
                    width: 28, height: 28, borderRadius: "50%", border: "none",
                    background: c.primary, cursor: "pointer", transition: "transform 0.1s",
                    outline: accent === key ? `3px solid ${c.primary}` : "3px solid transparent",
                    outlineOffset: 2,
                    transform: accent === key ? "scale(1.15)" : "scale(1)",
                  }}
                />
              ))}
            </div>
          </Row>

          {/* Density */}
          <div style={{ padding: "12px 0" }}>
            <Row label="Плотность интерфейса" description="Размер полей ввода и отступы">
              <Segment<Density>
                value={density}
                onChange={setDensity}
                options={[
                  { value: "normal",  label: "Обычная" },
                  { value: "compact", label: "Компактная" },
                ]}
              />
            </Row>
          </div>
        </Section>

        {/* ── Профиль ──────────────────────────────────────────────────────── */}
        <Section title="Профиль" description="Информация об аккаунте">

          {/* User info */}
          <div style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "linear-gradient(135deg, var(--primary), #a78bfa)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontSize: 18, fontWeight: 700, flexShrink: 0,
              }}>
                {(user.full_name || user.username || "?").split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{user.full_name || user.username}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{user.username} · {user.role}</div>
                {user.email && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{user.email}</div>}
              </div>
            </div>
          </div>

          {/* Change password */}
          <div style={{ paddingTop: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Изменить пароль</div>
            {pwdMsg && (
              <div style={{
                padding: "8px 12px", borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 500,
                background: pwdMsg.ok ? "#10b98115" : "#ef444415",
                color: pwdMsg.ok ? "#10b981" : "#ef4444",
                border: `1px solid ${pwdMsg.ok ? "#10b98130" : "#ef444430"}`,
              }}>{pwdMsg.text}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 380 }}>
              <div>
                <label>Текущий пароль</label>
                <input type="password" value={pwdForm.old}
                  onChange={e => setPwdForm(f => ({ ...f, old: e.target.value }))}
                  placeholder="••••••••" />
              </div>
              <div>
                <label>Новый пароль</label>
                <input type="password" value={pwdForm.new1}
                  onChange={e => setPwdForm(f => ({ ...f, new1: e.target.value }))}
                  placeholder="Минимум 6 символов" />
              </div>
              <div>
                <label>Повторите новый пароль</label>
                <input type="password" value={pwdForm.new2}
                  onChange={e => setPwdForm(f => ({ ...f, new2: e.target.value }))}
                  placeholder="••••••••"
                  style={{ borderColor: pwdForm.new2 && pwdForm.new1 !== pwdForm.new2 ? "#ef4444" : "" }} />
              </div>
              <div>
                <Button onClick={changePassword} loading={pwdSaving} size="sm">
                  Сохранить пароль
                </Button>
              </div>
            </div>
          </div>
        </Section>

        {/* ── Рабочее место ────────────────────────────────────────────────── */}
        <Section title="Рабочее место" description="Параметры работы с системой">

          <Row label="Авто-обновление" description="Автоматически обновлять данные">
            <select
              value={refreshInterval}
              onChange={e => setRefreshInterval(e.target.value)}
              style={{ width: 160 }}
            >
              <option value="0">Выключено</option>
              <option value="30">Каждые 30 сек</option>
              <option value="60">Каждую минуту</option>
              <option value="300">Каждые 5 минут</option>
            </select>
          </Row>

          <div style={{ padding: "12px 0" }}>
            <Row label="Приоритет заказа по умолчанию" description="При создании нового заказа">
              <select
                value={defaultPriority}
                onChange={e => setDefaultPriority(e.target.value)}
                style={{ width: 160 }}
              >
                {["Обычный", "Низкий", "Высокий", "Срочный"].map(p => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Row>
          </div>

          <div style={{ paddingTop: 8, display: "flex", alignItems: "center", gap: 12 }}>
            <Button size="sm" onClick={saveWorkspace}>Сохранить</Button>
            <span id="ws-saved" style={{ fontSize: 13, color: "#10b981", opacity: 0, transition: "opacity 0.3s" }}>
              ✓ Сохранено
            </span>
          </div>
        </Section>

        {/* ── О системе ────────────────────────────────────────────────────── */}
        <Section title="О системе">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            {[
              ["Система",  "CRM B3 Производства"],
              ["Версия",   "1.0.0"],
              ["Окружение", process.env.NODE_ENV],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)" }}>{k}</span>
                <span style={{ fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
        </Section>

      </div>
    </AppLayout>
  );
}
