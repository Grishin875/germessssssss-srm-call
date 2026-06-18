"use client";

/** Скелетон-плейсхолдер для загрузки (#187). */
export function Skeleton({ width = "100%", height = 16, radius = 8, style }: {
  width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties;
}) {
  return <span className="skeleton" style={{ display: "block", width, height, borderRadius: radius, ...style }} />;
}

/** Скелетон таблицы: N строк × M колонок. */
export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 4 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: "flex", gap: 12 }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={14} width={c === 0 ? 40 : `${100 / cols}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Скелетон карточек. */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={14} />
          <Skeleton height={14} width="80%" />
        </div>
      ))}
    </div>
  );
}
