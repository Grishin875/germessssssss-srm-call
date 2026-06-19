"use client";
import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n";

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [username, setUsername]       = useState("");
  const [password, setPassword]       = useState("");
  const [error, setError]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Введите логин и пароль");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      router.replace("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Неверный логин или пароль");
    } finally {
      setLoading(false);
    }
  }

  const FEATURES = [
    { label: "Заказы",       desc: "Создание и контроль", path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { label: "Производство", desc: "Партии и операторы",  path: "M13 10V3L4 14h7v7l9-11h-7z" },
    { label: "Склад",        desc: "Учёт компонентов",    path: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
    { label: "ОТК",          desc: "Контроль качества",   path: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  ];

  const inputStyle: React.CSSProperties = {
    height: 44, fontSize: 14.5, borderRadius: 9,
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--bg)" }}>
      {/* ── Левая панель — брендинг (плотный графит, без свечений) ─────── */}
      <div
        className="hidden lg:flex"
        style={{ width: "44%", flexShrink: 0, flexDirection: "column", padding: "48px 56px", background: "var(--sidebar-bg)", color: "#fff" }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 72 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 9, background: "var(--primary)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 14, letterSpacing: "0.01em", flexShrink: 0,
          }}>B3</div>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 16.5, letterSpacing: "0.01em", fontFamily: "var(--font-display)" }}>CRM B3 · Производство</span>
        </div>

        {/* Heading */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start", padding: "5px 12px", borderRadius: 7, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 24 }}>
            <span className="live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>Система онлайн</span>
          </div>
          <h2 style={{
            fontSize: 32, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.02em", marginBottom: 18,
            fontFamily: "var(--font-display)", color: "#fff",
          }}>
            Управление<br />производством
          </h2>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "rgba(255,255,255,0.55)", maxWidth: 380, marginBottom: 44 }}>
            Единая система для контроля заказов, производства, склада и качества — в реальном времени.
          </p>

          {/* Feature list */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 480 }}>
            {FEATURES.map((f) => (
              <div
                key={f.label}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10, padding: "14px 16px",
                  display: "flex", alignItems: "center", gap: 12,
                }}
              >
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg style={{ width: 17, height: 17, color: "#a9b6ff" }} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={f.path} />
                  </svg>
                </div>
                <div>
                  <div style={{ color: "#fff", fontWeight: 600, fontSize: 13.5, lineHeight: 1.3 }}>{f.label}</div>
                  <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 2 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginTop: 40 }}>© 2026 CRM B3 Производства</p>
      </div>

      {/* ── Правая панель — форма ─────────────────────── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
        <div
          className="glass animate-fadeIn"
          style={{ width: "100%", maxWidth: 408, borderRadius: 14, padding: "36px 34px", boxShadow: "var(--shadow-lg)" }}
        >
          {/* Mobile logo */}
          <div className="lg:hidden" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26 }}>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 14 }}>B3</div>
            <span style={{ fontWeight: 600, fontSize: 17, color: "var(--text)" }}>CRM B3</span>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 26 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)", lineHeight: 1.2, marginBottom: 7, fontFamily: "var(--font-display)" }}>
              {t("login.title")}
            </h1>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {t("login.subtitle")}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label htmlFor="username" style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 7 }}>{t("login.username")}</label>
              <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoFocus placeholder={t("login.username")}
                style={inputStyle} />
            </div>

            <div>
              <label htmlFor="password" style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 7 }}>{t("login.password")}</label>
              <div style={{ position: "relative" }}>
                <input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" placeholder={t("login.password")}
                  style={{ ...inputStyle, paddingRight: 44 }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", padding: 2 }}>
                  {showPassword ? (
                    <svg style={{ width: 17, height: 17 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg style={{ width: 17, height: 17 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderRadius: 9, background: "var(--danger-light)", border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", color: "var(--danger)", fontSize: 13 }}>
                <svg style={{ width: 15, height: 15, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn-base"
              data-variant="primary"
              style={{
                height: 44, borderRadius: 9,
                background: "var(--primary)", color: "#fff",
                fontSize: 14.5, fontWeight: 600, border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                boxShadow: "var(--shadow-sm)",
                fontFamily: "inherit", letterSpacing: "-0.005em", marginTop: 4,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading && (
                <svg style={{ width: 16, height: 16, animation: "spin 0.7s linear infinite" }} viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                  <path fill="currentColor" fillOpacity="0.9" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {loading ? "…" : t("login.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
