"use client";
import { useState } from "react";
import { Order } from "../../lib/api";

const PRIORITY_COLOR: Record<string, string> = {
  "Срочный": "#ef4444", "Высокий": "#f59e0b", "Обычный": "#0ea5e9", "Низкий": "#94a3b8",
};
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export function CalendarView({ orders, onOpen }: { orders: Order[]; onOpen: (id: number) => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });

  // Группировка заказов по дате дедлайна
  const byDay: Record<string, Order[]> = {};
  orders.forEach(o => {
    if (!o.deadline) return;
    const key = ymd(new Date(o.deadline));
    (byDay[key] ||= []).push(o);
  });

  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = (first.getDay() + 6) % 7; // понедельник = 0
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.y, cursor.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const prev = () => setCursor(c => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 });
  const next = () => setCursor(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 });
  const todayKey = ymd(today);
  const noDeadline = orders.filter(o => !o.deadline).length;

  return (
    <div>
      {/* Навигация по месяцам */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <button onClick={prev} style={navBtn}>‹</button>
        <div style={{ fontWeight: 700, fontSize: 16, minWidth: 170, textAlign: "center" }}>
          {MONTHS[cursor.m]} {cursor.y}
        </div>
        <button onClick={next} style={navBtn}>›</button>
        <button onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 13 }}>Сегодня</button>
        {noDeadline > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
            Без срока: {noDeadline}
          </span>
        )}
      </div>

      {/* Сетка (на узких экранах скроллится по горизонтали) */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div className="cal-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, minWidth: 620 }}>
        {WEEKDAYS.map(w => (
          <div key={w} style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textAlign: "center", padding: "4px 0" }}>{w}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} style={{ minHeight: 96 }} />;
          const key = ymd(date);
          const dayOrders = byDay[key] || [];
          const isToday = key === todayKey;
          const isPast = date < new Date(todayKey);
          return (
            <div key={i} style={{
              minHeight: 96, borderRadius: 10, padding: 6,
              background: isToday ? "var(--primary)10" : "var(--bg-secondary)",
              border: isToday ? "2px solid var(--primary)" : "1px solid var(--border)",
              display: "flex", flexDirection: "column", gap: 3,
            }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--primary)" : "var(--text-secondary)", textAlign: "right", paddingRight: 2 }}>
                {date.getDate()}
              </div>
              {dayOrders.slice(0, 3).map(o => {
                const overdue = isPast && !["Завершен", "Завершён", "Выполнен", "Отменен", "Отменён"].includes(o.status);
                return (
                  <button
                    key={o.id}
                    onClick={() => onOpen(o.id)}
                    title={`#${o.id} ${o.product_name} · ${o.status}`}
                    style={{
                      textAlign: "left", border: "none", cursor: "pointer", borderRadius: 6,
                      padding: "2px 6px", fontSize: 11, fontWeight: 500, color: "#fff",
                      background: overdue ? "#ef4444" : (PRIORITY_COLOR[o.priority] || "#0ea5e9"),
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {overdue && "⚠ "}{o.product_name}
                  </button>
                );
              })}
              {dayOrders.length > 3 && (
                <span style={{ fontSize: 10, color: "var(--text-muted)", paddingLeft: 2 }}>+{dayOrders.length - 3} ещё</span>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg-secondary)", cursor: "pointer", fontSize: 18, fontWeight: 700,
  color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center",
};
