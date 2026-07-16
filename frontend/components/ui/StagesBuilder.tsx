"use client";
import { SystemRoleItem } from "../../lib/api";

export interface StageRow {
  _key: string;
  stage_name: string;
  stage_type: string;
  required_role: string;
  sort_order: number;
  depends_on_previous: number; // 1=последовательно, 0=параллельно
  components: string[];        // выбранные комплектующие для этапа
  output_name: string;         // что выходит из этапа (полуфабрикат); пусто у последнего = конечный продукт
  instructions?: string;       // ФАЗА 2: инструкция исполнителю (раньше мастер её терял)
}

interface StageType {
  code: string;
  label: string;
  color: string;
  is_active: boolean;
}

interface Props {
  stages: StageRow[];
  onChange: (stages: StageRow[]) => void;
  stageTypes: StageType[];
  systemRoles: SystemRoleItem[];
  availableComponents?: string[]; // список имён компонентов из рецептуры
  productName?: string;           // название изделия — для подсказки «конечный продукт» на последнем этапе
}

function uid() { return Math.random().toString(36).slice(2); }

export function newStageRow(stage_type = "assembly", sort_order = 0, stage_name = "", parallel = false): StageRow {
  return { _key: uid(), stage_name, stage_type, required_role: "", sort_order, depends_on_previous: parallel ? 0 : 1, components: [], output_name: "", instructions: "" };
}

// Group stages by sort_order to show parallel groups
function groupBySortOrder(stages: StageRow[]): { order: number; rows: StageRow[] }[] {
  const map = new Map<number, StageRow[]>();
  stages.forEach(s => {
    if (!map.has(s.sort_order)) map.set(s.sort_order, []);
    map.get(s.sort_order)!.push(s);
  });
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([order, rows]) => ({ order, rows }));
}

