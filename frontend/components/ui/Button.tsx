"use client";
import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "success" | "warning" | "ghost";
type Size = "sm" | "md" | "lg";

// Плоские, плотные заливки — без градиентов и «стеклянных» бликов.
const variants: Record<Variant, React.CSSProperties> = {
  primary:   { background: "var(--primary)", color: "#fff", boxShadow: "var(--shadow-sm)" },
  secondary: { background: "var(--bg-secondary)", color: "var(--text)", border: "1px solid var(--border-strong)" },
  danger:    { background: "#dc2626", color: "#fff", boxShadow: "var(--shadow-sm)" },
  success:   { background: "#16a34a", color: "#fff", boxShadow: "var(--shadow-sm)" },
  warning:   { background: "#d97706", color: "#fff", boxShadow: "var(--shadow-sm)" },
  ghost:     { background: "transparent", color: "var(--text-secondary)" },
};

// sm=30px  md=36px  lg=40px — matches --field-height-sm / --field-height / --field-height-lg
const sizes: Record<Size, React.CSSProperties> = {
  sm: { height: "30px", padding: "0 11px", fontSize: "12.5px", gap: "5px" },
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
      data-variant={variant}
      disabled={disabled || loading}
      className={`btn-base inline-flex items-center justify-center shrink-0 font-semibold transition-[filter,background-color,box-shadow,border-color] duration-150 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap ${className}`}
      style={{ borderRadius: 8, fontWeight: 600, ...variants[variant], ...sizes[size], ...style }}
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
