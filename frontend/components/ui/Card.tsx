"use client";
import { ReactNode, MouseEvent } from "react";

interface Props {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

// Прожектор за курсором: пишем координаты в CSS-переменные элемента
export function trackPointer(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export function Card({ title, children, className = "", actions }: Props) {
  return (
    <div
      className={`card-elev glass ${className}`}
      onMouseMove={trackPointer}
      style={{
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {(title || actions) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-light)",
            background: "linear-gradient(180deg, rgba(148,163,184,0.07), transparent)",
          }}
        >
          {title && (
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </span>
          )}
          {actions && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {actions}
            </div>
          )}
        </div>
      )}
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  accent?: string;
  trend?: string;
}

export function StatCard({ title, value, icon, accent = "#6366f1", trend }: StatCardProps) {
  return (
    <div
      className="card-elev glass"
      onMouseMove={trackPointer}
      style={{
        position: "relative",
        backgroundImage: `linear-gradient(145deg, ${accent}1f, transparent 55%)`,
        borderRadius: 16,
        padding: "18px 20px",
        overflow: "hidden",
      }}
    >
      {/* Цветной блик в углу */}
      <div
        style={{
          position: "absolute", top: -30, right: -30, width: 110, height: 110,
          borderRadius: "50%", background: `radial-gradient(circle, ${accent}1c, transparent 70%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, position: "relative" }}>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-muted)",
              marginBottom: 8,
              letterSpacing: "0.01em",
            }}
          >
            {title}
          </p>
          <p
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "var(--text)",
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
              fontFamily: "var(--font-display)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {value}
          </p>
          {trend && (
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{trend}</p>
          )}
        </div>
        {icon && (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              background: `linear-gradient(135deg, ${accent}, ${accent}bb)`,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: `0 5px 14px -4px ${accent}90`,
            }}
          >
            {icon}
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: 16,
          height: 3,
          borderRadius: 999,
          background: `linear-gradient(90deg, ${accent}, ${accent}10)`,
        }}
      />
    </div>
  );
}
