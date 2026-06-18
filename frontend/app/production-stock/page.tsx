"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { api, ProductionStock } from "../../lib/api";

const INPUT_CLS =
  "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function ProductionStockPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ProductionStock[]>([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterBlock, setFilterBlock] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (user) load(); }, [user]);

  async function load() {
    setFetching(true);
    try { setItems(await api.getProductionStock()); } catch {}
    setFetching(false);
  }

  if (loading || !user) return null;

  if (!hasPermission("warehouse.view")) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-gray-500">Нет доступа</div>
      </AppLayout>
    );
  }

  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean)));
  const blocks = Array.from(new Set(items.map((i) => i.block).filter(Boolean)));

  const filtered = items.filter((i) => {
    const matchSearch = i.component_name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !filterCategory || i.category === filterCategory;
    const matchBlock = !filterBlock || i.block === filterBlock;
    return matchSearch && matchCategory && matchBlock;
  });

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Запасы производства</h1>
          <Button variant="secondary" size="sm" onClick={load}>↻ Обновить</Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Поиск по компоненту..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={INPUT_CLS}
          />
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={INPUT_CLS}>
            <option value="">Все категории</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterBlock} onChange={(e) => setFilterBlock(e.target.value)} className={INPUT_CLS}>
            <option value="">Все блоки</option>
            {blocks.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <Card>
          {fetching ? (
            <div className="text-center py-12 text-gray-400">Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Данные не найдены</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    {["Компонент", "Категория", "Блок", "Количество", "Обновлено"].map((h) => (
                      <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 ${item.quantity === 0 ? "bg-red-50 dark:bg-red-900/20" : ""}`}
                    >
                      <td className="py-3 px-3 font-medium text-gray-900 dark:text-gray-100">{item.component_name}</td>
                      <td className="py-3 px-3 text-gray-500">{item.category}</td>
                      <td className="py-3 px-3 text-gray-500">{item.block}</td>
                      <td className={`py-3 px-3 font-medium ${item.quantity === 0 ? "text-red-600" : "text-gray-900 dark:text-gray-100"}`}>{item.quantity}</td>
                      <td className="py-3 px-3 text-gray-400 text-xs">{new Date(item.updated_at).toLocaleString("ru-RU")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
