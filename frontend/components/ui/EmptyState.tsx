"use client";

/** Пустое состояние с иллюстрацией и подсказкой (#190). */
export function EmptyState({ icon = "📭", title, description, action }: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 48, marginBottom: 4, opacity: 0.9 }} className="float-soft">{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
      {description && <div style={{ fontSize: 13.5, color: "var(--text-muted)", maxWidth: 360, lineHeight: 1.5 }}>{description}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
