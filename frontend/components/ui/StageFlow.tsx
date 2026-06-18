"use client";
import { OrderStage } from "../../lib/api";

const STATUS_COLOR: Record<string, string> = {
  pending: "#6b7280", in_progress: "#0ea5e9", done: "#10b981", blocked: "#f97316", paused: "#a855f7",
};

/** Горизонтальный flow-граф маршрута: этапы сгруппированы по sort_order
 * (одинаковый уровень = параллельная группа), стрелки между уровнями. */
export function StageFlow({ stages, labelOf, onClick }: {
  stages: OrderStage[];
  labelOf: (s: OrderStage) => string;
  onClick?: (s: OrderStage) => void;
}) {
  if (stages.length === 0) return null;
  // Группировка по sort_order
  const levels: Record<number, OrderStage[]> = {};
  stages.forEach(s => { (levels[s.sort_order] ||= []).push(s); });
  const sorted = Object.keys(levels).map(Number).sort((a, b) => a - b);

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 4, overflowX: "auto", padding: "8px 2px" }}>
      {sorted.map((lvl, li) => (
        <div key={lvl} style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {levels[lvl].map(s => {
              const color = STATUS_COLOR[s.status] || "#6b7280";
              return (
                <button
                  key={s.id}
                  onClick={onClick ? () => onClick(s) : undefined}
                  title={`${labelOf(s)} · ${s.status}`}
                  style={{
                    minWidth: 120, maxWidth: 160, textAlign: "left", cursor: onClick ? "pointer" : "default",
                    border: `1.5px solid ${color}`, borderRadius: 10, padding: "8px 10px",
                    background: `${color}12`, transition: "transform 0.1s",
                  }}
                  onMouseEnter={e => { if (onClick) e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ""; }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(s)}</span>
                  </div>
                  {levels[lvl].length > 1 && (
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>параллельно</div>
                  )}
                </button>
              );
            })}
          </div>
          {li < sorted.length - 1 && (
            <span style={{ color: "var(--text-muted)", fontSize: 18, flexShrink: 0 }}>→</span>
          )}
        </div>
      ))}
    </div>
  );
}
