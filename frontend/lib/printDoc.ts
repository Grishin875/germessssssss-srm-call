// Генерация печатных документов (маршрутный лист, акт) через окно печати браузера.
// Браузер позволяет «Сохранить как PDF» — это даёт PDF без тяжёлых зависимостей.

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}

export interface RouteSheetData {
  orderId: number;
  productName: string;
  plannedQty: number;
  priority?: string;
  deadline?: string;
  department?: string;
  comment?: string;
  createdAt?: string;
  stages: { idx: number; name: string; type: string; status: string; assignees: string[] }[];
}

/** Подстановка переменных вида {{key}} в строку шаблона. */
export function applyTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(vars[k] ?? ""));
}

function openPrintWindow(title: string, bodyHtml: string) {
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .muted { color: #666; font-size: 13px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 18px 0; font-size: 14px; }
    .meta div { display: flex; justify-content: space-between; border-bottom: 1px dotted #ccc; padding: 4px 0; }
    .meta dt { color: #666; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { border: 1px solid #ccc; padding: 7px 9px; text-align: left; }
    th { background: #f3f4f6; }
    .sign { margin-top: 48px; display: flex; justify-content: space-between; font-size: 13px; }
    .sign div { width: 45%; border-top: 1px solid #333; padding-top: 6px; text-align: center; }
    @media print { body { margin: 12mm; } .noprint { display: none; } }
    .btn { background: #4f46e5; color: #fff; border: none; padding: 9px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  </style></head><body>
  <div class="noprint" style="margin-bottom:16px"><button class="btn" onclick="window.print()">🖨 Печать / Сохранить PDF</button></div>
  ${bodyHtml}
  <script>setTimeout(()=>window.print(), 350)</script>
  </body></html>`);
  w.document.close();
}

export function printRouteSheet(d: RouteSheetData) {
  const rows = d.stages.map(s => `<tr>
    <td>${s.idx}</td>
    <td>${esc(s.name)}</td>
    <td>${esc(s.type)}</td>
    <td>${esc(s.assignees.join(", ") || "—")}</td>
    <td>${esc(s.status)}</td>
    <td style="width:90px"></td>
  </tr>`).join("");

  const body = `
    <h1>Маршрутный лист №${d.orderId}</h1>
    <div class="muted">Дата печати: ${new Date().toLocaleString("ru")}</div>
    <div class="meta">
      <div><dt>Изделие</dt><dd><b>${esc(d.productName)}</b></dd></div>
      <div><dt>Количество</dt><dd>${esc(d.plannedQty)} шт</dd></div>
      <div><dt>Приоритет</dt><dd>${esc(d.priority || "—")}</dd></div>
      <div><dt>Срок</dt><dd>${d.deadline ? esc(new Date(d.deadline).toLocaleDateString("ru")) : "—"}</dd></div>
      <div><dt>Отдел</dt><dd>${esc(d.department || "—")}</dd></div>
      <div><dt>Создан</dt><dd>${d.createdAt ? esc(new Date(d.createdAt).toLocaleDateString("ru")) : "—"}</dd></div>
    </div>
    ${d.comment ? `<div class="muted">Комментарий: ${esc(d.comment)}</div>` : ""}
    <table>
      <thead><tr><th>#</th><th>Этап</th><th>Тип</th><th>Исполнитель</th><th>Статус</th><th>Отметка</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888">Этапы не заданы</td></tr>'}</tbody>
    </table>
    <div class="sign">
      <div>Сдал (Ф.И.О., подпись)</div>
      <div>Принял ОТК (Ф.И.О., подпись)</div>
    </div>`;
  openPrintWindow(`Маршрутный лист №${d.orderId}`, body);
}
