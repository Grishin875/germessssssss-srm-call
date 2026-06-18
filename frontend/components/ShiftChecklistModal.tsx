"use client";
import { useEffect, useState } from "react";
import { api, ChecklistItem } from "../lib/api";

interface Props {
  canEdit: boolean;
  onComplete: () => void;
}

export function ShiftChecklistModal({ canEdit, onComplete }: Props) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [newItemText, setNewItemText] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getShiftChecklistItems().then((data) => {
      setItems(data);
      setLoaded(true);
    });
  }, []);

  const allChecked = loaded && items.length > 0 && items.every((i) => checked.has(i.id));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function addItem() {
    const text = newItemText.trim();
    if (!text) return;
    setAddingItem(true);
    try {
      const created = await api.createShiftChecklistItem(text);
      setItems((prev) => [...prev, created]);
      setNewItemText("");
    } catch {}
    setAddingItem(false);
  }

  async function removeItem(id: string) {
    await api.deleteShiftChecklistItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setChecked((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function confirm() {
    if (!allChecked) return;
    setSaving(true);
    await api.completeShiftChecklist(comment.trim(), items.map((i) => i.text));
    onComplete();
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" style={{ paddingLeft: 248 }}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Проверка перед началом смены
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Отметьте все пункты — только после этого откроется основной экран.
          </p>
          {!canEdit && (
            <p className="text-xs text-gray-400 mt-1">
              Редактирование списка доступно только администратору.
            </p>
          )}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {!loaded && (
            <div className="text-center py-8 text-gray-400 text-sm">Загрузка...</div>
          )}
          {loaded && items.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              {canEdit ? "Добавьте хотя бы один пункт проверки." : "Список проверки пуст. Обратитесь к администратору."}
            </div>
          )}
          {loaded && items.map((item) => (
            <label
              key={item.id}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors select-none ${
                checked.has(item.id)
                  ? "border-green-400 bg-green-50 dark:bg-green-900/20 dark:border-green-700"
                  : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              <input
                type="checkbox"
                checked={checked.has(item.id)}
                onChange={() => toggle(item.id)}
                className="mt-0.5 w-4 h-4 accent-green-500 shrink-0"
              />
              <span className={`text-sm flex-1 ${checked.has(item.id) ? "line-through text-gray-400" : "text-gray-800 dark:text-gray-200"}`}>
                {item.text}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); removeItem(item.id); }}
                  className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none shrink-0"
                  title="Удалить пункт"
                >
                  ×
                </button>
              )}
            </label>
          ))}

          {/* Add item (admin/manager) */}
          {canEdit && (
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
                placeholder="Добавить пункт вручную..."
                maxLength={180}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={addItem}
                disabled={addingItem || !newItemText.trim()}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
              >
                Добавить
              </button>
            </div>
          )}
        </div>

        {/* Comment + hint */}
        <div className="px-6 pb-2 space-y-3">
          {loaded && items.length > 0 && !allChecked && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Необходимо отметить все пункты.
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Комментарий (замечания, отклонения, что исправлено)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Например: заменили фидер №4, повторно проверили давление воздуха."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={confirm}
            disabled={!allChecked || saving}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
              allChecked && !saving
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed"
            }`}
          >
            {saving ? "Сохранение..." : "Подтвердить проверку"}
          </button>
        </div>
      </div>
    </div>
  );
}
