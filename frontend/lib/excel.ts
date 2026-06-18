// Утилиты для работы с Excel (.xlsx) на стороне браузера.
// Используется SheetJS (xlsx). Импорт динамический — библиотека грузится
// только когда пользователь реально нажимает «Экспорт» / «Импорт»,
// чтобы не раздувать стартовый бандл.

export type Row = Record<string, string | number | boolean | null | undefined>;

/** Экспорт массива объектов в .xlsx с автонастройкой ширины колонок. */
export async function exportToExcel(
  rows: Row[],
  fileName: string,
  sheetName = "Данные"
): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);

  // Авто-ширина колонок по содержимому
  if (rows.length) {
    const keys = Object.keys(rows[0]);
    ws["!cols"] = keys.map((k) => {
      const maxLen = Math.max(
        k.length,
        ...rows.map((r) => String(r[k] ?? "").length)
      );
      return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileName}_${stamp}.xlsx`);
}

/** Чтение первого листа .xlsx/.csv в массив объектов (ключи = заголовки). */
export async function parseExcelFile(file: File): Promise<Row[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: "" });
}

/** Сгенерировать и скачать .xlsx-шаблон с заданными заголовками и примером строки. */
export async function downloadTemplate(
  headers: string[],
  fileName: string,
  example?: Row
): Promise<void> {
  const XLSX = await import("xlsx");
  const row: Row = {};
  headers.forEach((h) => (row[h] = example?.[h] ?? ""));
  const ws = XLSX.utils.json_to_sheet([row]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, 16) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Шаблон");
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}