export function StagesBuilder({ stages, onChange, stageTypes, systemRoles, availableComponents, productName }: Props) {
  const active = stageTypes.filter(s => s.is_active);
  const maxOrder = stages.length ? Math.max(...stages.map(s => s.sort_order)) : 0;

  function labelOf(code: string) {
    return active.find(t => t.code === code)?.label ?? code;
  }

  function update(key: string, field: keyof StageRow, value: string | number | string[]) {
    onChange(stages.map(s => {
      if (s._key !== key) return s;
      if (field === "stage_type") {
        const oldLabel = labelOf(s.stage_type);
        const autoName = s.stage_name === "" || s.stage_name === oldLabel
          ? labelOf(value as string)
          : s.stage_name;
        return { ...s, stage_type: value as string, stage_name: autoName };
      }
      return { ...s, [field]: value };
    }));
  }

  function toggleComponent(key: string, name: string) {
    const stage = stages.find(s => s._key === key);
    if (!stage) return;
    const cur = stage.components ?? [];
    const next = cur.includes(name) ? cur.filter(c => c !== name) : [...cur, name];
    update(key, "components", next);
  }

  function remove(key: string) {
    onChange(stages.filter(s => s._key !== key));
  }

  function addStage(afterOrder?: number) {
    const maxOrder = stages.length ? Math.max(...stages.map(s => s.sort_order)) : -1;
    const newOrder = afterOrder !== undefined ? afterOrder + 1 : maxOrder + 1;
    const firstType = active[0];
    const shifted = afterOrder !== undefined
      ? stages.map(s => s.sort_order >= newOrder ? { ...s, sort_order: s.sort_order + 1 } : s)
      : stages;
    onChange([...shifted, newStageRow(firstType?.code ?? "assembly", newOrder, firstType?.label ?? "")]);
  }

  function addParallel(toOrder: number) {
    // Pick first type not already used in this group
    const usedCodes = new Set(stages.filter(s => s.sort_order === toOrder).map(s => s.stage_type));
    const nextType = active.find(t => !usedCodes.has(t.code)) ?? active[0];
    // parallel=true → depends_on_previous=0
    onChange([...stages, newStageRow(nextType?.code ?? "assembly", toOrder, nextType?.label ?? "", true)]);
  }

  const groups = groupBySortOrder(stages);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "10px 14px", background: "var(--bg-secondary)", borderRadius: 8, textAlign: "center" }}>
          Этапы не добавлены — нажмите «+ Этап» чтобы добавить
        </div>
      )}

      {groups.map((group, gIdx) => {
        const isParallelGroup = group.rows.length > 1 || group.rows.some(r => r.depends_on_previous === 0);
        return (
          <div key={group.order}>
            {gIdx > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>↓</span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
            )}

            {isParallelGroup && (
              <div style={{ fontSize: 10, fontWeight: 700, color: "#3b82f6", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, paddingLeft: 4 }}>
                ⟂ Параллельно (порядок {group.order})
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: isParallelGroup ? 12 : 0, borderLeft: isParallelGroup ? "3px solid #3b82f640" : "none" }}>
              {group.rows.map(row => {
                const st = active.find(t => t.code === row.stage_type);
                const color = st?.color ?? "#6b7280";
                const rowComponents = row.components ?? [];
                return (
                  <div key={row._key} style={{ background: "var(--bg-secondary)", border: `1px solid ${color}33`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Name + delete */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <input
                        value={row.stage_name}
                        onChange={e => update(row._key, "stage_name", e.target.value)}
                        placeholder="Название этапа"
                        style={{ flex: 1, fontSize: 13, padding: "4px 8px" }}
                      />
                      <button
                        onClick={() => remove(row._key)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 16, lineHeight: 1, padding: "2px 4px", flexShrink: 0 }}
                        onMouseEnter={e => (e.currentTarget.style.color = "var(--danger, #ef4444)")}
                        onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                      >×</button>
                    </div>

                    {/* Dept + Role */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Отдел</label>
                        <select
                          value={row.stage_type}
                          onChange={e => update(row._key, "stage_type", e.target.value)}
                          style={{ fontSize: 12, width: "100%" }}
                        >
                          {active.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Роль</label>
                        <select
                          value={row.required_role}
                          onChange={e => update(row._key, "required_role", e.target.value)}
                          style={{ fontSize: 12, width: "100%" }}
                        >
                          <option value="">— Любой —</option>
                          {systemRoles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* Sort order + mode */}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <label style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Порядок:</label>
                      <input
                        type="number"
                        value={row.sort_order}
                        onChange={e => update(row._key, "sort_order", Number(e.target.value))}
                        min="0"
                        style={{ width: 60, fontSize: 12, padding: "3px 6px" }}
                      />
                      <label style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Режим:</label>
                      <select
                        value={row.depends_on_previous}
                        onChange={e => update(row._key, "depends_on_previous", Number(e.target.value))}
                        style={{ fontSize: 12, flex: 1 }}
                      >
                        <option value={1}>Последовательно</option>
                        <option value={0}>Параллельно</option>
                      </select>
                    </div>

                    {/* Output — что выходит из этапа */}
                    <div>
                      <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                        Результат этапа (что выходит) {row.sort_order === maxOrder && <span style={{ color: "#7c3aed", fontWeight: 600 }}>— последний этап</span>}
                      </label>
                      <input
                        value={row.output_name ?? ""}
                        onChange={e => update(row._key, "output_name", e.target.value)}
                        placeholder={row.sort_order === maxOrder
                          ? `${productName?.trim() || "конечный продукт"} (авто)`
                          : "полуфабрикат, напр.: Плата запаянная"}
                        style={{ fontSize: 12, width: "100%", padding: "4px 8px" }}
                      />
                      {row.sort_order !== maxOrder && (
                        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
                          Станет входом следующего этапа: «взять {row.output_name.trim() || "результат"} + добавить компоненты»
                        </div>
                      )}
                    </div>

                    {/* Instructions — раньше терялись при создании через мастер */}
                    <div>
                      <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 3 }}>Инструкция исполнителю (необязательно)</label>
                      <textarea
                        value={row.instructions ?? ""}
                        onChange={e => update(row._key, "instructions", e.target.value)}
                        rows={2}
                        placeholder="Как выполнять этап…"
                        style={{ fontSize: 12, width: "100%", padding: "4px 8px", resize: "vertical" }}
                      />
                    </div>

                    {/* Components */}
                    {availableComponents && availableComponents.length > 0 && (
                      <div>
                        <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                          Комплектующие для этого этапа
                          {rowComponents.length > 0 && (
                            <span style={{ marginLeft: 6, color: "#3b82f6", fontWeight: 600 }}>({rowComponents.length} выбрано)</span>
                          )}
                        </label>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {availableComponents.map(name => {
                            const checked = rowComponents.includes(name);
                            return (
                              <label
                                key={name}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 6,
                                  fontSize: 12, fontWeight: 500, padding: "5px 11px", borderRadius: 20, cursor: "pointer",
                                  background: checked ? "var(--primary)" : "var(--bg)",
                                  border: `1.5px solid ${checked ? "var(--primary)" : "var(--border)"}`,
                                  color: checked ? "#fff" : "var(--text)",
                                  boxShadow: checked ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
                                  transition: "all .13s", userSelect: "none", lineHeight: 1.2,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleComponent(row._key, name)}
                                  style={{ display: "none" }}
                                />
                                <span style={{ fontSize: 12, fontWeight: 800, opacity: checked ? 1 : 0.6 }}>{checked ? "✓" : "+"}</span>
                                {name}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add parallel button */}
              <button
                onClick={() => addParallel(group.order)}
                style={{ fontSize: 11, fontWeight: 600, color: "#3b82f6", background: "#eff6ff", border: "1px dashed #93c5fd", borderRadius: 8, padding: "4px 10px", cursor: "pointer", textAlign: "left" }}
              >
                + параллельный отдел (одновременно с этим)
              </button>
            </div>

            {/* Add next stage after this group */}
            {gIdx === groups.length - 1 && (
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() => addStage(group.order)}
                  style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  + следующий этап (после этого)
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Initial add button */}
      {stages.length === 0 && (
        <button
          onClick={() => addStage()}
          style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px dashed var(--border)", borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}
        >
          + Добавить этап
        </button>
      )}

      {stages.length > 0 && (
        <button
          onClick={() => addStage()}
          style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          + добавить ещё один этап
        </button>
      )}
    </div>
  );
}
