"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { api, OperatorStats, DocFile } from "../../lib/api";

type RegulationProblem = { id: number; product: string; problem: string; solution: string };

const DEPT_COLORS: Record<string, string> = {
  "СМД":           "#8b5cf6",
  "Монтаж":        "#0ea5e9",
  "3D Печать":     "#10b981",
  "Склад":         "#f59e0b",
  "ОТК":           "#ef4444",
  "Отгрузка":      "#6366f1",
  "Администрация": "#6b7280",
};

export default function TrainingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<"materials" | "regulations" | "stats">("materials");
  const [docs, setDocs]           = useState<DocFile[]>([]);
  const [products, setProducts]   = useState<string[]>([]);
  const [problems, setProblems]   = useState<RegulationProblem[]>([]);
  const [stats, setStats]         = useState<OperatorStats[]>([]);
  const [selProduct, setSelProduct] = useState("");
  const [fetching, setFetching]   = useState(false);
  const [statsPeriod, setStatsPeriod] = useState("month");

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => {
    if (!user) return;
    api.getDocuments().then(setDocs).catch(console.error);
    api.getRegulationProducts().then(p => { setProducts(p); if (p.length) setSelProduct(p[0]); }).catch(console.error);
    api.getOperatorsStats(statsPeriod).then(setStats).catch(console.error);
  }, [user]);

  useEffect(() => {
    if (!selProduct) return;
    setFetching(true);
    api.getRegulationProblems(selProduct).then(p => { setProblems(p as RegulationProblem[]); }).catch(console.error).finally(() => setFetching(false));
  }, [selProduct]);

  useEffect(() => {
    api.getOperatorsStats(statsPeriod).then(setStats).catch(console.error);
  }, [statsPeriod]);

  if (loading || !user) return null;

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer",
    fontWeight: 600, fontSize: 13, transition: "all 0.15s",
    background: tab === t ? "var(--primary)" : "transparent",
    color: tab === t ? "#fff" : "var(--text-secondary)",
  });

  // Group docs by category
  const grouped: Record<string, DocFile[]> = {};
  docs.forEach(d => {
    const cat = d.category || "Общее";
    (grouped[cat] = grouped[cat] || []).push(d);
  });

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div>
          <h1 style={{ margin: 0 }}>Учебный центр</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            Обучение, регламенты и статистика сотрудников
          </p>
        </div>

        {/* Department quick-links */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {Object.entries(DEPT_COLORS).map(([dept, color]) => (
            <div key={dept} style={{
              padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600,
              background: color + "18", color, border: `1px solid ${color}35`, cursor: "default",
            }}>{dept}</div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: "var(--bg-secondary)", padding: 3, borderRadius: 9, width: "fit-content" }}>
          <button style={tabStyle("materials")}   onClick={() => setTab("materials")}>📄 Материалы</button>
          <button style={tabStyle("regulations")} onClick={() => setTab("regulations")}>📋 Регламенты</button>
          <button style={tabStyle("stats")}       onClick={() => setTab("stats")}>📊 Статистика</button>
        </div>

        {/* ── Materials ───────────────────────────────────────────────────── */}
        {tab === "materials" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.keys(grouped).length === 0 ? (
              <Card>
                <div style={{ textAlign: "center", padding: 60 }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 15, marginBottom: 8 }}>Материалы ещё не добавлены</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    Загрузите документы в раздел{" "}
                    <button onClick={() => router.push("/documents")}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontWeight: 600, fontSize: 13 }}>
                      Документы
                    </button>
                  </div>
                </div>
              </Card>
            ) : (
              Object.entries(grouped).map(([cat, catDocs]) => (
                <Card key={cat} title={cat}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {catDocs.map(doc => (
                      <div key={doc.id} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 14px", borderRadius: 8,
                        background: "var(--bg-secondary)", border: "1px solid var(--border)",
                      }}>
                        <span style={{ fontSize: 20 }}>
                          {doc.file_type === "pdf" ? "📕" : doc.file_type === "docx" ? "📘" : "📄"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {doc.name}
                          </div>
                          {doc.description && (
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{doc.description}</div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                          <Button size="sm" variant="ghost"
                            onClick={() => window.open(api.documentDownloadUrl(doc.id), "_blank")}>
                            Скачать
                          </Button>
                          <Button size="sm" variant="secondary"
                            onClick={() => router.push(`/documents`)}>
                            Открыть
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {/* ── Regulations ─────────────────────────────────────────────────── */}
        {tab === "regulations" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontWeight: 600, fontSize: 14 }}>Изделие:</label>
              <select value={selProduct} onChange={e => setSelProduct(e.target.value)} style={{ minWidth: 200 }}>
                {products.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>

            {fetching ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка...</div>
            ) : problems.length === 0 ? (
              <Card>
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                  Для этого изделия регламенты не добавлены
                </div>
              </Card>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {problems.map((p, idx) => (
                  <Card key={p.id}>
                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                        background: "#ef444415", color: "#ef4444",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: 13,
                      }}>{idx + 1}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
                            Проблема
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{p.problem}</div>
                        </div>
                        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#10b98110", border: "1px solid #10b98125" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#10b981", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
                            Решение
                          </div>
                          <div style={{ fontSize: 14 }}>{p.solution}</div>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Stats ───────────────────────────────────────────────────────── */}
        {tab === "stats" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <label style={{ fontWeight: 600, fontSize: 14 }}>Период:</label>
              <select value={statsPeriod} onChange={e => setStatsPeriod(e.target.value)}>
                <option value="week">Неделя</option>
                <option value="month">Месяц</option>
                <option value="all">Всё время</option>
              </select>
            </div>

            {stats.length === 0 ? (
              <Card><div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Нет данных</div></Card>
            ) : (
              <Card title="Результаты сотрудников">
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        {["#", "Сотрудник", "Роль", "Партий", "Завершено", "Произведено", "Заказов"].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stats.sort((a, b) => b.total_produced - a.total_produced).map((s, idx) => (
                        <tr key={s.employee_id}>
                          <td style={{ color: idx === 0 ? "#f59e0b" : idx === 1 ? "#94a3b8" : idx === 2 ? "#b45309" : "var(--text-muted)", fontWeight: 700 }}>
                            {idx + 1}
                          </td>
                          <td style={{ fontWeight: 600 }}>{s.name}</td>
                          <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.role}</td>
                          <td>{s.batches_count}</td>
                          <td style={{ color: "#10b981", fontWeight: 600 }}>{s.completed_batches}</td>
                          <td style={{ fontWeight: 700 }}>{s.total_produced}</td>
                          <td>{s.completed_orders_count ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
