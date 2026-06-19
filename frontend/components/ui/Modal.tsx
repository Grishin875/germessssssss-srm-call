"use client";
import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
}

const maxWidths: Record<string, number> = {
  sm: 384,
  md: 448,
  lg: 512,
  xl: 672,
  "2xl": 880,
};

export function Modal({ open, onClose, title, children, footer, size = "md" }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) {
      document.addEventListener("keydown", handler);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="animate-fadeIn"
        style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(15,23,42,0.5)" }}
        onClick={onClose}
      />
      {/* Scroll container (отступ под сайдбар задаёт .modal-scroll, на мобильном — 0) */}
      <div className="modal-scroll" style={{ position: "fixed", inset: 0, zIndex: 9999, overflowY: "auto" }}>
        {/* Centering wrapper */}
        <div style={{ display: "flex", minHeight: "100%", alignItems: "center", justifyContent: "center", padding: 16 }}>
          {/* Dialog */}
          <div
            className="animate-modal glass"
            style={{
              position: "relative",
              width: `min(94vw, ${maxWidths[size] ?? 448}px)`,
              maxHeight: "90vh",
              borderRadius: 14,
              boxShadow: "var(--shadow-lg)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid var(--border-light)", flexShrink: 0 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", margin: 0 }}>{title}</h2>
              <button
                onClick={onClose}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-tertiary)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <svg width={16} height={16} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body — скроллится, если контент длинный */}
            <div style={{ padding: "16px 24px", overflowY: "auto", flex: "1 1 auto" }}>{children}</div>

            {/* Footer — всегда виден (sticky) */}
            {footer && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "16px 24px", borderTop: "1px solid var(--border-light)", flexShrink: 0 }}>
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
