"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { DocFile } from "../../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheet helpers
// ─────────────────────────────────────────────────────────────────────────────
function parseHtmlTable(html: string): string[][] {
  if (typeof document === "undefined") return [[""]];
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const rows = wrap.querySelectorAll("tr");
  if (rows.length === 0) {
    // treat as plain text rows
    return html.split("\n").map(r => r.split("\t").map(c => c.trim()));
  }
  return Array.from(rows).map(tr =>
    Array.from(tr.querySelectorAll("td,th")).map(td => td.textContent ?? "")
  );
}

function gridToHtml(grid: string[][], headers: string[]): string {
  const ths = headers.map(h => `<th style="background:#f1f5f9;padding:6px 10px;border:1px solid #cbd5e1;font-weight:600;text-align:left">${h}</th>`).join("");
  const trs = grid.map(row =>
    `<tr>${row.map(cell => `<td style="padding:5px 10px;border:1px solid #e2e8f0">${cell}</td>`).join("")}</tr>`
  ).join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:13px">\n<thead><tr>${ths}</tr></thead>\n<tbody>${trs}</tbody>\n</table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheet editor
// ─────────────────────────────────────────────────────────────────────────────
interface SpreadsheetEditorProps {
  content: string;
  onChange: (html: string) => void;
}

function SpreadsheetEditor({ content, onChange }: SpreadsheetEditorProps) {
  const rawGrid = parseHtmlTable(content);
  const hasHeader = content.includes("<th");
  const [headers, setHeaders] = useState<string[]>(() =>
    hasHeader
      ? Array.from(
          (() => { const d = document.createElement("div"); d.innerHTML = content; return d.querySelectorAll("th"); })()
        ).map(th => th.textContent ?? "")
      : rawGrid[0] ?? []
  );
  const [grid, setGrid] = useState<string[][]>(() => hasHeader ? rawGrid : rawGrid.slice(1));
  const [sel, setSel] = useState<[number, number] | null>(null);

  const emit = useCallback((g: string[][], h: string[]) => {
    onChange(gridToHtml(g, h));
  }, [onChange]);

  function cellChange(r: number, c: number, val: string) {
    const g = grid.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? val : cell)));
    setGrid(g);
    emit(g, headers);
  }

  function headerChange(c: number, val: string) {
    const h = headers.map((v, i) => (i === c ? val : v));
    setHeaders(h);
    emit(grid, h);
  }

  function addRow() {
    const g = [...grid, Array(headers.length).fill("")];
    setGrid(g); emit(g, headers);
  }

  function addCol() {
    const h = [...headers, `Столбец ${headers.length + 1}`];
    const g = grid.map(r => [...r, ""]);
    setHeaders(h); setGrid(g); emit(g, h);
  }

  function deleteRow(r: number) {
    const g = grid.filter((_, i) => i !== r);
    setGrid(g); emit(g, headers);
  }

  function deleteCol(c: number) {
    const h = headers.filter((_, i) => i !== c);
    const g = grid.map(row => row.filter((_, i) => i !== c));
    setHeaders(h); setGrid(g); emit(g, h);
  }

  const inputStyle = (active: boolean): React.CSSProperties => ({
    width: "100%", minWidth: 80, padding: "5px 8px", border: "none",
    outline: active ? "2px solid #3b82f6" : "none",
    background: active ? "#eff6ff" : "transparent",
    fontSize: 13, color: "#1e293b", fontFamily: "inherit",
    boxSizing: "border-box" as const,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, padding: "8px 12px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", flexShrink: 0 }}>
        <SheetBtn icon="➕ Строку" title="Добавить строку" onClick={addRow} />
        <SheetBtn icon="➕ Столбец" title="Добавить столбец" onClick={addCol} />
        <div style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8, display: "flex", alignItems: "center" }}>
          {grid.length} стр. × {headers.length} ст.
        </div>
      </div>

      {/* Table */}
      <div style={{ overflow: "auto", flex: 1 }}>
        <table style={{ borderCollapse: "collapse", minWidth: "100%", fontSize: 13 }}>
          {/* Header */}
          <thead>
            <tr>
              <th style={{ width: 36, background: "#f1f5f9", borderRight: "1px solid #e2e8f0", borderBottom: "1px solid #cbd5e1" }} />
              {headers.map((h, c) => (
                <th key={c} style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", padding: 0, fontWeight: 600, minWidth: 100, position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <input
                      value={h}
                      onChange={e => headerChange(c, e.target.value)}
                      onFocus={() => setSel([-1, c])}
                      style={{ ...inputStyle(sel?.[0] === -1 && sel?.[1] === c), fontWeight: 600, background: "#f1f5f9" }}
                    />
                    <button
                      onClick={() => deleteCol(c)}
                      title="Удалить столбец"
                      style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 3, border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", fontSize: 11, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 2 }}
                    >✕</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r} style={{ background: r % 2 === 0 ? "white" : "#fafafa" }}>
                {/* Row number + delete */}
                <td style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", background: "#f8fafc", border: "1px solid #e2e8f0", width: 36, userSelect: "none" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                    <span>{r + 1}</span>
                    <button
                      onClick={() => deleteRow(r)}
                      title="Удалить строку"
                      style={{ width: 14, height: 14, borderRadius: 2, border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", fontSize: 10, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >✕</button>
                  </div>
                </td>
                {row.map((cell, c) => (
                  <td key={c} style={{ border: "1px solid #e2e8f0", padding: 0 }}>
                    <input
                      value={cell}
                      onChange={e => cellChange(r, c, e.target.value)}
                      onFocus={() => setSel([r, c])}
                      onKeyDown={e => {
                        if (e.key === "Tab") { e.preventDefault(); setSel([r, Math.min(c + 1, row.length - 1)]); }
                        if (e.key === "Enter") { e.preventDefault(); setSel([Math.min(r + 1, grid.length - 1), c]); }
                      }}
                      style={inputStyle(sel?.[0] === r && sel?.[1] === c)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SheetBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 12, color: "#374151", display: "flex", alignItems: "center", gap: 4 }}
    >{icon}</button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rich text toolbar helpers
// ─────────────────────────────────────────────────────────────────────────────
function execCmd(cmd: string, val?: string) {
  document.execCommand(cmd, false, val);
}

function ToolBtn({
  onClick, title, active, children, danger,
}: {
  onClick: () => void; title: string; active?: boolean; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minWidth: 28, height: 28, padding: "0 4px", borderRadius: 5, border: "none",
        background: active ? "#3b82f620" : "transparent",
        color: active ? "#2563eb" : danger ? "#dc2626" : "#374151",
        cursor: "pointer", fontSize: 13, transition: "background 0.1s",
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 20, background: "#e2e8f0", margin: "0 2px", flexShrink: 0 }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Word count helper
// ─────────────────────────────────────────────────────────────────────────────
function countWords(el: HTMLElement | null) {
  if (!el) return { words: 0, chars: 0 };
  const text = el.innerText || "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { words, chars: text.replace(/\s/g, "").length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main FileEditor component
// ─────────────────────────────────────────────────────────────────────────────
interface Props {
  doc: DocFile;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
}

const SHEET_TYPES = ["xlsx", "xls"];

export function FileEditor({ doc, onClose, onSave }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const handleSaveRef = useRef<() => void>(() => {});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [wc, setWc] = useState({ words: 0, chars: 0 });
  const [sheetContent, setSheetContent] = useState<string>(doc.content || "");
  const isSheet = SHEET_TYPES.includes(doc.file_type.toLowerCase());

  // colors
  const [textColor, setTextColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffff00");

  // link insert
  const [showLinkDlg, setShowLinkDlg] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [savedRange, setSavedRange] = useState<Range | null>(null);

  // table insert
  const [showTableDlg, setShowTableDlg] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);

  useEffect(() => {
    if (!isSheet && editorRef.current) {
      editorRef.current.innerHTML = (doc.content || "").replace(/\n/g, "<br>");
      updateWc();
    }
  }, [doc.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSaveRef.current(); }
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = ""; };
  }, []);

  function updateWc() { setWc(countWords(editorRef.current)); }

  async function handleSave() {
    setSaving(true); setSaveStatus("saving");
    try {
      const html = isSheet ? sheetContent : (editorRef.current?.innerHTML ?? "");
      await onSave(html);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
    }
    setSaving(false);
  }

  // keep ref always pointing to latest handleSave (fixes stale closure in keydown handler)
  handleSaveRef.current = handleSave;

  function insertTable() {
    const rows = Array.from({ length: tableRows }, () =>
      `<tr>${Array.from({ length: tableCols }, () => "<td style='padding:6px 10px;border:1px solid #cbd5e1;min-width:80px'>&nbsp;</td>").join("")}</tr>`
    ).join("");
    const html = `<table style="border-collapse:collapse;margin:12px 0">${rows}</table><p><br></p>`;
    execCmd("insertHTML", html);
    setShowTableDlg(false);
  }

  function insertLink() {
    if (!savedRange) return;
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(savedRange); }
    execCmd("createLink", linkUrl);
    setShowLinkDlg(false); setLinkUrl("https://");
  }

  function saveSelRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) setSavedRange(sel.getRangeAt(0).cloneRange());
  }

  const cfg = FILE_CONFIG_MAP[doc.file_type.toLowerCase()] || { color: "#475569", label: doc.file_type.toUpperCase() };

  return (
    <div style={{ width: "100%", height: "100%", background: "white", display: "flex", flexDirection: "column", fontFamily: "system-ui,sans-serif", overflow: "hidden" }}>
      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "0 16px",
        height: 52, borderBottom: "1px solid #e2e8f0", background: "#fff", flexShrink: 0,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      }}>
        {/* File badge */}
        <div style={{ width: 34, height: 34, borderRadius: 7, background: cfg.color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color }}>{cfg.label}</span>
        </div>

        {/* File name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{doc.file_name}</div>
        </div>

        {/* Save status */}
        <div style={{ fontSize: 12, color: saveStatus === "saved" ? "#16a34a" : saveStatus === "error" ? "#dc2626" : saveStatus === "saving" ? "#2563eb" : "#94a3b8", minWidth: 80, textAlign: "right" }}>
          {saveStatus === "saving" && "Сохранение..."}
          {saveStatus === "saved" && "✓ Сохранено"}
          {saveStatus === "error" && "Ошибка сохранения"}
          {saveStatus === "idle" && <span style={{ fontSize: 11 }}>Ctrl+S — сохранить</span>}
        </div>

        {/* Buttons */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "7px 18px", borderRadius: 8, border: "none",
            background: saving ? "#93c5fd" : "#2563eb", color: "white",
            cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-8H7v8M7 3v5h8"/>
          </svg>
          Сохранить
        </button>
        <button
          onClick={onClose}
          style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid #e2e8f0", background: "transparent", cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {/* ── Toolbar (only for non-sheet) ── */}
      {!isSheet && (
        <div style={{
          display: "flex", alignItems: "center", gap: 2, padding: "0 12px",
          borderBottom: "1px solid #e2e8f0", background: "#fafafa", flexShrink: 0,
          overflowX: "auto", height: 40, minHeight: 40,
        }}>
          {/* Undo / Redo */}
          <ToolBtn onClick={() => execCmd("undo")} title="Отменить (Ctrl+Z)">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4"/></svg>
          </ToolBtn>
          <ToolBtn onClick={() => execCmd("redo")} title="Повторить (Ctrl+Y)">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11A6 6 0 006 16v2M21 10l-4-4M21 10l-4 4"/></svg>
          </ToolBtn>

          <Sep />

          {/* Paragraph style */}
          <select
            onMouseDown={e => e.preventDefault()}
            onChange={e => { execCmd("formatBlock", e.target.value); e.target.value = "p"; }}
            defaultValue="p"
            style={{ height: 26, fontSize: 12, borderRadius: 5, border: "1px solid #e2e8f0", background: "white", color: "#374151", padding: "0 4px", cursor: "pointer", flexShrink: 0, width: 110, display: "block", alignSelf: "center" }}
          >
            <option value="p">Обычный</option>
            <option value="h1">Заголовок 1</option>
            <option value="h2">Заголовок 2</option>
            <option value="h3">Заголовок 3</option>
            <option value="h4">Заголовок 4</option>
            <option value="blockquote">Цитата</option>
            <option value="pre">Код</option>
          </select>

          {/* Font size */}
          <select
            onMouseDown={e => e.preventDefault()}
            onChange={e => { execCmd("fontSize", e.target.value); e.target.value = "3"; }}
            defaultValue="3"
            style={{ height: 26, fontSize: 12, borderRadius: 5, border: "1px solid #e2e8f0", background: "white", color: "#374151", padding: "0 4px", cursor: "pointer", flexShrink: 0, width: 100, display: "block", alignSelf: "center" }}
          >
            <option value="1">Мелкий (8pt)</option>
            <option value="2">Маленький (10pt)</option>
            <option value="3">Обычный (12pt)</option>
            <option value="4">Средний (14pt)</option>
            <option value="5">Большой (18pt)</option>
            <option value="6">Крупный (24pt)</option>
            <option value="7">Огромный (36pt)</option>
          </select>

          <Sep />

          {/* Basic formats */}
          <ToolBtn onClick={() => execCmd("bold")} title="Жирный (Ctrl+B)"><b style={{ fontSize: 13 }}>B</b></ToolBtn>
          <ToolBtn onClick={() => execCmd("italic")} title="Курсив (Ctrl+I)"><i style={{ fontSize: 13 }}>I</i></ToolBtn>
          <ToolBtn onClick={() => execCmd("underline")} title="Подчёркнутый (Ctrl+U)"><u style={{ fontSize: 12 }}>U</u></ToolBtn>
          <ToolBtn onClick={() => execCmd("strikeThrough")} title="Зачёркнутый"><s style={{ fontSize: 12 }}>S</s></ToolBtn>
          <ToolBtn onClick={() => execCmd("superscript")} title="Верхний индекс"><sup style={{ fontSize: 10 }}>A²</sup></ToolBtn>
          <ToolBtn onClick={() => execCmd("subscript")} title="Нижний индекс"><sub style={{ fontSize: 10 }}>A₂</sub></ToolBtn>

          <Sep />

          {/* Colors */}
          <div title="Цвет текста" style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <ToolBtn onClick={() => execCmd("foreColor", textColor)} title="Применить цвет текста">
              <span style={{ fontSize: 13, fontWeight: 700, borderBottom: `3px solid ${textColor}`, lineHeight: 1 }}>A</span>
            </ToolBtn>
            <input
              type="color" value={textColor}
              onChange={e => setTextColor(e.target.value)}
              style={{ width: 18, height: 18, border: "none", padding: 0, cursor: "pointer", borderRadius: 3, background: "transparent" }}
              title="Выбрать цвет текста"
            />
          </div>
          <div title="Цвет выделения" style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <ToolBtn onClick={() => execCmd("hiliteColor", bgColor)} title="Применить выделение">
              <span style={{ fontSize: 12, background: bgColor, padding: "1px 3px", borderRadius: 2 }}>ab</span>
            </ToolBtn>
            <input
              type="color" value={bgColor}
              onChange={e => setBgColor(e.target.value)}
              style={{ width: 18, height: 18, border: "none", padding: 0, cursor: "pointer", borderRadius: 3, background: "transparent" }}
              title="Выбрать цвет выделения"
            />
          </div>

          <Sep />

          {/* Alignment */}
          <ToolBtn onClick={() => execCmd("justifyLeft")} title="По левому краю">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
          </ToolBtn>
          <ToolBtn onClick={() => execCmd("justifyCenter")} title="По центру">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
          </ToolBtn>
          <ToolBtn onClick={() => execCmd("justifyRight")} title="По правому краю">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
          </ToolBtn>
          <ToolBtn onClick={() => execCmd("justifyFull")} title="По ширине">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </ToolBtn>

          <Sep />

          {/* Lists */}
          <ToolBtn onClick={() => execCmd("insertUnorderedList")} title="Маркированный список">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
          </ToolBtn>
          <ToolBtn onClick={() => execCmd("insertOrderedList")} title="Нумерованный список">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h1v4M4 12h2l-2 4h2"/></svg>
          </ToolBtn>

          {/* Indent */}
          <ToolBtn onClick={() => execCmd("indent")} title="Отступ вправо">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><path strokeLinecap="round" strokeLinejoin="round" d="M3 9l4 3-4 3"/></svg>
          </ToolBtn>
          <ToolBtn onClick={() => execCmd("outdent")} title="Отступ влево">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/><path strokeLinecap="round" strokeLinejoin="round" d="M7 9l-4 3 4 3"/></svg>
          </ToolBtn>

          <Sep />

          {/* Insert Link */}
          <ToolBtn onClick={() => { saveSelRange(); setShowLinkDlg(true); }} title="Вставить ссылку">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path strokeLinecap="round" strokeLinejoin="round" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          </ToolBtn>
          <ToolBtn onClick={() => execCmd("unlink")} title="Убрать ссылку">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path strokeLinecap="round" strokeLinejoin="round" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/><line x1="4" y1="4" x2="20" y2="20" strokeWidth={2}/></svg>
          </ToolBtn>

          {/* Insert HR */}
          <ToolBtn onClick={() => execCmd("insertHorizontalRule")} title="Горизонтальная линия">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="10" y2="6"/><line x1="3" y1="18" x2="10" y2="18"/></svg>
          </ToolBtn>

          {/* Insert Table */}
          <ToolBtn onClick={() => setShowTableDlg(true)} title="Вставить таблицу">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
          </ToolBtn>

          <Sep />

          {/* Remove format */}
          <ToolBtn onClick={() => execCmd("removeFormat")} title="Убрать форматирование" danger>
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.5 10.667A2 2 0 1013.333 13.5M6.53 6.53A9 9 0 0117.47 17.47"/></svg>
          </ToolBtn>
        </div>
      )}

      {/* ── Editor body ── */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", background: "#f0f2f5", minHeight: 0 }}>
        {isSheet ? (
          <div style={{ height: "100%", background: "white" }}>
            <SpreadsheetEditor
              content={doc.content || ""}
              onChange={setSheetContent}
            />
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", padding: "32px 24px", boxSizing: "border-box" }}>
            <div style={{
              width: "100%", maxWidth: 820,
              background: "white",
              borderRadius: 4,
              boxShadow: "0 2px 16px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.06)",
              padding: "60px 72px",
              boxSizing: "border-box",
            }}>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={updateWc}
                style={{
                  outline: "none",
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: "#1e293b",
                  minHeight: 400,
                  fontFamily: "'Georgia', serif",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      {!isSheet && (
        <div style={{
          display: "flex", alignItems: "center", gap: 16, padding: "4px 16px",
          borderTop: "1px solid #e2e8f0", background: "#fafafa", fontSize: 11, color: "#94a3b8", flexShrink: 0,
        }}>
          <span>Слов: <b style={{ color: "#64748b" }}>{wc.words}</b></span>
          <span>Символов: <b style={{ color: "#64748b" }}>{wc.chars}</b></span>
          <span style={{ marginLeft: "auto" }}>{doc.file_type.toUpperCase()}</span>
        </div>
      )}

      {/* ── Link dialog ── */}
      {showLinkDlg && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10002, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: 12, padding: 24, width: 380, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#1e293b" }}>Вставить ссылку</div>
            <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 4 }}>URL</label>
            <input
              autoFocus
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") insertLink(); if (e.key === "Escape") setShowLinkDlg(false); }}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 13 }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setShowLinkDlg(false)} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 13 }}>Отмена</button>
              <button onClick={insertLink} style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: "#2563eb", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Вставить</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Table dialog ── */}
      {showTableDlg && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10002, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: 12, padding: 24, width: 320, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "#1e293b" }}>Вставить таблицу</div>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 4 }}>Строки</label>
                <input type="number" min={1} max={20} value={tableRows} onChange={e => setTableRows(Number(e.target.value))}
                  style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 13 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "#64748b", display: "block", marginBottom: 4 }}>Столбцы</label>
                <input type="number" min={1} max={20} value={tableCols} onChange={e => setTableCols(Number(e.target.value))}
                  style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: "1.5px solid #e2e8f0", fontSize: 13 }} />
              </div>
            </div>
            {/* Preview */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                {Array.from({ length: Math.min(tableRows, 4) }, (_, r) => (
                  <tr key={r}>
                    {Array.from({ length: Math.min(tableCols, 5) }, (_, c) => (
                      <td key={c} style={{ border: "1px solid #e2e8f0", padding: "4px 8px", fontSize: 11, color: "#94a3b8" }}>
                        {r === 0 ? `Кол. ${c + 1}` : "\u00A0"}
                      </td>
                    ))}
                  </tr>
                ))}
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowTableDlg(false)} style={{ padding: "7px 16px", borderRadius: 7, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 13 }}>Отмена</button>
              <button onClick={insertTable} style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: "#2563eb", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Вставить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal color map needed by this component
// ─────────────────────────────────────────────────────────────────────────────
const FILE_CONFIG_MAP: Record<string, { color: string; label: string }> = {
  pdf:  { color: "#dc2626", label: "PDF" },
  docx: { color: "#2563eb", label: "DOCX" },
  doc:  { color: "#2563eb", label: "DOC" },
  xlsx: { color: "#16a34a", label: "XLSX" },
  xls:  { color: "#16a34a", label: "XLS" },
  txt:  { color: "#475569", label: "TXT" },
};
