"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api, DocFile } from "../../lib/api";
import { FileEditor } from "../../components/documents/FileEditor";
import { toast } from "../../components/ui/Toast";

// ── File type config ────────────────────────────────────────────────────────
const FILE_CONFIG: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  pdf: {
    color: "#dc2626", bg: "linear-gradient(135deg,#fef2f2,#fee2e2)",
    label: "PDF",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width={40} height={40}>
        <rect width="40" height="40" rx="8" fill="#ef4444" fillOpacity=".12"/>
        <path d="M11 8h13l8 8v18a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" stroke="#ef4444" strokeWidth="1.5"/>
        <path d="M24 8l8 8h-6a2 2 0 01-2-2V8z" fill="#ef4444" fillOpacity=".3" stroke="#ef4444" strokeWidth="1.5"/>
        <text x="20" y="29" textAnchor="middle" fontSize="8" fontWeight="700" fill="#dc2626" fontFamily="Arial,sans-serif">PDF</text>
      </svg>
    ),
  },
  docx: {
    color: "#2563eb", bg: "linear-gradient(135deg,#eff6ff,#dbeafe)",
    label: "DOCX",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width={40} height={40}>
        <rect width="40" height="40" rx="8" fill="#3b82f6" fillOpacity=".12"/>
        <path d="M11 8h13l8 8v18a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" stroke="#3b82f6" strokeWidth="1.5"/>
        <path d="M24 8l8 8h-6a2 2 0 01-2-2V8z" fill="#3b82f6" fillOpacity=".3" stroke="#3b82f6" strokeWidth="1.5"/>
        <text x="20" y="29" textAnchor="middle" fontSize="7" fontWeight="700" fill="#2563eb" fontFamily="Arial,sans-serif">DOC</text>
      </svg>
    ),
  },
  doc: {
    color: "#2563eb", bg: "linear-gradient(135deg,#eff6ff,#dbeafe)",
    label: "DOC",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width={40} height={40}>
        <rect width="40" height="40" rx="8" fill="#3b82f6" fillOpacity=".12"/>
        <path d="M11 8h13l8 8v18a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" stroke="#3b82f6" strokeWidth="1.5"/>
        <path d="M24 8l8 8h-6a2 2 0 01-2-2V8z" fill="#3b82f6" fillOpacity=".3" stroke="#3b82f6" strokeWidth="1.5"/>
        <text x="20" y="29" textAnchor="middle" fontSize="7" fontWeight="700" fill="#2563eb" fontFamily="Arial,sans-serif">DOC</text>
      </svg>
    ),
  },
  xlsx: {
    color: "#16a34a", bg: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
    label: "XLSX",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width={40} height={40}>
        <rect width="40" height="40" rx="8" fill="#22c55e" fillOpacity=".12"/>
        <path d="M11 8h13l8 8v18a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" stroke="#22c55e" strokeWidth="1.5"/>
        <path d="M24 8l8 8h-6a2 2 0 01-2-2V8z" fill="#22c55e" fillOpacity=".3" stroke="#22c55e" strokeWidth="1.5"/>
        <text x="20" y="29" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#16a34a" fontFamily="Arial,sans-serif">XLS</text>
      </svg>
    ),
  },
  xls: {
    color: "#16a34a", bg: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
    label: "XLS",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width={40} height={40}>
        <rect width="40" height="40" rx="8" fill="#22c55e" fillOpacity=".12"/>
        <path d="M11 8h13l8 8v18a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" stroke="#22c55e" strokeWidth="1.5"/>
        <path d="M24 8l8 8h-6a2 2 0 01-2-2V8z" fill="#22c55e" fillOpacity=".3" stroke="#22c55e" strokeWidth="1.5"/>
        <text x="20" y="29" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#16a34a" fontFamily="Arial,sans-serif">XLS</text>
      </svg>
    ),
  },
  jpg: {
    color: "#d97706", bg: "linear-gradient(135deg,#fffbeb,#fef3c7)",
    label: "JPG",
    icon: null,
  },
  jpeg: {
    color: "#d97706", bg: "linear-gradient(135deg,#fffbeb,#fef3c7)",
    label: "JPEG",
    icon: null,
  },
  png: {
    color: "#7c3aed", bg: "linear-gradient(135deg,#f5f3ff,#ede9fe)",
    label: "PNG",
    icon: null,
  },
  gif: {
    color: "#0891b2", bg: "linear-gradient(135deg,#ecfeff,#cffafe)",
    label: "GIF",
    icon: null,
  },
  mp4: {
    color: "#be185d", bg: "linear-gradient(135deg,#fdf2f8,#fce7f3)",
    label: "MP4",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" width={40} height={40}>
        <rect width="40" height="40" rx="8" fill="#ec4899" fillOpacity=".12"/>
        <path d="M11 8h13l8 8v18a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" stroke="#ec4899" strokeWidth="1.5"/>
        <path d="M24 8l8 8h-6a2 2 0 01-2-2V8z" fill="#ec4899" fillOpacity=".3" stroke="#ec4899" strokeWidth="1.5"/>
        <circle cx="20" cy="24" r="5" stroke="#be185d" strokeWidth="1.5" fill="none"/>
        <path d="M18.5 22.5l4 1.5-4 1.5v-3z" fill="#be185d"/>
      </svg>
    ),
  },
  txt: {
    color: "#475569", bg: "linear-gradient(135deg,#f8fafc,#f1f5f9)",
    label: "TXT",
    icon: (
      <svg viewBox="0 0 40 40" fill="none" width={40} height={40}>
        <rect width="40" height="40" rx="8" fill="#64748b" fillOpacity=".1"/>
        <path d="M11 8h13l8 8v18a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" stroke="#64748b" strokeWidth="1.5"/>
        <path d="M24 8l8 8h-6a2 2 0 01-2-2V8z" fill="#64748b" fillOpacity=".2" stroke="#64748b" strokeWidth="1.5"/>
        <line x1="13" y1="22" x2="27" y2="22" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="13" y1="26" x2="23" y2="26" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
};

const IMG_TYPES = ["jpg", "jpeg", "png", "gif", "webp"];
const EDITABLE_TYPES = ["docx", "doc", "pdf", "xlsx", "xls", "txt"];
const CONVERT_OPTIONS: Record<string, string[]> = {
  docx: ["pdf"], doc: ["pdf"], pdf: ["docx"], xlsx: ["pdf"], xls: ["pdf"],
};

function getConfig(type: string) {
  return FILE_CONFIG[type.toLowerCase()] || {
    color: "#475569", bg: "linear-gradient(135deg,#f8fafc,#f1f5f9)", label: type.toUpperCase(),
    icon: (
      <svg viewBox="0 0 40 40" fill="none" width={40} height={40}>
        <rect width="40" height="40" rx="8" fill="#64748b" fillOpacity=".1"/>
        <path d="M11 8h13l8 8v18a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="white" stroke="#64748b" strokeWidth="1.5"/>
        <path d="M24 8l8 8h-6a2 2 0 01-2-2V8z" fill="#64748b" fillOpacity=".2" stroke="#64748b" strokeWidth="1.5"/>
      </svg>
    ),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function fmtDate(s: string) {
  const d = new Date(s);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  if (diff < 7) return `${diff} дня назад`;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

// ── SVG Icons ────────────────────────────────────────────────────────────────
const IcoGrid    = () => <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
const IcoList    = () => <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>;
const IcoUpload  = () => <svg width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>;
const IcoEye     = () => <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>;
const IcoPencil  = () => <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3a2 2 0 01.586-1.414z"/></svg>;
const IcoEdit    = () => <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>;
const IcoDown    = () => <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>;
const IcoConvert = () => <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>;
const IcoTrash   = () => <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M4 7h16"/></svg>;
const IcoClose   = () => <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>;
const IcoSearch  = () => <svg width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>;
const IcoChevL   = () => <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>;
const IcoChevR   = () => <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>;

// ── Image thumbnail with auth ────────────────────────────────────────────────
function AuthImage({ src, alt, style, fallback }: { src: string; alt: string; style?: React.CSSProperties; fallback?: React.ReactNode }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let url: string | null = null;
    setStatus("loading");
    setObjectUrl(null);
    const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => { url = URL.createObjectURL(blob); setObjectUrl(url); setStatus("ok"); })
      .catch(() => setStatus("error"));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [src]);

  if (status === "loading") return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 20, height: 20, border: "2px solid rgba(0,0,0,0.1)", borderTopColor: "#94a3b8", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
    </div>
  );
  if (status === "error" || !objectUrl) return <>{fallback}</>;
  return <img src={objectUrl} alt={alt} style={style} />;
}

// ── File Card (Grid view) ────────────────────────────────────────────────────
function FileCard({
  doc, onPreview, onEditMeta, onEditContent, onDownload, onConvert, onDelete,
}: {
  doc: DocFile;
  onPreview: () => void;
  onEditMeta: () => void;
  onEditContent: () => void;
  onDownload: () => void;
  onConvert: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const cfg = getConfig(doc.file_type);
  const isImg = IMG_TYPES.includes(doc.file_type.toLowerCase());

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        borderRadius: 12,
        border: `1.5px solid ${hovered ? cfg.color + "44" : "var(--border)"}`,
        background: "var(--bg-secondary)",
        overflow: "hidden",
        transition: "all 0.18s",
        boxShadow: hovered ? `0 8px 24px ${cfg.color}18, 0 2px 8px rgba(0,0,0,0.08)` : "0 1px 3px rgba(0,0,0,0.06)",
        transform: hovered ? "translateY(-2px)" : "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Thumbnail area */}
      <div
        onClick={onPreview}
        style={{
          height: 120,
          background: cfg.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {isImg ? (
          <AuthImage
            src={api.documentDownloadUrl(doc.id)}
            alt={doc.name}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            fallback={
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <svg width={28} height={28} fill="none" stroke={cfg.color} strokeWidth={1.5} viewBox="0 0 24 24">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-5-5L5 21"/>
                </svg>
                <span style={{ fontSize: 9, color: cfg.color, fontWeight: 600 }}>
                  {cfg.label}
                </span>
              </div>
            }
          />
        ) : cfg.icon ? (
          <div style={{ transform: "scale(1.4)" }}>{cfg.icon}</div>
        ) : null}

        {/* Type badge top-right */}
        <div style={{
          position: "absolute", top: 8, right: 8,
          background: cfg.color, color: "white",
          fontSize: 10, fontWeight: 700, padding: "2px 7px",
          borderRadius: 20, letterSpacing: "0.04em",
          boxShadow: `0 2px 6px ${cfg.color}44`,
        }}>
          {cfg.label}
        </div>
      </div>

      {/* Info area */}
      <div style={{ padding: "10px 12px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          title={doc.name}
          style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {doc.name}
        </div>
        {doc.category && (
          <div style={{ fontSize: 11, color: cfg.color, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {doc.category}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
          {fmtSize(doc.file_size)} · {fmtDate(doc.created_at)}
        </div>
      </div>

      {/* Hover action bar */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        background: "var(--bg-secondary)",
        borderTop: `1px solid ${cfg.color}22`,
        display: "flex", justifyContent: "center", gap: 2, padding: "6px 8px",
        opacity: hovered ? 1 : 0,
        transition: "opacity 0.15s",
        pointerEvents: hovered ? "auto" : "none",
      }}>
        <CardAction icon={<IcoEye />}     title="Просмотр"              onClick={onPreview} />
        <CardAction icon={<IcoPencil />}  title="Редактировать данные"  onClick={onEditMeta} />
        <CardAction icon={<IcoEdit />}    title="Редактировать содержимое" onClick={onEditContent} disabled={!EDITABLE_TYPES.includes(doc.file_type)} />
        <CardAction icon={<IcoDown />}    title="Скачать"               onClick={onDownload} />
        <CardAction icon={<IcoConvert />} title="Конвертировать"        onClick={onConvert} disabled={!CONVERT_OPTIONS[doc.file_type]?.length} />
        <CardAction icon={<IcoTrash />}   title="Удалить"               onClick={onDelete} danger />
      </div>
    </div>
  );
}

function CardAction({ icon, title, onClick, disabled, danger }: {
  icon: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      title={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 7, border: "none",
        background: "transparent", cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? "var(--text-muted)" : danger ? "#dc2626" : "var(--text-secondary)",
        opacity: disabled ? 0.35 : 1, transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={e => { if (!disabled) { const el = e.currentTarget as HTMLElement; el.style.background = danger ? "#fef2f2" : "var(--bg-tertiary)"; } }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {icon}
    </button>
  );
}

// ── List row ─────────────────────────────────────────────────────────────────
function FileRow({
  doc, onPreview, onEditMeta, onEditContent, onDownload, onConvert, onDelete,
}: {
  doc: DocFile;
  onPreview: () => void; onEditMeta: () => void; onEditContent: () => void;
  onDownload: () => void; onConvert: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const cfg = getConfig(doc.file_type);

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? "var(--bg-tertiary)" : "transparent", transition: "background 0.12s", cursor: "pointer" }}
    >
      <td onClick={onPreview} style={{ paddingLeft: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color, letterSpacing: "0.02em" }}>{cfg.label}</span>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
            {doc.description && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{doc.description}</div>}
          </div>
        </div>
      </td>
      <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>{doc.category || "—"}</td>
      <td style={{ color: "var(--text-muted)", fontSize: 12, whiteSpace: "nowrap" }}>{fmtSize(doc.file_size)}</td>
      <td style={{ color: "var(--text-muted)", fontSize: 12, whiteSpace: "nowrap" }}>{fmtDate(doc.created_at)}</td>
      <td style={{ paddingRight: 12 }}>
        <div style={{ display: "flex", gap: 2, opacity: hovered ? 1 : 0, transition: "opacity 0.12s" }}>
          <CardAction icon={<IcoEye />}     title="Просмотр"             onClick={onPreview} />
          <CardAction icon={<IcoPencil />}  title="Редактировать данные" onClick={onEditMeta} />
          <CardAction icon={<IcoEdit />}    title="Редактировать содержимое" onClick={onEditContent} disabled={!EDITABLE_TYPES.includes(doc.file_type)} />
          <CardAction icon={<IcoDown />}    title="Скачать"              onClick={onDownload} />
          <CardAction icon={<IcoConvert />} title="Конвертировать"       onClick={onConvert} disabled={!CONVERT_OPTIONS[doc.file_type]?.length} />
          <CardAction icon={<IcoTrash />}   title="Удалить"              onClick={onDelete} danger />
        </div>
      </td>
    </tr>
  );
}

// ── Fullscreen preview ────────────────────────────────────────────────────────
function PreviewOverlay({
  doc, docs, onClose, onDownload,
}: {
  doc: DocFile; docs: DocFile[]; onClose: () => void; onDownload: (d: DocFile) => void;
}) {
  const [current, setCurrent] = useState(doc);
  const idx = docs.findIndex(d => d.id === current.id);
  const isImg = IMG_TYPES.includes(current.file_type.toLowerCase());
  const cfg = getConfig(current.file_type);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadingBlob, setLoadingBlob] = useState(false);

  useEffect(() => {
    setCurrent(doc);
  }, [doc]);

  useEffect(() => {
    let url: string | null = null;
    if (isImg) {
      setLoadingBlob(true);
      setObjectUrl(null);
      const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;
      fetch(api.documentDownloadUrl(current.id), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => { url = URL.createObjectURL(blob); setObjectUrl(url); })
        .catch(console.error)
        .finally(() => setLoadingBlob(false));
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [current.id, isImg]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && idx > 0) setCurrent(docs[idx - 1]);
      if (e.key === "ArrowRight" && idx < docs.length - 1) setCurrent(docs[idx + 1]);
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = ""; };
  }, [idx, docs, onClose]);

  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px", background: "rgba(255,255,255,0.04)", flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6, background: cfg.color + "22",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: cfg.color }}>{cfg.label}</span>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{current.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtSize(current.file_size)} · {fmtDate(current.created_at)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => onDownload(current)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
              borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.08)", color: "#f1f5f9", cursor: "pointer", fontSize: 13, fontWeight: 500,
            }}
          >
            <IcoDown /> Скачать
          </button>
          <button
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.05)", cursor: "pointer", color: "#94a3b8",
            }}
          >
            <IcoClose />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
        {/* Prev/Next nav */}
        {idx > 0 && (
          <button
            onClick={() => setCurrent(docs[idx - 1])}
            style={{ position: "absolute", left: 16, zIndex: 1, width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", cursor: "pointer", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
          ><IcoChevL /></button>
        )}
        {idx < docs.length - 1 && (
          <button
            onClick={() => setCurrent(docs[idx + 1])}
            style={{ position: "absolute", right: 16, zIndex: 1, width: 44, height: 44, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", cursor: "pointer", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}
          ><IcoChevR /></button>
        )}

        {isImg ? (
          loadingBlob ? (
            <div style={{ color: "#94a3b8", fontSize: 14 }}>Загрузка изображения...</div>
          ) : objectUrl ? (
            <img
              src={objectUrl}
              alt={current.name}
              style={{ maxWidth: "calc(100% - 120px)", maxHeight: "calc(100vh - 130px)", objectFit: "contain", borderRadius: 4, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
            />
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 14 }}>Не удалось загрузить изображение</div>
          )
        ) : current.file_type === "pdf" ? (
          <PdfPreview docId={current.id} name={current.name} content={current.content} />
        ) : (
          <DocPreview doc={current} onReextracted={(content) => setCurrent({ ...current, content })} />
        )}
      </div>

      {/* Bottom strip — thumbnails */}
      {docs.length > 1 && (
        <div style={{
          display: "flex", gap: 8, padding: "12px 20px", overflowX: "auto",
          borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.4)",
          flexShrink: 0,
        }}>
          {docs.map(d => {
            const c = getConfig(d.file_type);
            const active = d.id === current.id;
            return (
              <button
                key={d.id}
                onClick={() => setCurrent(d)}
                style={{
                  flexShrink: 0, width: 52, height: 52, borderRadius: 8,
                  background: c.bg, border: `2px solid ${active ? c.color : "transparent"}`,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "border 0.12s", overflow: "hidden", padding: 0,
                }}
              >
                <span style={{ fontSize: 8, fontWeight: 800, color: c.color }}>{c.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body
  );
}

function DocPreview({ doc, onReextracted }: { doc: DocFile; onReextracted: (content: string) => void }) {
  const [reextracting, setReextracting] = useState(false);

  async function reextract() {
    setReextracting(true);
    try {
      await api.reextractDocument(doc.id);
      const updated = await api.getDocument(doc.id);
      onReextracted((updated as DocFile).content || "");
    } catch {}
    setReextracting(false);
  }

  return (
    <div style={{
      maxWidth: 820, width: "90%", maxHeight: "calc(100vh - 130px)", overflowY: "auto",
      background: "white", borderRadius: 12, padding: "32px 40px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button
          onClick={reextract}
          disabled={reextracting}
          title="Повторно извлечь содержимое из файла"
          style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#475569", cursor: reextracting ? "not-allowed" : "pointer", fontSize: 11, opacity: reextracting ? 0.6 : 1 }}
        >{reextracting ? "Обновление..." : "↻ Обновить контент"}</button>
      </div>
      {doc.content ? (
        <div style={{ fontSize: 14, lineHeight: 1.8, color: "#1e293b" }} dangerouslySetInnerHTML={{ __html: doc.content }} />
      ) : (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#94a3b8" }}>
          <div style={{ fontSize: 15, marginBottom: 12 }}>Содержимое не извлечено</div>
          <button
            onClick={reextract}
            disabled={reextracting}
            style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#2563eb", color: "white", cursor: reextracting ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600 }}
          >{reextracting ? "Извлечение..." : "Извлечь содержимое"}</button>
        </div>
      )}
    </div>
  );
}

function PdfPreview({ docId, name, content }: { docId: number; name: string; content?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [showText, setShowText] = useState(false); // fallback: text extraction

  useEffect(() => {
    let url: string | null = null;
    const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;
    fetch(api.documentDownloadUrl(docId), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => { url = URL.createObjectURL(blob); setBlobUrl(url); })
      .catch(console.error);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [docId]);

  // Show text extraction (fallback for PDFs with rendering issues)
  if (showText) {
    return (
      <div style={{
        maxWidth: 720, width: "90%", maxHeight: "calc(100vh - 130px)", overflowY: "auto",
        background: "white", borderRadius: 12, padding: "32px 40px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button
            onClick={() => setShowText(false)}
            style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#475569", cursor: "pointer", fontSize: 12 }}
          >← Просмотр PDF</button>
        </div>
        {content ? (
          <div style={{ fontSize: 14, lineHeight: 1.8, color: "#1e293b" }} dangerouslySetInnerHTML={{ __html: content }} />
        ) : (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#94a3b8" }}>Текст не извлечён</div>
        )}
      </div>
    );
  }

  // Default: show PDF in iframe
  if (blobUrl) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "min(860px, calc(100vw - 120px))" }}>
        {content && (
          <button
            onClick={() => setShowText(true)}
            style={{ alignSelf: "flex-end", padding: "5px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", color: "#94a3b8", cursor: "pointer", fontSize: 11 }}
          >Текстовый вид</button>
        )}
        <iframe
          src={blobUrl}
          title={name}
          style={{ width: "100%", height: "calc(100vh - 180px)", borderRadius: 4, border: "none", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
        />
      </div>
    );
  }

  // Loading
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "#94a3b8", fontSize: 14 }}>
      Загрузка PDF...
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function DocumentsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [docs, setDocs] = useState<DocFile[]>([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"date" | "name" | "size">("date");

  // Modals
  const [preview, setPreview] = useState<DocFile | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showEditMeta, setShowEditMeta] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [selected, setSelected] = useState<DocFile | null>(null);

  // Upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({ name: "", description: "", category: "", tags: "" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Edit meta
  const [metaForm, setMetaForm] = useState({ name: "", description: "", category: "", tags: "" });
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaError, setMetaError] = useState("");

  // Full-screen editor
  const [editingDoc, setEditingDoc] = useState<DocFile | null>(null);

  // Convert
  const [convertTo, setConvertTo] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user]);

  async function load(params: Record<string, string> = {}) {
    setFetching(true);
    try {
      const data = await api.getDocuments(params);
      setDocs(data);
      setCategories([...new Set(data.map(d => d.category).filter(Boolean))] as string[]);
    } catch {}
    setFetching(false);
  }

  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (typeFilter) params.file_type = typeFilter;
      if (categoryFilter) params.category = categoryFilter;
      load(params);
    }, 300);
    return () => clearTimeout(t);
  }, [search, typeFilter, categoryFilter, user]);

  // Sorted docs
  const sortedDocs = [...docs].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name, "ru");
    if (sortBy === "size") return b.file_size - a.file_size;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // ── Upload ────────────────────────────────────────────────────────────────
  function handleFilePick(f: File) {
    setUploadFile(f);
    setUploadForm(p => ({ ...p, name: p.name || f.name.replace(/\.[^.]+$/, "") }));
    setUploadError("");
  }

  async function doUpload() {
    if (!uploadFile) { setUploadError("Выберите файл"); return; }
    if (!uploadForm.name.trim()) { setUploadError("Введите название"); return; }
    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("name", uploadForm.name.trim());
      if (uploadForm.description) fd.append("description", uploadForm.description);
      if (uploadForm.category) fd.append("category", uploadForm.category);
      if (uploadForm.tags) fd.append("tags", uploadForm.tags);
      await api.uploadDocument(fd);
      setShowUpload(false);
      setUploadFile(null);
      setUploadForm({ name: "", description: "", category: "", tags: "" });
      load();
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
    setUploading(false);
  }

  // ── Edit meta ─────────────────────────────────────────────────────────────
  function openEditMeta(doc: DocFile) {
    setSelected(doc);
    setMetaForm({ name: doc.name, description: doc.description || "", category: doc.category || "", tags: doc.tags || "" });
    setMetaError("");
    setShowEditMeta(true);
  }

  async function doSaveMeta() {
    if (!selected || !metaForm.name.trim()) { setMetaError("Название обязательно"); return; }
    setMetaSaving(true); setMetaError("");
    try {
      await api.updateDocument(selected.id, metaForm);
      setShowEditMeta(false); load();
    } catch (e: unknown) { setMetaError(e instanceof Error ? e.message : "Ошибка"); }
    setMetaSaving(false);
  }

  // ── Edit content ─────────────────────────────────────────────────────────────
  function openEditContent(doc: DocFile) { setEditingDoc(doc); }

  async function doSaveContent(html: string) {
    if (!editingDoc) return;
    await api.updateDocumentContent(editingDoc.id, html);
    load();
  }

  // ── Download ──────────────────────────────────────────────────────────────
  function fetchAndDownload(url: string, filename: string) {
    const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => { if (!r.ok) throw new Error(); return r.blob(); })
      .then(blob => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = u; a.download = filename; a.click();
        URL.revokeObjectURL(u);
      })
      .catch(() => toast.error("Ошибка при скачивании"));
  }

  function downloadDoc(doc: DocFile) {
    fetchAndDownload(api.documentDownloadUrl(doc.id), doc.file_name);
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async function doDelete(doc: DocFile) {
    if (!confirm(`Удалить «${doc.name}»?`)) return;
    try { await api.deleteDocument(doc.id); load(); } catch {}
  }

  // ── Convert ───────────────────────────────────────────────────────────────
  function openConvert(doc: DocFile) {
    setSelected(doc);
    const opts = CONVERT_OPTIONS[doc.file_type] || [];
    setConvertTo(opts[0] || "");
    setShowConvert(true);
  }

  function doConvert() {
    if (!selected || !convertTo) return;
    fetchAndDownload(api.documentConvertUrl(selected.id, convertTo), `${selected.name}.${convertTo}`);
    setShowConvert(false);
  }

  // ── Type filter pills ─────────────────────────────────────────────────────
  const TYPE_PILLS = [
    { value: "", label: "Все" },
    { value: "pdf", label: "PDF" },
    { value: "docx", label: "Word" },
    { value: "xlsx", label: "Excel" },
    { value: "jpg", label: "JPG" },
    { value: "png", label: "PNG" },
  ];

  const handlers = useCallback((doc: DocFile) => ({
    onPreview:     () => setPreview(doc),
    onEditMeta:    () => openEditMeta(doc),
    onEditContent: () => openEditContent(doc),
    onDownload:    () => downloadDoc(doc),
    onConvert:     () => openConvert(doc),
    onDelete:      () => doDelete(doc),
  }), [docs]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (editingDoc) {
    return (
      <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
        <div style={{ width: 248, flexShrink: 0 }}>
          {/* sidebar placeholder — держит отступ */}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100vh" }}>
          <FileEditor
            doc={editingDoc}
            onClose={() => setEditingDoc(null)}
            onSave={doSaveContent}
          />
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="ac animate-fadeIn" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Документы</h1>
            {!fetching && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
                {docs.length} {docs.length === 1 ? "файл" : docs.length < 5 ? "файла" : "файлов"}
              </div>
            )}
          </div>
          <Button onClick={() => { setShowUpload(true); setUploadError(""); setUploadFile(null); setUploadForm({ name: "", description: "", category: "", tags: "" }); }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><IcoUpload /> Загрузить</span>
          </Button>
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Search */}
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}>
              <IcoSearch />
            </span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск..."
              style={{ width: "100%", paddingLeft: 34, boxSizing: "border-box" }}
            />
          </div>

          {/* Category */}
          {categories.length > 0 && (
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ width: 160 }}>
              <option value="">Все категории</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          {/* Sort */}
          <select value={sortBy} onChange={e => setSortBy(e.target.value as "date" | "name" | "size")} style={{ width: 140 }}>
            <option value="date">По дате</option>
            <option value="name">По названию</option>
            <option value="size">По размеру</option>
          </select>

          {/* View toggle */}
          <div style={{ display: "flex", border: "1.5px solid var(--border)", borderRadius: 8, overflow: "hidden", marginLeft: "auto" }}>
            {(["grid", "list"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                title={mode === "grid" ? "Плитка" : "Список"}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 34, height: 32, border: "none", cursor: "pointer",
                  background: viewMode === mode ? "var(--primary)" : "var(--bg-secondary)",
                  color: viewMode === mode ? "white" : "var(--text-muted)",
                  transition: "all 0.12s",
                }}
              >
                {mode === "grid" ? <IcoGrid /> : <IcoList />}
              </button>
            ))}
          </div>
        </div>

        {/* Type pills */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TYPE_PILLS.map(p => {
            const cfg = p.value ? getConfig(p.value) : null;
            const active = typeFilter === p.value;
            return (
              <button
                key={p.value}
                onClick={() => setTypeFilter(p.value)}
                style={{
                  padding: "4px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500,
                  border: `1.5px solid ${active ? (cfg?.color || "var(--primary)") : "var(--border)"}`,
                  background: active ? (cfg ? cfg.color + "18" : "var(--bg-tertiary)") : "transparent",
                  color: active ? (cfg?.color || "var(--primary)") : "var(--text-secondary)",
                  cursor: "pointer", transition: "all 0.12s",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {fetching ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", flexDirection: "column", gap: 12 }}>
            <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Загрузка документов...</div>
          </div>
        ) : sortedDocs.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "80px 20px", gap: 16, color: "var(--text-muted)",
            border: "2px dashed var(--border)", borderRadius: 16,
          }}>
            <svg width={48} height={48} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" style={{ opacity: 0.4 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Файлы не найдены</div>
            <div style={{ fontSize: 13 }}>Загрузите первый документ нажав «Загрузить»</div>
          </div>
        ) : viewMode === "grid" ? (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 14,
          }}>
            {sortedDocs.map(doc => (
              <FileCard key={doc.id} doc={doc} {...handlers(doc)} />
            ))}
          </div>
        ) : (
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Файл", "Категория", "Размер", "Дата", ""].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDocs.map(doc => (
                  <FileRow key={doc.id} doc={doc} {...handlers(doc)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Fullscreen preview ── */}
      {preview && (
        <PreviewOverlay
          doc={preview}
          docs={sortedDocs}
          onClose={() => setPreview(null)}
          onDownload={downloadDoc}
        />
      )}

      {/* ── Upload modal ── */}
      <Modal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Загрузить документ"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowUpload(false)}>Отмена</Button>
            <Button onClick={doUpload} loading={uploading}>Загрузить</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {uploadError && (
            <div style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", padding: "8px 12px", borderRadius: 8 }}>{uploadError}</div>
          )}

          {/* Drop zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFilePick(f); }}
            style={{
              border: `2px dashed ${dragOver ? "var(--primary)" : "var(--border)"}`,
              borderRadius: 12, padding: "32px 20px", textAlign: "center", cursor: "pointer",
              background: dragOver ? "var(--bg-tertiary)" : "transparent",
              transition: "all 0.15s",
            }}
          >
            {uploadFile ? (
              <div>
                <div style={{ fontSize: 36, marginBottom: 8 }}>
                  {(() => { const cfg = getConfig(uploadFile.name.split(".").pop() || ""); return cfg.icon || <span style={{ color: cfg.color, fontWeight: 800 }}>{cfg.label}</span>; })()}
                </div>
                <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{uploadFile.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{fmtSize(uploadFile.size)}</div>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 10 }}>
                  <svg width={36} height={36} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} viewBox="0 0 24 24" style={{ display: "inline-block" }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                  </svg>
                </div>
                <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 500 }}>Перетащите файл или нажмите для выбора</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>PDF, DOCX, XLSX, XLS, TXT, JPG, PNG, GIF, MP4</div>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.jpg,.jpeg,.png,.gif,.mp4"
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }}
          />

          {[
            { label: "Название *", key: "name", placeholder: "Название документа" },
            { label: "Описание", key: "description", placeholder: "Краткое описание" },
            { label: "Категория", key: "category", placeholder: "Например: Договоры, Инструкции..." },
            { label: "Теги", key: "tags", placeholder: "тег1, тег2, тег3" },
          ].map(f => (
            <div key={f.key}>
              <label>{f.label}</label>
              <input
                value={(uploadForm as Record<string, string>)[f.key]}
                onChange={e => setUploadForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>
      </Modal>

      {/* ── Edit metadata modal ── */}
      <Modal
        open={showEditMeta}
        onClose={() => setShowEditMeta(false)}
        title="Редактировать данные"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEditMeta(false)}>Отмена</Button>
            <Button onClick={doSaveMeta} loading={metaSaving}>Сохранить</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {metaError && <div style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", padding: "8px 12px", borderRadius: 8 }}>{metaError}</div>}
          {[
            { label: "Название *", key: "name" },
            { label: "Описание", key: "description" },
            { label: "Категория", key: "category" },
            { label: "Теги (через запятую)", key: "tags" },
          ].map(f => (
            <div key={f.key}>
              <label>{f.label}</label>
              <input
                value={(metaForm as Record<string, string>)[f.key]}
                onChange={e => setMetaForm(p => ({ ...p, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </Modal>


      {/* ── Convert modal ── */}
      <Modal
        open={showConvert}
        onClose={() => setShowConvert(false)}
        title="Конвертировать документ"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowConvert(false)}>Отмена</Button>
            <Button onClick={doConvert} disabled={!convertTo}>Скачать</Button>
          </>
        }
      >
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", background: "var(--bg-tertiary)", borderRadius: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: getConfig(selected.file_type).bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: getConfig(selected.file_type).color }}>{getConfig(selected.file_type).label}</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{selected.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtSize(selected.file_size)}</div>
              </div>
            </div>
            <div>
              <label>Конвертировать в:</label>
              <select value={convertTo} onChange={e => setConvertTo(e.target.value)}>
                {(CONVERT_OPTIONS[selected.file_type] || []).map(opt => (
                  <option key={opt} value={opt}>{opt.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Конвертация сохраняет текстовое содержимое. Оригинальный файл не изменяется.
            </div>
          </div>
        )}
      </Modal>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </AppLayout>
  );
}
