"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { api, Order } from "../../lib/api";

const INPUT_CLS =
  "px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

const PAGE_SIZE = 50;

export default function ArchivePage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (user) load(); }, [user]);

  async function load(s = search, sd = startDate, ed = endDate) {
    setFetching(true);
    try {
      setOrders(await api.getArchiveOrders(s, sd, ed));
      setPage(1);
    } catch {}
    setFetching(false);
  }

  if (loading || !user) return null;

  if (!hasPermission("archive.view")) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-gray-500">Нет доступа</div>
      </AppLayout>
    );
  }

  const visible = orders.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < orders.length;

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Архив</h1>
          <Button variant="secondary" size="sm" onClick={() => load()}>↻ Обновить</Button>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <input
            type="text"
            placeholder="Поиск по изделию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={INPUT_CLS}
          />
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">С</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT_CLS} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">По</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={INPUT_CLS} />
          </div>
          <Button size="sm" onClick={() => load(search, startDate, endDate)}>Применить</Button>
        </div>

        <Card>
          {fetching ? (
            <div className="text-center py-12 text-gray-400">Загрузка...</div>
          ) : visible.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Заказы не найдены</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700">
                      {["ID", "Изделие", "План", "Факт", "Статус", "Приоритет", "Дата создания"].map((h) => (
                        <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((order) => (
                      <tr key={order.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="py-3 px-3 font-mono text-xs text-gray-500">{order.id}</td>
                        <td className="py-3 px-3 font-medium text-gray-900 dark:text-gray-100">
                          {order.product_name}
                          {(order.positions_count ?? 0) > 1 && (
                            <span className="font-normal text-gray-400"> +{(order.positions_count ?? 1) - 1}</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-gray-600 dark:text-gray-300">{order.planned_qty}</td>
                        <td className="py-3 px-3 text-gray-600 dark:text-gray-300">{order.actual_qty ?? "—"}</td>
                        <td className="py-3 px-3"><Badge status={order.status} /></td>
                        <td className="py-3 px-3 text-gray-500">{order.priority}</td>
                        <td className="py-3 px-3 text-gray-400 text-xs">{new Date(order.created_at).toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMore && (
                <div className="flex justify-center pt-4 pb-2">
                  <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)}>Загрузить ещё</Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
