"use client";
import { ReactNode, MouseEvent } from "react";

interface Props {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

// Сохранено для обратной совместимости — больше не используется (no-op).
export function trackPointer(_e: MouseEvent<HTMLElement>) {}

export function Card({ title, children, className = "", actions }: Props) {
  return (
    <div
      className={`card-elev glass ${className}`}
      style={{ borderRadius: 12, overflow: "hidden" }}
    >
      {(title || actions) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "13px 18px",
            borderBottom: "1px solid var(--border-light)",
          }}
        >
          {title && (
            <span
              style={{
                fontSize: 13.5,
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
      <div style={{ padding: 18 }}>{children}</div>
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

// Спокойная KPI-карточка: значение нейтральным цветом, акцент — только в иконке.
export function StatCard({ title, value, icon, accent = "var(--primary)", trend }: StatCardProps) {
  return (
    <div
      className="card-elev glass"
      style={{
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <p
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--text-secondary)",
            letterSpacing: "0.005em",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </p>
        {icon && (
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "var(--text)",
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            fontFamily: "var(--font-display)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
        {trend && (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{trend}</span>
        )}
      </div>
    </div>
  );
}
