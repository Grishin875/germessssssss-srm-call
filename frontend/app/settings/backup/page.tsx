"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { AppLayout } from "../../../components/layout/AppLayout";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { toast } from "../../../components/ui/Toast";
import { api } from "../../../lib/api";

const CONFIG_VERSION = 1;

// Справочники конфигурации: ключ → загрузка + создание.
const SECTIONS: {
  key: string;
  label: string;
  load: () => Promise<unknown[]>;
  create: (item: Record<string, unknown>) => Promise<unknown>;
}[] = [
  { key: "stage_types",        label: "Типы этапов",        load: () => api.getStageTypes(),       create: (i) => api.createStageType(i) },
  { key: "system_roles",       label: "Роли",               load: () => api.getSystemRoles(),      create: (i) => api.createSystemRole(i) },
  { key: "order_statuses",     label: "Статусы заказов",    load: () => api.getOrderStatuses(),    create: (i) => api.createOrderStatus(i) },
  { key: "status_transitions", label: "Переходы статусов",  load: () => api.getStatusTransitions(), create: (i) => api.createStatusTransition(i as { from_status: string; to_status: string; allowed_roles?: string[] }) },
  { key: "priorities",         label: "Приоритеты",         load: () => api.getPriorities(),       create: (i) => api.createPriority(i) },
  { key: "sla_rules",          label: "SLA-правила",        load: () => api.getSlaRules(),          create: (i) => api.createSlaRule(i) },
  { key: "custom_fields",      label: "Кастомные поля",     load: () => api.getCustomFieldDefs(),   create: (i) => api.createCustomFieldDef(i) },
];

export default function BackupPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  // Подсчёт текущих записей
  useEffect(() => {
    if (!user) return;
    SECTIONS.forEach(async (s) => {
      try { const rows = await s.load(); setCounts(c => ({ ...c, [s.key]: rows.length })); } catch {}
    });
  }, [user]);

  if (loading || !user) return null;
  if (user.role !== "admin") {
    return <AppLayout><div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Доступно только администратору</div></AppLayout>;
  }

  async function doExport() {
    setExporting(true);
    try {
      const data: Record<string, unknown> = { _version: CONFIG_VERSION, _exported_at: new Date().toISOString(), _by: user!.username };
      for (const s of SECTIONS) {
        try { data[s.key] = await s.load(); } catch { data[s.key] = []; }
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `germess_config_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Конфигурация экспортирована");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Ошибка экспорта");
    }
    setExporting(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = "";
    if (!file) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast.error("Некорректный JSON-файл");
      return;
    }
    if (typeof parsed._version !== "number") {
      toast.error("Это не файл конфигурации Germess");
      return;
    }
    if (!confirm("Импортировать конфигурацию? Существующие записи с такими же кодами будут пропущены, новые — добавлены.")) return;

    setImporting(true);
    setLog([]);
    const newLog: string[] = [];
    for (const s of SECTIONS) {
      const items = parsed[s.key];
      if (!Array.isArray(items)) continue;
      let ok = 0, skip = 0;
      for (const raw of items) {
        const item = { ...(raw as Record<string, unknown>) };
        delete item.id; delete item.created_at; delete item.updated_at;
        try { await s.create(item); ok++; }
        catch { skip++; }
      }
      newLog.push(`${s.label}: добавлено ${ok}, пропущено ${skip}`);
      setLog([...newLog]);
    }
    setImporting(false);
    toast.success("Импорт завершён");
    // Обновить счётчики
    SECTIONS.forEach(async (s) => {
      try { const rows = await s.load(); setCounts(c => ({ ...c, [s.key]: rows.length })); } catch {}
    });
  }

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 720 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button variant="ghost" size="sm" onClick={() => router.push("/settings")}>← Настройки</Button>
          <div>
            <h1 style={{ margin: 0 }}>Резервная копия конфигурации</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Перенос справочников, ролей и воркфлоу между окружениями
            </p>
          </div>
        </div>

        <Card title="Что входит в копию">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {SECTIONS.map(s => (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "var(--bg-secondary)", fontSize: 13 }}>
                <span>{s.label}</span>
                <span style={{ fontWeight: 700, color: "var(--primary)" }}>{counts[s.key] ?? "…"}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Экспорт">
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
            Скачать всю конфигурацию одним JSON-файлом для бэкапа или переноса.
          </p>
          <Button onClick={doExport} loading={exporting}>⬇ Скачать конфигурацию (JSON)</Button>
        </Card>

        <Card title="Импорт">
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
            Загрузить ранее сохранённый JSON. Дубликаты по коду пропускаются, новые записи добавляются.
            Существующие настройки не удаляются.
          </p>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={importing}>⬆ Импортировать из JSON</Button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} style={{ display: "none" }} />
          {log.length > 0 && (
            <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: "var(--bg-secondary)", fontSize: 12.5, fontFamily: "monospace", display: "flex", flexDirection: "column", gap: 4 }}>
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
