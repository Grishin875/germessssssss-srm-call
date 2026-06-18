"use client";
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "success" | "warning" | "ghost";
type Size = "sm" | "md" | "lg";

const glassEdge = "inset 0 1px 0 rgba(255,255,255,0.25)";
const variants: Record<Variant, React.CSSProperties> = {
  primary:   { background: "linear-gradient(180deg, #6d70f3, #5458ee 50%, #4f46e5)", color: "#fff", boxShadow: `0 2px 10px -2px rgba(99,102,241,0.55), ${glassEdge}` },
  secondary: { background: "var(--bg-secondary)", color: "var(--text)", border: "1.5px solid var(--border)" },
  danger:    { background: "linear-gradient(180deg, #f15b5b, #ef4444 50%, #dc2626)", color: "#fff", boxShadow: `0 2px 10px -2px rgba(239,68,68,0.5), ${glassEdge}` },
  success:   { background: "linear-gradient(180deg, #1cc78f, #10b981 50%, #059669)", color: "#fff", boxShadow: `0 2px 10px -2px rgba(16,185,129,0.5), ${glassEdge}` },
  warning:   { background: "linear-gradient(180deg, #f7a623, #f59e0b 50%, #d97706)", color: "#fff", boxShadow: `0 2px 10px -2px rgba(245,158,11,0.5), ${glassEdge}` },
  ghost:     { background: "transparent", color: "var(--text-secondary)" },
};

// sm=30px  md=36px  lg=40px — matches --field-height-sm / --field-height / --field-height-lg
const sizes: Record<Size, React.CSSProperties> = {
  sm: { height: "30px", padding: "0 10px", fontSize: "12px", gap: "5px" },
  md: { height: "36px", padding: "0 14px", fontSize: "13px", gap: "6px" },
  lg: { height: "40px", padding: "0 18px", fontSize: "14px", gap: "7px" },
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  children,
  className = "",
  disabled,
  style,
  ...props
}: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center shrink-0 font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 hover:-translate-y-px hover:shadow-md active:translate-y-0 active:brightness-95 whitespace-nowrap ${className}`}
      style={{ borderRadius: 10, ...variants[variant], ...sizes[size], ...style }}
    >
      {loading && (
        <svg
          style={{ width: 13, height: 13, flexShrink: 0, animation: "spin 0.7s linear infinite" }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
          <path fill="currentColor" fillOpacity="0.8" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
