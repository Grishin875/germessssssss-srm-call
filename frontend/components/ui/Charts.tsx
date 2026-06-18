"use client";
// Лёгкие графики на чистом SVG/CSS — без внешних библиотек, работают офлайн.

export interface Slice { label: string; value: number; color: string; }

/** Кольцевая диаграмма (донат) с легендой. */
export function DonutChart({ data, size = 140, thickness = 22 }: {
  data: Slice[]; size?: number; thickness?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg width={size} height={size} style={{ flexShrink: 0, transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-tertiary)" strokeWidth={thickness} />
        {total > 0 && data.map((d, i) => {
          const len = (d.value / total) * circ;
          const seg = (
            <circle
              key={i} cx={cx} cy={cy} r={r} fill="none" stroke={d.color}
              strokeWidth={thickness} strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease" }}
            />
          );
          offset += len;
          return seg;
        })}
        {/* центр */}
        <circle cx={cx} cy={cy} r={r - thickness / 2 - 1} fill="var(--bg-secondary)" />
      </svg>
      <div style={{ position: "relative", marginLeft: -size + thickness, width: size, height: size, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{total}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>всего</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 130 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: "var(--text-secondary)" }}>{d.label}</span>
            <span style={{ fontWeight: 600 }}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Горизонтальный бар-чарт. */
export function BarChart({ data, height = 14 }: { data: Slice[]; height?: number; }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
          <span style={{ width: 110, color: "var(--text-secondary)", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
          <div style={{ flex: 1, background: "var(--bg-tertiary)", borderRadius: 6, height, overflow: "hidden" }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: "100%", background: d.color, borderRadius: 6, transition: "width 0.6s ease", minWidth: d.value > 0 ? 4 : 0 }} />
          </div>
          <span style={{ width: 34, fontWeight: 600, textAlign: "right", flexShrink: 0 }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Спарклайн-линия по точкам (тренд). */
export function Sparkline({ points, color = "#6366f1", width = 240, height = 56 }: {
  points: number[]; color?: string; width?: number; height?: number;
}) {
  if (points.length < 2) return <div style={{ height, color: "var(--text-muted)", fontSize: 12, display: "flex", alignItems: "center" }}>Недостаточно данных</div>;
  const max = Math.max(1, ...points), min = Math.min(0, ...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => [i * stepX, height - ((p - min) / range) * (height - 8) - 4]);
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block", maxWidth: "100%" }}>
      <defs>
        <linearGradient id={`sl-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sl-${color.replace("#", "")})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {coords.map(([x, y], i) => i === coords.length - 1 && (
        <circle key={i} cx={x} cy={y} r={3} fill={color} />
      ))}
    </svg>
  );
}
