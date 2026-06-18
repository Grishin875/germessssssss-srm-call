"use client";
import { Order } from "../../lib/api";
import { PriorityBadge } from "./Badge";

// Колонки канбан-доски заказов. Перетаскивание карточки в колонку меняет статус.
export const KANBAN_COLUMNS: { status: string; label: string; color: string }[] = [
  { status: "Создан",               label: "Создан",            color: "#6b7280" },
  { status: "В работе",             label: "В работе",          color: "#0ea5e9" },
  { status: "Ожидает компонентов",  label: "Ждёт компонентов",  color: "#f59e0b" },
  { status: "На проверке ОТК",      label: "На ОТК",            color: "#8b5cf6" },
  { status: "Доработка",            label: "Доработка",         color: "#ef4444" },
  { status: "Готов к отгрузке",     label: "К отгрузке",        color: "#10b981" },
  { status: "Завершен",             label: "Завершён",          color: "#059669" },
];

interface Props {
  orders: Order[];
  fetching: boolean;
  canEdit: boolean;
  dragId: number | null;
  dragOverCol: string | null;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDragOverCol: (status: string | null) => void;
  onDrop: (status: string) => void;
  onOpen: (orderId: number) => void;
  groupBy?: "status" | "department" | "priority";
}

const PRIORITY_COLORS: Record<string, string> = {
  "Срочный": "#ef4444", "Высокий": "#f59e0b", "Обычный": "#0ea5e9", "Низкий": "#94a3b8",
};

export function KanbanBoard({
  orders, fetching, canEdit, dragId, dragOverCol,
  onDragStart, onDragEnd, onDragOverCol, onDrop, onOpen, groupBy = "status",
}: Props) {
  if (fetching) {
    return <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted)" }}>Загрузка...</div>;
  }

  const keyOf = (o: Order) => groupBy === "department" ? (o.assigned_department || "—")
    : groupBy === "priority" ? (o.priority || "Обычный") : o.status;

  let columns: { status: string; label: string; color: string }[];
  if (groupBy === "status") {
    const known = new Set(KANBAN_COLUMNS.map(c => c.status));
    const extra = [...new Set(orders.map(o => o.status).filter(s => !known.has(s)))];
    columns = [...KANBAN_COLUMNS, ...extra.map(s => ({ status: s, label: s, color: "#94a3b8" }))];
  } else if (groupBy === "priority") {
    columns = [...new Set(orders.map(o => o.priority || "Обычный"))].map(p => ({ status: p, label: p, color: PRIORITY_COLORS[p] || "#94a3b8" }));
  } else {
    columns = [...new Set(orders.map(o => o.assigned_department || "—"))].map(d => ({ status: d, label: d, color: "#6366f1" }));
  }

  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
      {columns.map(col => {
        const cards = orders.filter(o => keyOf(o) === col.status);
        const isOver = dragOverCol === col.status;
        return (
          <div
            key={col.status}
            onDragOver={canEdit ? (e) => { e.preventDefault(); onDragOverCol(col.status); } : undefined}
            onDragLeave={canEdit ? () => onDragOverCol(null) : undefined}
            onDrop={canEdit ? (e) => { e.preventDefault(); onDrop(col.status); } : undefined}
            style={{
              flex: "0 0 264px", width: 264, minHeight: 120,
              background: isOver ? `${col.color}12` : "var(--bg-secondary)",
              borderRadius: 12, padding: 10,
              border: isOver ? `2px dashed ${col.color}` : "2px solid transparent",
              transition: "background 0.15s, border-color 0.15s",
              alignSelf: "stretch",
            }}
          >
            {/* Заголовок колонки */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, padding: "2px 4px" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: col.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{col.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", background: "var(--bg-tertiary)", borderRadius: 10, padding: "1px 8px" }}>
                {cards.length}
              </span>
            </div>

            {/* Карточки */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cards.map(o => {
                const isOverdue = o.deadline
                  && !["Завершен", "Завершён", "Выполнен", "Отменен", "Отменён"].includes(o.status)
                  && new Date(o.deadline) < new Date();
                return (
                  <div
                    key={o.id}
                    draggable={canEdit}
                    onDragStart={() => onDragStart(o.id)}
                    onDragEnd={onDragEnd}
                    onClick={() => onOpen(o.id)}
                    style={{
                      background: "var(--bg-primary)", borderRadius: 10, padding: "10px 12px",
                      border: "1px solid var(--border)", cursor: canEdit ? "grab" : "pointer",
                      boxShadow: dragId === o.id ? "0 8px 24px rgba(0,0,0,0.18)" : "var(--shadow-sm)",
                      opacity: dragId === o.id ? 0.5 : 1,
                      transition: "box-shadow 0.15s, opacity 0.15s, transform 0.1s",
                      borderLeft: `3px solid ${col.color}`,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ""; }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>#{o.id}</span>
                      <PriorityBadge priority={o.priority} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, lineHeight: 1.3 }}>{o.product_name}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--text-muted)" }}>
                      <span>{o.planned_qty} шт</span>
                      {o.deadline && (
                        <span style={{ color: isOverdue ? "#ef4444" : "var(--text-muted)", fontWeight: isOverdue ? 600 : 400 }}>
                          {isOverdue && "⚠ "}{new Date(o.deadline).toLocaleDateString("ru", { day: "2-digit", month: "2-digit" })}
                        </span>
                      )}
                    </div>
                    {o.assigned_department && (
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>🏭 {o.assigned_department}</div>
                    )}
                    {o.status === "Доработка" && o.otk_comment && (
                      <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.otk_comment}>
                        ⚠ {o.otk_comment}
                      </div>
                    )}
                  </div>
                );
              })}
              {cards.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "16px 0", opacity: 0.6 }}>
                  {isOver ? "Отпустите здесь" : "—"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
