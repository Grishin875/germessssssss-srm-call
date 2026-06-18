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
    { label: "Заказы",       desc: "Создание и контроль", color: "#6366f1", path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { label: "Производство", desc: "Партии и операторы",  color: "#8b5cf6", path: "M13 10V3L4 14h7v7l9-11h-7z" },
    { label: "Склад",        desc: "Учёт компонентов",    color: "#0ea5e9", path: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
    { label: "ОТК",          desc: "Контроль качества",   color: "#10b981", path: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  ];

  const inputStyle: React.CSSProperties = {
    height: 46, fontSize: 14, paddingLeft: 14, paddingRight: 14, borderRadius: 11,
    background: "rgba(255,255,255,0.04)", border: "1.5px solid rgba(255,255,255,0.12)",
    color: "#f4f5fb", width: "100%", outline: "none",
    transition: "border-color 0.18s, box-shadow 0.18s, background 0.18s",
    fontFamily: "inherit", boxSizing: "border-box",
  };
  const onInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "#818cf8";
    e.target.style.boxShadow = "0 0 0 4px rgba(99,102,241,0.18)";
    e.target.style.background = "rgba(255,255,255,0.06)";
  };
  const onInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "rgba(255,255,255,0.12)";
    e.target.style.boxShadow = "none";
    e.target.style.background = "rgba(255,255,255,0.04)";
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", position: "relative", overflow: "hidden",
      background: "radial-gradient(1200px 800px at 15% 10%, #15162a, #07080f 60%)",
    }}>
      {/* Живые плавающие световые сферы */}
      <div className="glow-pulse" style={{ position: "absolute", top: "-12%", left: "8%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.35), transparent 70%)", filter: "blur(20px)", pointerEvents: "none" }} />
      <div className="glow-pulse" style={{ position: "absolute", bottom: "-16%", left: "30%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.28), transparent 70%)", filter: "blur(24px)", pointerEvents: "none", animationDelay: "1.4s" }} />
      <div className="glow-pulse" style={{ position: "absolute", top: "20%", right: "-8%", width: 440, height: 440, borderRadius: "50%", background: "radial-gradient(circle, rgba(14,165,233,0.22), transparent 70%)", filter: "blur(22px)", pointerEvents: "none", animationDelay: "0.7s" }} />

      {/* ── Левая панель — брендинг ───────────────────── */}
      <div
        className="hidden lg:flex"
        style={{ width: "46%", flexShrink: 0, flexDirection: "column", padding: "52px 60px", position: "relative", zIndex: 1 }}
      >
        {/* Logo */}
        <div className="animate-slideUp" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 80 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: "linear-gradient(135deg, #6366f1, #a78bfa)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 700, fontSize: 14, letterSpacing: "0.02em", flexShrink: 0,
            boxShadow: "0 6px 20px -4px rgba(99,102,241,0.6)",
          }}>B3</div>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 17, letterSpacing: "0.01em", fontFamily: "var(--font-display)" }}>CRM B3</span>
        </div>

        {/* Heading */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div className="animate-slideUp" style={{ display: "inline-flex", alignItems: "center", gap: 8, alignSelf: "flex-start", padding: "6px 14px", borderRadius: 99, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 22 }}>
            <span className="live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>Система онлайн</span>
          </div>
          <h2 className="animate-slideUp" style={{
            fontSize: 34, fontWeight: 700, lineHeight: 1.22, letterSpacing: "-0.01em", marginBottom: 20,
            fontFamily: "var(--font-display)",
            background: "linear-gradient(120deg, #fff 30%, #c7d2fe 70%, #a78bfa 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            Управление<br />производством
          </h2>
          <p className="animate-slideUp" style={{ fontSize: 15, lineHeight: 1.65, color: "rgba(255,255,255,0.5)", maxWidth: 360, marginBottom: 44 }}>
            Единая система для контроля заказов, производства, склада и качества — в реальном времени.
          </p>

          {/* Feature cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 460 }}>
            {FEATURES.map((f, i) => (
              <div
                key={f.label}
                className="login-feature animate-slideUp"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 14, padding: "16px 18px",
                  display: "flex", alignItems: "flex-start", gap: 14,
                  backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
                  transition: "transform 0.2s, border-color 0.2s, box-shadow 0.2s",
                  animationDelay: `${0.1 + i * 0.07}s`,
                }}
                onMouseEnter={(e) => { const t = e.currentTarget; t.style.transform = "translateY(-3px)"; t.style.borderColor = f.color + "66"; t.style.boxShadow = `0 12px 30px -12px ${f.color}88`; }}
                onMouseLeave={(e) => { const t = e.currentTarget; t.style.transform = ""; t.style.borderColor = "rgba(255,255,255,0.1)"; t.style.boxShadow = "none"; }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${f.color}, ${f.color}aa)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, boxShadow: `0 5px 14px -4px ${f.color}aa` }}>
                  <svg style={{ width: 18, height: 18, color: "#fff" }} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={f.path} />
                  </svg>
                </div>
                <div>
                  <div style={{ color: "#fff", fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{f.label}</div>
                  <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 3 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, marginTop: 44 }}>© 2026 CRM B3 Производства</p>
      </div>

      {/* ── Правая панель — форма ─────────────────────── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 32px", position: "relative", zIndex: 1 }}>
        <div
          className="glass animate-modal"
          style={{ width: "100%", maxWidth: 420, borderRadius: 22, padding: "38px 36px" }}
        >
          {/* Mobile logo */}
          <div className="lg:hidden" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: "linear-gradient(135deg, #6366f1, #a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14 }}>B3</div>
            <span style={{ fontWeight: 600, fontSize: 18, color: "var(--text)" }}>CRM B3</span>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 30 }}>
            <h1 style={{ fontSize: 27, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text)", lineHeight: 1.15, marginBottom: 8 }}>
              {t("login.title")}
            </h1>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {t("login.subtitle")}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <label htmlFor="username" style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 7 }}>{t("login.username")}</label>
              <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                autoComplete="username" autoFocus placeholder={t("login.username")}
                style={inputStyle} onFocus={onInputFocus} onBlur={onInputBlur} />
            </div>

            <div>
              <label htmlFor="password" style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 7 }}>{t("login.password")}</label>
              <div style={{ position: "relative" }}>
                <input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" placeholder={t("login.password")}
                  style={{ ...inputStyle, paddingRight: 44 }} onFocus={onInputFocus} onBlur={onInputBlur} />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", padding: 2 }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderRadius: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
                <svg style={{ width: 15, height: 15, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{
                position: "relative", overflow: "hidden", height: 46, borderRadius: 12,
                background: "linear-gradient(135deg, #6366f1, #4f46e5)", color: "#fff",
                fontSize: 14.5, fontWeight: 600, border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                boxShadow: "0 8px 24px -6px rgba(99,102,241,0.6)",
                transition: "transform 0.15s, box-shadow 0.15s, filter 0.15s",
                fontFamily: "inherit", letterSpacing: "-0.01em", marginTop: 6,
              }}
              onMouseEnter={(e) => { if (!loading) { const t = e.currentTarget; t.style.transform = "translateY(-2px)"; t.style.filter = "brightness(1.1)"; t.style.boxShadow = "0 12px 32px -6px rgba(99,102,241,0.75)"; } }}
              onMouseLeave={(e) => { const t = e.currentTarget; t.style.transform = ""; t.style.filter = ""; t.style.boxShadow = "0 8px 24px -6px rgba(99,102,241,0.6)"; }}
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
