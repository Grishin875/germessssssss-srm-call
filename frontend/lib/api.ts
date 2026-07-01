const API_BASE_URL =
  typeof window !== "undefined"
    ? ""  // в браузере — через Next.js rewrites на /api/*
    : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

let authToken: string | null = null;

if (typeof window !== "undefined") {
  authToken = localStorage.getItem("crm_token");
}

export function setToken(token: string) {
  authToken = token;
  if (typeof window !== "undefined") localStorage.setItem("crm_token", token);
}

export function getToken() {
  return authToken;
}

export function clearToken() {
  authToken = null;
  if (typeof window !== "undefined") localStorage.removeItem("crm_token");
}

async function request<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      // FastAPI отдаёт ошибки в поле `detail` (строка или массив validation-ошибок).
      let detail: string | undefined;
      if (Array.isArray(err.detail)) {
        detail = err.detail
          .map((d: unknown) =>
            typeof d === "string" ? d : (d as { msg?: string })?.msg
          )
          .filter(Boolean)
          .join("; ") || undefined;
      } else if (typeof err.detail === "string") {
        detail = err.detail;
      }
      msg = detail || err.error || err.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const api = {
  async login(username: string, password: string) {
    const r = await request<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    if (r.token) setToken(r.token);
    return r;
  },
  async getCurrentUser() {
    // /api/auth/me отдаёт объект пользователя «плоско» (без обёртки { user }),
    // тогда как /api/auth/login — обёрнуто. Нормализуем оба формата, иначе
    // r.user === undefined → при перезагрузке защищённой страницы сессия не
    // восстанавливается и происходит редирект на /login.
    const r = await request<User | { user: User }>("/api/auth/me");
    return { user: (r && (r as { user?: User }).user) ? (r as { user: User }).user : (r as User) };
  },
  async changePassword(oldPassword: string, newPassword: string) {
    return request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },
  async adminResetPassword(userId: number, newPassword: string) {
    return request("/api/auth/admin/reset-password", {
      method: "POST",
      body: JSON.stringify({ user_id: userId, new_password: newPassword }),
    });
  },
  async getUsers(includeInactive = false) {
    return request<User[]>(`/api/auth/users${includeInactive ? "?include_inactive=1" : ""}`);
  },
  async createUser(data: Partial<User> & { password: string }) {
    return request<User>("/api/auth/users", { method: "POST", body: JSON.stringify(data) });
  },
  async updateUser(id: number, data: Partial<User>) {
    return request<User>(`/api/auth/users/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteUser(id: number) {
    return request(`/api/auth/users/${id}`, { method: "DELETE" });
  },
  async getPendingRegistrations() {
    return request<User[]>("/api/auth/pending-registrations");
  },
  async approveRegistration(id: number, data: object) {
    return request(`/api/auth/approve-registration/${id}`, { method: "POST", body: JSON.stringify(data) });
  },
  async rejectRegistration(id: number) {
    return request(`/api/auth/reject-registration/${id}`, { method: "POST" });
  },

  // ── Warehouse ───────────────────────────────────────────────────────────────
  async getComponents() {
    return request<Component[]>("/api/warehouse/components");
  },
  async createComponent(data: Partial<Component>) {
    return request<Component>("/api/warehouse/components", { method: "POST", body: JSON.stringify(data) });
  },
  async updateComponent(id: number, data: Partial<Component>) {
    return request<Component>(`/api/warehouse/components/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteComponent(id: number) {
    return request(`/api/warehouse/components/${id}`, { method: "DELETE" });
  },
  async batchOperation(type: string, items: BatchItem[], operationId?: string, toProduction = false, writeoffReason?: string, writeoffComment?: string, employeeId?: string) {
    return request("/api/warehouse/batch", {
      method: "POST",
      body: JSON.stringify({ operationType: type, items, operationId, toProduction, writeoffReason, writeoffComment, employeeId }),
    });
  },
  async getCategories() {
    return request<string[]>("/api/warehouse/categories");
  },
  async getInventory() {
    return request<Record<string, { name: string; qty: number }[]>>("/api/warehouse/inventory");
  },
  async getWarehouseOperations(params: Record<string, string | number> = {}) {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ operations: Operation[]; total: number }>(`/api/warehouse/operations${q ? "?" + q : ""}`);
  },
  async getProductionStock() {
    return request<ProductionStock[]>("/api/warehouse/production-stock");
  },
  async getCases() {
    return request<Case[]>("/api/warehouse/cases");
  },
  async createCase(data: Partial<Case>) {
    return request<Case>("/api/warehouse/cases", { method: "POST", body: JSON.stringify(data) });
  },
  async updateCase(id: number, data: Partial<Case>) {
    return request<Case>(`/api/warehouse/cases/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteCase(id: number) {
    return request(`/api/warehouse/cases/${id}`, { method: "DELETE" });
  },
  async adjustCaseStock(id: number, delta: number, comment?: string) {
    return request<Case>(`/api/warehouse/cases/${id}/adjust`, {
      method: "PATCH",
      body: JSON.stringify({ delta, comment }),
    });
  },
  async checkAvailability(items: AvailabilityItem[]) {
    return request<{ all_ok: boolean; items: AvailabilityResult[] }>("/api/warehouse/check-availability", {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  },
  async reserveForOrder(orderId: number, items: AvailabilityItem[]) {
    return request("/api/warehouse/reserve-for-order", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId, items }),
    });
  },

  // ── Warehouses (мультисклад) ──────────────────────────────────────────────
  async getWarehouses(includeInactive = false) {
    return request<Warehouse[]>(`/api/warehouse/warehouses${includeInactive ? "?include_inactive=true" : ""}`);
  },
  async createWarehouse(data: Partial<Warehouse>) {
    return request<Warehouse>("/api/warehouse/warehouses", { method: "POST", body: JSON.stringify(data) });
  },
  async updateWarehouse(id: number, data: Partial<Warehouse>) {
    return request<Warehouse>(`/api/warehouse/warehouses/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteWarehouse(id: number) {
    return request(`/api/warehouse/warehouses/${id}`, { method: "DELETE" });
  },
  async getWarehouseStock(id: number) {
    return request<WarehouseStockRow[]>(`/api/warehouse/warehouses/${id}/stock`);
  },
  async getComponentDistribution(name: string) {
    return request<WarehouseStockRow[]>(`/api/warehouse/stock/by-component/${encodeURIComponent(name)}`);
  },
  async transferStock(data: { component_name: string; from_warehouse_id: number; to_warehouse_id: number; quantity: number; note?: string }) {
    return request<{ success: boolean; from: string; to: string }>("/api/warehouse/warehouses/transfer", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // ── Закупка (procurement) ─────────────────────────────────────────────────
  async getSuppliers(includeInactive = false) {
    return request<Supplier[]>(`/api/warehouse/suppliers${includeInactive ? "?include_inactive=true" : ""}`);
  },
  async createSupplier(data: Partial<Supplier>) {
    return request<Supplier>("/api/warehouse/suppliers", { method: "POST", body: JSON.stringify(data) });
  },
  async updateSupplier(id: number, data: Partial<Supplier>) {
    return request<Supplier>(`/api/warehouse/suppliers/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteSupplier(id: number) {
    return request(`/api/warehouse/suppliers/${id}`, { method: "DELETE" });
  },
  async getPurchaseRequests(status?: string) {
    return request<PurchaseRequest[]>(`/api/warehouse/purchase-requests${status ? "?status=" + status : ""}`);
  },
  async getPurchaseRequest(id: number) {
    return request<PurchaseRequest>(`/api/warehouse/purchase-requests/${id}`);
  },
  async createPurchaseRequest(data: { supplier_id?: number | null; note?: string; order_ref?: string; items: PurchaseItemIn[] }) {
    return request<PurchaseRequest>("/api/warehouse/purchase-requests", { method: "POST", body: JSON.stringify(data) });
  },
  async updatePurchaseRequest(id: number, data: { supplier_id?: number | null; status?: string; note?: string; order_ref?: string; items?: PurchaseItemIn[] }) {
    return request<PurchaseRequest>(`/api/warehouse/purchase-requests/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async receivePurchaseRequest(id: number) {
    return request<PurchaseRequest>(`/api/warehouse/purchase-requests/${id}/receive`, { method: "POST" });
  },
  async deletePurchaseRequest(id: number) {
    return request(`/api/warehouse/purchase-requests/${id}`, { method: "DELETE" });
  },
  async purchaseFromShortage(data: { items: { component_name: string; quantity: number }[]; supplier_id?: number | null; order_ref?: string; note?: string }) {
    return request<PurchaseRequest>("/api/warehouse/purchase-requests/from-shortage", { method: "POST", body: JSON.stringify(data) });
  },

  // ── Заявки на компоненты (брак/порча в производстве) ──────────────────────
  async getComponentRequests(status?: string) {
    return request<ComponentRequest[]>(`/api/warehouse/component-requests${status ? "?status=" + status : ""}`);
  },
  async createComponentRequest(data: { order_id: number; stage_id?: number | null; component_name: string; qty: number; reason?: string; comment?: string }) {
    return request<ComponentRequest>("/api/warehouse/component-requests", { method: "POST", body: JSON.stringify(data) });
  },
  async issueComponentRequest(id: number) {
    return request<ComponentRequest>(`/api/warehouse/component-requests/${id}/issue`, { method: "POST" });
  },
  async rejectComponentRequest(id: number) {
    return request<ComponentRequest>(`/api/warehouse/component-requests/${id}/reject`, { method: "POST" });
  },

  // ── Orders ──────────────────────────────────────────────────────────────────
  async getOrders(status?: string, search?: string, includeStatuses?: string, cf?: { field: number; value: string }) {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (search) p.set("search", search);
    if (includeStatuses) p.set("include_statuses", includeStatuses);
    if (cf && cf.value) { p.set("cf_field", String(cf.field)); p.set("cf_value", cf.value); }
    const q = p.toString();
    return request<Order[]>(`/api/orders${q ? "?" + q : ""}`);
  },
  async getArchiveOrders(search?: string, startDate?: string, endDate?: string) {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (startDate) p.set("start_date", startDate);
    if (endDate) p.set("end_date", endDate);
    const q = p.toString();
    return request<Order[]>(`/api/orders/archive${q ? "?" + q : ""}`);
  },
  async getOrdersAnalytics() {
    return request<OrdersAnalytics>("/api/orders/analytics/summary");
  },
  async getOrder(id: number) {
    return request<Order>(`/api/orders/${id}`);
  },
  async getOrderChildren(id: number) {
    return request<{ id: number; product_name: string; planned_qty: number; status: string; created_at?: string }[]>(
      `/api/orders/${id}/children`
    ).catch(() => []);
  },
  async createOrder(data: Partial<Order>) {
    return request<Order>("/api/orders", { method: "POST", body: JSON.stringify(data) });
  },
  async updateOrder(id: number, data: Partial<Order>) {
    return request<Order>(`/api/orders/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteOrder(id: number) {
    return request(`/api/orders/${id}`, { method: "DELETE" });
  },
  async closeOrder(id: number) {
    return request<{ success: boolean; status: string }>(`/api/orders/${id}/close`, { method: "POST" });
  },
  async releaseComponents(id: number) {
    return request<{ success: boolean; message: string; missing?: { name: string; required: number; available: number }[] }>(`/api/orders/${id}/release-components`, { method: "POST" });
  },
  async calculateOrderDemand(productName: string, plannedQty: number, productionType?: string) {
    return request<OrderDemandResult>("/api/recipes/calculate-order-demand", {
      method: "POST",
      body: JSON.stringify({ product_name: productName, planned_qty: plannedQty, production_type: productionType }),
    });
  },
  async startOrder(id: number, operatorId?: string) {
    return request(`/api/orders/${id}/start`, { method: "POST", body: JSON.stringify({ operator_id: operatorId }) });
  },
  async getOrderComponentDemand(id: number) {
    return request<{ canProduce: boolean; components: ComponentDemand[] }>(`/api/orders/${id}/component-demand`);
  },
  async getOrderStages(orderId: number) {
    return request<OrderStage[]>(`/api/orders/${orderId}/stages`);
  },
  async generateOrderStages(orderId: number) {
    return request<OrderStage[]>(`/api/orders/${orderId}/stages/generate`, { method: "POST" });
  },
  // Канонический маршрут по ТЗ (12 этапов)
  async generateCanonicalStages(orderId: number, data?: { needs_smd?: boolean; is_receiver?: boolean; needs_assembly?: boolean; replace?: boolean }) {
    return request<{ created: number; flags: { needs_smd: boolean; is_receiver: boolean; needs_assembly: boolean }; stages: OrderStage[] }>(
      `/api/orders/${orderId}/stages/generate-canonical`, { method: "POST", body: JSON.stringify(data || {}) }
    );
  },
  // Графовый маршрут «как на диаграмме»: петли ремонта (AOI/ОТК → Ремонт РЭА → назад) + ветка Программатор
  async generateGraphRoute(orderId: number, data?: { needs_smd?: boolean; is_receiver?: boolean; needs_assembly?: boolean; replace?: boolean }) {
    return request<{ created: number; stages: OrderStage[] }>(
      `/api/orders/${orderId}/stages/generate-graph-route`, { method: "POST", body: JSON.stringify(data || {}) }
    );
  },
  // Контроль качества на этапе-гейте (AOI / ОТК)
  async inspectStage(orderId: number, stageId: number, data: { result: "pass" | "fail"; comment?: string; photo_url?: string; needs_components?: boolean; rework_stage_id?: number }) {
    return request<{ result: string; stage_id: number; rework_stage_id: number | null; order_status?: string }>(
      `/api/orders/${orderId}/stages/${stageId}/inspect`, { method: "POST", body: JSON.stringify(data) }
    );
  },
  async addOrderStage(orderId: number, data: { stage_name: string; stage_type: string; required_role?: string; sort_order?: number; instructions?: string; next_stage_id?: number }) {
    return request<OrderStage>(`/api/orders/${orderId}/stages`, { method: "POST", body: JSON.stringify(data) });
  },
  async updateOrderStage(orderId: number, stageId: number, data: Partial<OrderStage>) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteOrderStage(orderId: number, stageId: number) {
    return request(`/api/orders/${orderId}/stages/${stageId}`, { method: "DELETE" });
  },
  async autoAssignStages(orderId: number) {
    return request<{ success: boolean; assigned: { stage_id: number; stage_name: string; user_id: number; user_name: string }[]; message: string }>(
      `/api/orders/${orderId}/stages/auto-assign`, { method: "POST" }
    );
  },
  async assignStage(orderId: number, stageId: number, employeeId: string, employeeName: string) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ employee_id: employeeId, employee_name: employeeName }),
    });
  },
  async completeStage(orderId: number, stageId: number, comment?: string) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}/complete`, {
      method: "PATCH",
      body: JSON.stringify({ comment }),
    });
  },
  async startStage(orderId: number, stageId: number) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}/start`, { method: "PATCH", body: JSON.stringify({}) });
  },
  async acceptStage(orderId: number, stageId: number) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}/accept`, { method: "PATCH", body: JSON.stringify({}) });
  },
  async reorderStages(orderId: number, order: number[]) {
    return request<OrderStage[]>(`/api/orders/${orderId}/stages/reorder`, { method: "PATCH", body: JSON.stringify({ order }) });
  },
  async pauseStage(orderId: number, stageId: number, reason: string) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}/pause`, { method: "PATCH", body: JSON.stringify({ reason }) });
  },
  async resumeStage(orderId: number, stageId: number) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}/resume`, { method: "PATCH", body: JSON.stringify({}) });
  },
  // ── Шаблоны маршрутов ─────────────────────────────────────────────────────────
  async getRouteTemplates() {
    return request<RouteTemplate[]>(`/api/route-templates`);
  },
  async createRouteTemplate(data: { name: string; description?: string; from_order_id?: number; stages?: RouteTemplateStage[] }) {
    return request<RouteTemplate>(`/api/route-templates`, { method: "POST", body: JSON.stringify(data) });
  },
  async deleteRouteTemplate(id: number) {
    return request(`/api/route-templates/${id}`, { method: "DELETE" });
  },
  async applyRouteTemplate(orderId: number, templateId: number) {
    return request<OrderStage[]>(`/api/orders/${orderId}/stages/from-template/${templateId}`, { method: "POST" });
  },
  async getRouteOptions(orderId: number, stageId: number) {
    return request<{ current: OrderStage; existing_stages: { id: number; stage_type: string; stage_name: string; status: string; sort_order: number }[] }>(
      `/api/orders/${orderId}/stages/${stageId}/route-options`
    );
  },
  async routeNext(orderId: number, stageId: number, data: { action: "existing" | "new"; next_stage_id?: number; stage_type?: string; stage_name?: string; required_role?: string; instructions?: string }) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}/route-next`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async transferStage(orderId: number, stageId: number, qty: number) {
    return request<OrderStage>(`/api/orders/${orderId}/stages/${stageId}/transfer`, { method: "PATCH", body: JSON.stringify({ qty }) });
  },
  async getMyStages() {
    return request<MyStage[]>("/api/my-stages");
  },
  async getMyOrders() {
    return request<MyOrder[]>("/api/my-orders");
  },
  async submitOtk(orderId: number, photoUrl?: string) {
    return request(`/api/orders/${orderId}/submit-otk`, { method: "POST", body: JSON.stringify({ photo_url: photoUrl || null }) });
  },
  async returnRework(orderId: number, data: { comment: string; rejection_photo_url?: string; rework_stage_type?: string; rework_stage_id?: number }) {
    return request<{ success: boolean; rework_stage_id: number | null; otk_attempts: number }>(
      `/api/orders/${orderId}/return-rework`,
      { method: "POST", body: JSON.stringify(data) }
    );
  },
  async getAvailableAssignees(orderId: number, stageId: number) {
    return request<{ id: number; username: string; full_name?: string; role: string }[]>(`/api/orders/${orderId}/stages/${stageId}/available-assignees`);
  },

  // ── Production ──────────────────────────────────────────────────────────────
  async getProductionBatches(params: Record<string, string | number> = {}) {
    const q = new URLSearchParams(params as Record<string, string>).toString();
    return request<Batch[]>(`/api/production/batches${q ? "?" + q : ""}`);
  },
  async startBatch(batchId: string, data: object) {
    return request(`/api/production/start-batch/${encodeURIComponent(batchId)}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async completeProduction(batchId: string, actualQty: number) {
    return request("/api/production/complete", { method: "POST", body: JSON.stringify({ batchId, actualQty }) });
  },
  async pauseShift(batchId: string, qtyProduced: number, comment?: string) {
    return request("/api/production/pause-shift", { method: "POST", body: JSON.stringify({ batchId, qtyProduced, comment }) });
  },
  async deleteProductionBatch(batchId: string) {
    return request(`/api/production/batches/${encodeURIComponent(batchId)}`, { method: "DELETE" });
  },

  // ── OTK ─────────────────────────────────────────────────────────────────────
  async getOtkBatches(status?: string) {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<OtkBatch[]>(`/api/otk/batches${q}`);
  },
  async otkCheck(data: object) {
    return request("/api/otk/check", { method: "POST", body: JSON.stringify(data) });
  },
  async getReadyToShip() {
    return request<Order[]>("/api/otk/ready-to-ship");
  },
  async shipPartial(shipments: { batchId: string; qty: number; shipperId: string; invoiceNumber?: string; recipient?: string }[]) {
    return request("/api/otk/ship-partial", { method: "POST", body: JSON.stringify({ shipments }) });
  },
  async getOtkReports(dateFrom?: string, dateTo?: string) {
    const p = new URLSearchParams();
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    return request<OtkReport>(`/api/otk/reports?${p.toString()}`);
  },
  async getOtkAnalytics(days = 30) {
    return request<OtkAnalytics>(`/api/otk/analytics/summary?days=${days}`);
  },
  async getLowStock() {
    return request<LowStockItem[]>(`/api/warehouse/low-stock`).catch(() => []);
  },
  async getDefectTypes() {
    return request<DefectType[]>("/api/otk/defect-types").catch(() => []);
  },
  async getDefectCategories() {
    return request<{ id: number; name: string }[]>("/api/otk/defect-categories").catch(() => []);
  },
  async getRegulationProducts() {
    return request<string[]>("/api/otk/regulations/products");
  },
  async getRegulationProblems(product?: string) {
    const q = product ? `?product=${encodeURIComponent(product)}` : "";
    return request<RegulationProblem[]>(`/api/otk/regulations/problems${q}`).catch(() => []);
  },

  // ── Recipes ──────────────────────────────────────────────────────────────────
  async getRecipes() {
    return request<Recipe[]>("/api/recipes");
  },
  async getProducts(type?: string) {
    const ep = type ? `/api/recipes/products/type/${encodeURIComponent(type)}` : "/api/recipes/products";
    return request<string[]>(ep);
  },
  async createRecipe(data: Partial<Recipe>) {
    return request<Recipe>("/api/recipes", { method: "POST", body: JSON.stringify(data) });
  },
  async updateRecipe(id: number, data: Partial<Recipe>) {
    return request<Recipe>(`/api/recipes/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteRecipe(id: number) {
    return request(`/api/recipes/${id}`, { method: "DELETE" });
  },
  async deleteProductFull(productName: string) {
    return request<{ success: boolean; product_name: string; deleted: Record<string, number> }>(
      `/api/recipes/product/delete`, { method: "POST", body: JSON.stringify({ product_name: productName }) }
    );
  },
  async renameProduct(oldName: string, newName: string) {
    return request<{ success: boolean; old_name: string; new_name: string; updated: Record<string, number> }>(
      `/api/recipes/product/rename`, { method: "POST", body: JSON.stringify({ old_name: oldName, new_name: newName }) }
    );
  },
  async calculateDemand(plan: { product: string; qty: number }[]) {
    return request<DemandResult[]>("/api/recipes/calculate-demand", { method: "POST", body: JSON.stringify({ plan }) });
  },
  async getRecipeCases(productName?: string) {
    const q = productName ? `?product_name=${encodeURIComponent(productName)}` : "";
    return request<RecipeCase[]>(`/api/recipes/recipe-cases${q}`);
  },
  async createRecipeCase(data: Partial<RecipeCase>) {
    return request<RecipeCase>("/api/recipes/recipe-cases", { method: "POST", body: JSON.stringify(data) });
  },
  async updateRecipeCase(id: number, data: Partial<RecipeCase>) {
    return request<RecipeCase>(`/api/recipes/recipe-cases/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteRecipeCase(id: number) {
    return request(`/api/recipes/recipe-cases/${id}`, { method: "DELETE" });
  },
  async getRecipeStages(productName?: string) {
    const q = productName ? `?product_name=${encodeURIComponent(productName)}` : "";
    return request<RecipeStage[]>(`/api/recipes/recipe-stages${q}`);
  },
  async getProductStages(productName: string) {
    return request<unknown>(`/api/recipes/product-stages/${encodeURIComponent(productName)}`);
  },
  async updateProductOrder(items: { product_name: string; production_type: string; sort_order: number; assigned_role?: string }[]) {
    return request("/api/recipes/product-order/update", { method: "POST", body: JSON.stringify(items) });
  },
  async createRecipeStage(data: Partial<RecipeStage>) {
    return request<RecipeStage>("/api/recipes/recipe-stages", { method: "POST", body: JSON.stringify(data) });
  },
  async updateRecipeStage(id: number, data: Partial<RecipeStage>) {
    return request<RecipeStage>(`/api/recipes/recipe-stages/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteRecipeStage(id: number) {
    return request(`/api/recipes/recipe-stages/${id}`, { method: "DELETE" });
  },

  async getFinishedGoods() {
    return request<FinishedGood[]>("/api/recipes/finished-goods");
  },

  // ── Operators ────────────────────────────────────────────────────────────────
  async getOperators(activeOnly = false) {
    return request<Operator[]>(`/api/operators${activeOnly ? "?active_only=1" : ""}`);
  },
  async createOperator(data: Partial<Operator>) {
    return request<Operator>("/api/operators", { method: "POST", body: JSON.stringify(data) });
  },
  async updateOperator(id: number, data: Partial<Operator>) {
    return request<Operator>(`/api/operators/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteOperator(id: number) {
    return request(`/api/operators/${id}`, { method: "DELETE" });
  },
  async getOperatorsStats(period = "all") {
    return request<OperatorStats[]>(`/api/operators/stats?period=${period}`);
  },

  // ── Tasks ────────────────────────────────────────────────────────────────────
  async getTasks() {
    return request<Task[]>("/api/tasks");
  },
  async createTask(title: string, description: string, priority: string, assignedOperatorId?: string) {
    return request<Task>("/api/tasks", { method: "POST", body: JSON.stringify({ title, description, priority, assigned_operator_id: assignedOperatorId }) });
  },
  async completeTask(id: number) {
    return request<Task>(`/api/tasks/${id}/complete`, { method: "PUT" });
  },
  async reopenTask(id: number) {
    return request<Task>(`/api/tasks/${id}/reopen`, { method: "PUT" });
  },
  async deleteTask(id: number) {
    return request(`/api/tasks/${id}`, { method: "DELETE" });
  },

  // ── Shifts ───────────────────────────────────────────────────────────────────
  async getShifts(params: Record<string, string> = {}) {
    const q = new URLSearchParams(params).toString();
    return request<Shift[]>(`/api/shifts${q ? "?" + q : ""}`);
  },
  async createShift(data: Partial<Shift>) {
    return request<{ shift: Shift }>("/api/shifts", { method: "POST", body: JSON.stringify(data) });
  },
  async updateShift(id: number, data: Partial<Shift>) {
    return request<{ shift: Shift }>(`/api/shifts/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async deleteShift(id: number) {
    return request(`/api/shifts/${id}`, { method: "DELETE" });
  },
  async getShiftsReport(startDate: string, endDate: string) {
    return request<ShiftsReport>(`/api/shifts/report?start_date=${startDate}&end_date=${endDate}`);
  },

  // ── Users public ─────────────────────────────────────────────────────────────
  async getTopUsers() {
    return request<User[]>("/api/users/rating/top");
  },
  async getBirthdaysToday() {
    return request<User[]>("/api/users/birthdays/today");
  },
  async getUserProfile(id: number) {
    return request<User>(`/api/users/${id}/profile`);
  },
  async updateUserPhoto(id: number, photoUrl: string) {
    return request(`/api/users/${id}/photo`, { method: "PUT", body: JSON.stringify({ photo_url: photoUrl }) });
  },

  // ── Firmware ─────────────────────────────────────────────────────────────────
  async getFirmware(params: Record<string, string> = {}) {
    const q = new URLSearchParams(params).toString();
    return request<FirmwareBatch[]>(`/api/firmware${q ? "?" + q : ""}`);
  },
  async createFirmware(data: object) {
    return request<FirmwareBatch>("/api/firmware", { method: "POST", body: JSON.stringify(data) });
  },
  async completeFirmware(id: string, data: object) {
    return request(`/api/firmware/${id}/complete`, { method: "POST", body: JSON.stringify(data) });
  },

  // ── Documents ────────────────────────────────────────────────────────────────
  async getDocuments(params: Record<string, string> = {}) {
    const q = new URLSearchParams(params).toString();
    return request<DocFile[]>(`/api/documents${q ? "?" + q : ""}`);
  },
  async uploadDocument(formData: FormData) {
    const url = `${API_BASE_URL}/api/documents/upload`;
    const headers: Record<string, string> = {};
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch(url, { method: "POST", headers, body: formData });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `HTTP ${res.status}`); }
    return res.json() as Promise<DocFile>;
  },
  async getDocument(id: number) {
    return request<DocFile>(`/api/documents/${id}`);
  },
  async updateDocument(id: number, data: object) {
    return request<DocFile>(`/api/documents/${id}`, { method: "PUT", body: JSON.stringify(data) });
  },
  async updateDocumentContent(id: number, content: string) {
    return request(`/api/documents/${id}/content`, { method: "PUT", body: JSON.stringify({ content }) });
  },
  async deleteDocument(id: number) {
    return request(`/api/documents/${id}`, { method: "DELETE" });
  },
  async reextractDocument(id: number) {
    return request(`/api/documents/${id}/reextract`, { method: "POST" });
  },
  documentDownloadUrl(id: number) {
    return `${API_BASE_URL}/api/documents/${id}/download`;
  },
  documentConvertUrl(id: number, to: string) {
    return `${API_BASE_URL}/api/documents/${id}/convert?to=${to}`;
  },

  // ── Shift Checklist ──────────────────────────────────────────────────────────
  async getShiftChecklistItems() {
    return request<ChecklistItem[]>("/api/shifts/checklist/items").catch(
      () => DEFAULT_CHECKLIST_ITEMS
    );
  },
  async completeShiftChecklist(comment: string, items: string[]) {
    return request("/api/shifts/checklist/complete", {
      method: "POST",
      body: JSON.stringify({ comment, items }),
    }).catch(() => null);
  },
  async createShiftChecklistItem(text: string) {
    return request<ChecklistItem>("/api/shifts/checklist/items", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },
  async deleteShiftChecklistItem(id: string) {
    return request(`/api/shifts/checklist/items/${id}`, { method: "DELETE" }).catch(() => null);
  },

  // ── Health ───────────────────────────────────────────────────────────────────
  async healthCheck() {
    return request<{ status: string }>("/api/health");
  },

  // ── Stage Types ──────────────────────────────────────────────────────────────
  async getStageTypes() {
    return request<StageTypeItem[]>("/api/stage-types");
  },
  async createStageType(data: Partial<StageTypeItem>) {
    return request<StageTypeItem>("/api/stage-types", { method: "POST", body: JSON.stringify(data) });
  },
  async updateStageType(id: number, data: Partial<StageTypeItem>) {
    return request<StageTypeItem>(`/api/stage-types/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  },
  async deleteStageType(id: number) {
    return request(`/api/stage-types/${id}`, { method: "DELETE" });
  },

  // ── System Roles ─────────────────────────────────────────────────────────────
  async getSystemRoles() {
    return request<SystemRoleItem[]>("/api/system-roles");
  },
  async createSystemRole(data: Partial<SystemRoleItem>) {
    return request<SystemRoleItem>("/api/system-roles", { method: "POST", body: JSON.stringify(data) });
  },
  async updateSystemRole(id: number, data: Partial<SystemRoleItem>) {
    return request<SystemRoleItem>(`/api/system-roles/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  },
  async deleteSystemRole(id: number) {
    return request(`/api/system-roles/${id}`, { method: "DELETE" });
  },

  // ── Order Statuses ────────────────────────────────────────────────────────────
  async getOrderStatuses() {
    return request<OrderStatusItem[]>("/api/order-statuses");
  },
  async createOrderStatus(data: Partial<OrderStatusItem>) {
    return request<OrderStatusItem>("/api/order-statuses", { method: "POST", body: JSON.stringify(data) });
  },
  async updateOrderStatus(id: number, data: Partial<OrderStatusItem>) {
    return request<OrderStatusItem>(`/api/order-statuses/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  },
  async deleteOrderStatus(id: number) {
    return request(`/api/order-statuses/${id}`, { method: "DELETE" });
  },
  async getStatusTransitions() {
    return request<StatusTransitionItem[]>("/api/status-transitions");
  },
  async createStatusTransition(data: { from_status: string; to_status: string; allowed_roles?: string[] }) {
    return request<StatusTransitionItem>("/api/status-transitions", { method: "POST", body: JSON.stringify(data) });
  },
  async deleteStatusTransition(id: number) {
    return request(`/api/status-transitions/${id}`, { method: "DELETE" });
  },

  // ── Priorities ────────────────────────────────────────────────────────────────
  async getPriorities() {
    return request<PriorityItem[]>("/api/priorities");
  },
  async createPriority(data: Partial<PriorityItem>) {
    return request<PriorityItem>("/api/priorities", { method: "POST", body: JSON.stringify(data) });
  },
  async updatePriority(id: number, data: Partial<PriorityItem>) {
    return request<PriorityItem>(`/api/priorities/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  },
  async deletePriority(id: number) {
    return request(`/api/priorities/${id}`, { method: "DELETE" });
  },

  // ── Notifications ─────────────────────────────────────────────────────────────
  async getNotifications() {
    return request<NotificationItem[]>("/api/notifications");
  },
  async getUnreadCount() {
    return request<{ count: number }>("/api/notifications/unread-count");
  },
  async markAllRead() {
    return request("/api/notifications/read-all", { method: "POST" });
  },
  async markNotifRead(id: number) {
    return request(`/api/notifications/${id}/read`, { method: "PATCH" });
  },

  // ── Audit Log ─────────────────────────────────────────────────────────────────
  async getAuditLog(params?: { entity_type?: string; entity_id?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.entity_type) qs.set("entity_type", params.entity_type);
    if (params?.entity_id) qs.set("entity_id", String(params.entity_id));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return request<AuditLogItem[]>(`/api/audit-log${q ? `?${q}` : ""}`);
  },
  async addAuditEntry(data: { entity_type: string; entity_id?: number; action: string; old_value?: string; new_value?: string; details?: string }) {
    return request("/api/audit-log", { method: "POST", body: JSON.stringify(data) });
  },

  // ── Custom Fields ─────────────────────────────────────────────────────────────
  async getCustomFieldDefs() { return request<CustomFieldDef[]>("/api/custom-fields/definitions"); },
  async createCustomFieldDef(data: Partial<CustomFieldDef>) { return request<CustomFieldDef>("/api/custom-fields/definitions", { method: "POST", body: JSON.stringify(data) }); },
  async updateCustomFieldDef(id: number, data: Partial<CustomFieldDef>) { return request<CustomFieldDef>(`/api/custom-fields/definitions/${id}`, { method: "PATCH", body: JSON.stringify(data) }); },
  async deleteCustomFieldDef(id: number) { return request(`/api/custom-fields/definitions/${id}`, { method: "DELETE" }); },
  async getOrderCustomFields(orderId: number) { return request<Record<string, string>>(`/api/orders/${orderId}/custom-fields`); },
  async setOrderCustomFields(orderId: number, values: Record<string, string>) {
    return request(`/api/orders/${orderId}/custom-fields`, { method: "PUT", body: JSON.stringify(values) });
  },

  // ── SLA Rules ─────────────────────────────────────────────────────────────────
  async getSlaRules() { return request<SlaRule[]>("/api/sla-rules"); },
  async createSlaRule(data: Partial<SlaRule>) { return request<SlaRule>("/api/sla-rules", { method: "POST", body: JSON.stringify(data) }); },
  async updateSlaRule(id: number, data: Partial<SlaRule>) { return request<SlaRule>(`/api/sla-rules/${id}`, { method: "PATCH", body: JSON.stringify(data) }); },
  async deleteSlaRule(id: number) { return request(`/api/sla-rules/${id}`, { method: "DELETE" }); },
  async checkSlaViolations() { return request<SlaViolation[]>("/api/sla-rules/check"); },

  // ── Order Comments ────────────────────────────────────────────────────────────
  async getOrderComments(orderId: number) {
    return request<OrderComment[]>(`/api/orders/${orderId}/comments`);
  },
  async addOrderComment(orderId: number, text: string) {
    return request<OrderComment>(`/api/orders/${orderId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
  },
  async deleteOrderComment(orderId: number, commentId: number) {
    return request(`/api/orders/${orderId}/comments/${commentId}`, { method: "DELETE" });
  },

  // ── Webhooks ──────────────────────────────────────────────────────────────────
  async getWebhooks() { return request<Webhook[]>("/api/webhooks"); },
  async createWebhook(data: { name: string; url: string; events: string[]; secret?: string; is_active?: boolean }) {
    return request<Webhook>("/api/webhooks", { method: "POST", body: JSON.stringify(data) });
  },
  async updateWebhook(id: number, data: Partial<{ name: string; url: string; events: string[]; secret: string; is_active: boolean }>) {
    return request<Webhook>(`/api/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  },
  async deleteWebhook(id: number) { return request(`/api/webhooks/${id}`, { method: "DELETE" }); },
  async testWebhook(id: number) { return request<{ status: string }>(`/api/webhooks/${id}/test`, { method: "POST" }); },

  // ── Notification subscriptions ───────────────────────────────────────────────
  async getNotificationSubscriptions() { return request<NotificationSubscription[]>("/api/notification-subscriptions"); },
  async setNotificationSubscription(event_type: string, enabled: boolean) {
    return request<NotificationSubscription>("/api/notification-subscriptions", { method: "PUT", body: JSON.stringify({ event_type, enabled }) });
  },

  // ── Stage Assignees ───────────────────────────────────────────────────────────
  async getStageAssignees(orderId: number, stageId: number) {
    return request<StageAssignee[]>(`/api/orders/${orderId}/stages/${stageId}/assignees`);
  },
  async addStageAssignee(orderId: number, stageId: number, data: { user_id: number; user_name: string; qty_planned: number }) {
    return request<StageAssignee>(`/api/orders/${orderId}/stages/${stageId}/assignees`, { method: "POST", body: JSON.stringify(data) });
  },
  async removeStageAssignee(orderId: number, stageId: number, userId: number) {
    return request(`/api/orders/${orderId}/stages/${stageId}/assignees/${userId}`, { method: "DELETE" });
  },
  async startAssigneeWork(orderId: number, stageId: number, userId: number) {
    return request<StageAssignee>(`/api/orders/${orderId}/stages/${stageId}/assignees/${userId}/start`, { method: "PATCH" });
  },
  async completeAssigneeWork(orderId: number, stageId: number, userId: number, qtyDone: number) {
    return request<StageAssignee>(`/api/orders/${orderId}/stages/${stageId}/assignees/${userId}/complete`, {
      method: "PATCH", body: JSON.stringify({ qty_done: qtyDone }),
    });
  },

  // ── Product Catalog ───────────────────────────────────────────────────────────
  async getCatalog(params?: { q?: string; category?: string; active_only?: boolean }) {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.category) qs.set("category", params.category);
    if (params?.active_only) qs.set("active_only", "true");
    const q = qs.toString();
    return request<ProductCatalogItem[]>(`/api/catalog${q ? `?${q}` : ""}`);
  },
  async createCatalogItem(data: Partial<ProductCatalogItem>) {
    return request<ProductCatalogItem>("/api/catalog", { method: "POST", body: JSON.stringify(data) });
  },
  async updateCatalogItem(id: number, data: Partial<ProductCatalogItem>) {
    return request<ProductCatalogItem>(`/api/catalog/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  },
  async deleteCatalogItem(id: number) {
    return request(`/api/catalog/${id}`, { method: "DELETE" });
  },
  async getCatalogCategories() {
    return request<string[]>("/api/catalog/categories");
  },

  // ── Чат ───────────────────────────────────────────────────────────────────────
  async getChatChannels() {
    return request<ChatChannel[]>("/api/chat/channels");
  },
  async getChatUnread() {
    return request<{ unread: number }>("/api/chat/unread");
  },
  async createChatChannel(name: string, member_ids?: number[]) {
    return request<ChatChannel>("/api/chat/channels", { method: "POST", body: JSON.stringify({ name, member_ids }) });
  },
  async openDirectChat(user_id: number) {
    return request<ChatChannel>("/api/chat/channels/direct", { method: "POST", body: JSON.stringify({ user_id }) });
  },
  async openOrderChat(orderId: number) {
    return request<ChatChannel>(`/api/chat/order/${orderId}`);
  },
  async addChatMembers(channelId: number, member_ids: number[]) {
    return request<ChatChannel>(`/api/chat/channels/${channelId}/members`, { method: "POST", body: JSON.stringify({ member_ids }) });
  },
  async getChatMessages(channelId: number, params?: { after_id?: number; before_id?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.after_id) qs.set("after_id", String(params.after_id));
    if (params?.before_id) qs.set("before_id", String(params.before_id));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return request<ChatMessage[]>(`/api/chat/channels/${channelId}/messages${q ? `?${q}` : ""}`);
  },
  async sendChatMessage(channelId: number, text: string, reply_to?: number) {
    return request<ChatMessage>(`/api/chat/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ text, reply_to }) });
  },
  async markChatRead(channelId: number, last_message_id: number) {
    return request(`/api/chat/channels/${channelId}/read`, { method: "POST", body: JSON.stringify({ last_message_id }) });
  },
  async deleteChatMessage(messageId: number) {
    return request(`/api/chat/messages/${messageId}`, { method: "DELETE" });
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  full_name?: string;
  email?: string;
  phone?: string;
  role: string;
  is_active: boolean;
  departments_access: string[];
  user_permissions: Record<string, boolean>;
  photo_url?: string;
  last_login?: string;
  created_at?: string;
  birth_date?: string;
  completed_orders_count?: number;
}

export interface Component {
  id: number;
  name: string;
  stock: number;
  category: string;
  unit?: string;
  min_stock?: number;
  comment?: string;
  units_per_reel?: number;
  block: string;
  package_type?: string;
  size?: string;
  capacitance?: string;
  voltage?: string;
  tolerance?: string;
  reserved_qty: number;
  available: number;
  source?: string;
}

export interface ComponentRequest {
  id: number;
  order_id: number;
  stage_id?: number | null;
  component_name: string;
  qty: number;
  reason: string;
  status: string;           // pending | issued | rejected
  status_label?: string;
  requested_by?: number;
  requested_by_name?: string;
  issued_by?: number | null;
  issued_by_name?: string | null;
  comment?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  warehouse_type: string;   // main | smd | rea | finished | defect
  type_label?: string;
  address?: string;
  is_active: boolean;
  positions_count?: number;
  total_quantity?: number;
}

export interface WarehouseStockRow {
  warehouse_id: number;
  warehouse_name?: string;
  warehouse_type?: string;
  component_name: string;
  quantity: number;
  reserved: number;
  available: number;
}

export interface OrderDemandComponent {
  component_name: string;
  production_type: string;
  source: string;
  norm: number;
  required: number;
  available: number;
  shortage: number;
  canProduce: boolean;
}

export interface OrderDemandResult {
  canProduce: boolean;
  message?: string;
  components: OrderDemandComponent[];
  by_department: Record<string, OrderDemandComponent[]>;
}

export interface Supplier {
  id: number;
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  note?: string;
  is_active: boolean;
}

export interface PurchaseItemIn {
  component_name: string;
  quantity: number;
  unit_price?: number | null;
  note?: string;
}

export interface PurchaseItemOut {
  id: number;
  component_name: string;
  quantity: number;
  received_qty: number;
  unit_price?: number | null;
  note?: string;
}

export interface PurchaseRequest {
  id: number;
  supplier_id?: number | null;
  supplier_name?: string | null;
  status: string;            // draft | ordered | received | cancelled
  status_label: string;
  note?: string;
  order_ref?: string;
  created_by?: string;
  created_at?: string;
  items: PurchaseItemOut[];
  total_qty: number;
  total_cost: number;
}

export interface BatchItem {
  name: string;
  qty: number;
  isNew?: boolean;
  category?: string;
}

export interface Operation {
  id: number;
  operation_id?: string;
  operation_date: string;
  operation_type: string;
  component_name?: string;
  quantity?: number;
  note?: string;
  operator_id?: string;
  created_at?: string;
}

export interface ProductionStock {
  id: number;
  component_name: string;
  quantity: number;
  category: string;
  block: string;
  updated_at: string;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string;        // JSON-строка массива событий
  secret?: string;
  is_active: boolean;
  last_status?: string;
  last_called_at?: string;
}

export interface NotificationSubscription {
  id: number;
  user_id?: number;
  role?: string;
  event_type: string;
  enabled: boolean;
}

export interface OrdersAnalytics {
  kpi: {
    completed_today: number;
    completed_week: number;
    completed_month: number;
    created_today: number;
    active_total: number;
    overdue: number;
    avg_cycle_hours: number | null;
  };
  by_status: { label: string; value: number }[];
  by_department: { label: string; value: number }[];
  completion_trend: { day: string; value: number }[];
}

export interface OrderPosition {
  id?: number | null;          // id позиции (order_items.id); null = legacy виртуальная позиция
  product_name: string;        // изделие из каталога
  name?: string;               // legacy-алиас наименования
  qty?: number | null;         // количество
  planned_qty?: number | null;
  actual_qty?: number | null;
  status?: string;             // статус позиции
  sort_order?: number;
  stages_total?: number;
  stages_done?: number;
  stages?: OrderStage[];       // этапы позиции (в детальном ответе get_order)
  legacy?: boolean;
}

export interface Order {
  id: number;
  product_name: string;
  planned_qty: number;
  positions?: OrderPosition[];   // позиции заказа (изделие + кол-во + своё производство)
  positions_count?: number;
  received_date?: string;        // дата получения
  shipment_date?: string;        // дата отправки
  actual_qty?: number;
  status: string;
  priority: string;
  deadline?: string;
  comment?: string;
  assigned_operator_id?: string;
  assigned_operator_name?: string;
  assigned_department?: string;
  otk_comment?: string;
  otk_rejection_photo?: string;
  otk_attempts?: number;
  tags?: string;            // JSON список тегов
  managers?: string[];      // id руководителей проекта
  manager_names?: string[];
  can_close?: boolean;      // может ли текущий пользователь закрыть заказ
  parent_order_id?: number; // родительский заказ (если это авто-под-заказ на полуфабрикат)
  stages_total?: number;
  stages_done?: number;
  created_at: string;
  updated_at?: string;
  batch_id?: string;
  has_paused_batches?: boolean;
  has_running_batches?: boolean;
}

export interface Batch {
  batch_id: string;
  product_name: string;
  production_type: string;
  planned_qty: number;
  actual_qty?: number;
  operator_id?: string;
  operator_name?: string;
  status: string;
  start_date?: string;
  end_date?: string;
  order_id?: number;
  order_status?: string;
}

export interface OtkAnalytics {
  days: number;
  kpi: { released: number; good: number; defect: number; batches: number; defect_rate: number };
  by_department: { label: string; released: number; good: number; defect: number; batches: number; rate: number }[];
  pareto: { label: string; value: number }[];
  trend: { date: string; defect: number; released: number }[];
}

export interface LowStockItem {
  id: number;
  name: string;
  stock: number;
  reserved: number;
  available: number;
  min_stock: number;
  unit?: string;
  category?: string;
  deficit: number;
}

export interface OtkBatch {
  batch_id: string;
  product_name: string;
  production_type: string;
  released_qty: number;
  good_qty?: number;
  defect_qty?: number;
  status: string;
  receive_date?: string;
  check_date?: string;
  maker_id?: string;
  maker_name?: string;
  order_id?: number;
  defect_comment?: string;
}

export interface OtkReport {
  date_from: string;
  date_to: string;
  summary: {
    total_batches: number;
    total_good: number;
    total_defect: number;
    quality_rate: number;
  };
  batches: OtkBatch[];
}

export interface DefectType {
  id: number;
  category: string;
  subdescription: string;
}

export interface RegulationProblem {
  id: number;
  product_name: string;
  problem: string;
  solution: string;
  sort_order: number;
}

export interface Recipe {
  id: number;
  component_name: string;
  product_name: string;
  norm: number;
  production_type: string;
  source?: string;
  warehouse_component_name?: string;
  designator?: string;
  board_side?: string;
  component_size?: string;
  stock_on_warehouse?: number;
}

export interface Case {
  id: number;
  name: string;
  source: string;
  stock: number;
  min_stock: number;
  color?: string;
  material?: string;
  comment?: string;
}

export interface RecipeCase {
  id: number;
  product_name: string;
  case_name: string;
  source: string;
  qty: number;
  comment?: string;
}

export interface OrderStage {
  id: number;
  order_id: number;
  order_item_id?: number | null;   // позиция заказа, к которой относится этап
  stage_type: string;
  stage_name?: string;
  status: string;
  sort_order: number;
  assigned_to?: string;
  assigned_name?: string;
  accepted_by?: string | null;   // кто принял задачу (закреплена за ним)
  accepted_at?: string | null;
  required_role?: string;
  depends_on_previous?: number;
  transfer_qty?: number;
  transferred_qty?: number;
  instructions?: string;
  next_stage_id?: number | null;
  on_fail_stage_id?: number | null;     // ребро графа: куда уходит брак на гейте (напр. Ремонт РЭА)
  rework_target_type?: string | null;   // legacy: тип этапа возврата брака (если нет on_fail_stage_id)
  components: { name: string; qty: number; source?: string }[];
  est_minutes?: number | null;
  checklist?: string;        // JSON-строка [{text, done}]
  result_photo?: string | null;
  pause_reason?: string | null;
  paused_at?: string | null;
  started_at?: string;
  completed_at?: string;
  comment?: string;
}

export interface RouteTemplateStage {
  stage_name?: string;
  stage_type: string;
  required_role?: string | null;
  sort_order?: number;
  depends_on_previous?: number;
  instructions?: string | null;
  est_minutes?: number | null;
}

export interface RouteTemplate {
  id: number;
  name: string;
  description?: string | null;
  stages: RouteTemplateStage[];
  created_at?: string;
}

export interface RecipeStage {
  id: number;
  product_name: string;
  stage_name: string;
  stage_type: string;
  sort_order: number;
  description?: string;
  instructions?: string;
  required_role?: string;
  depends_on_previous?: number;
  transfer_qty?: number;
}

export interface MyStage extends OrderStage {
  order_product_name: string;
  order_planned_qty: number;
  order_deadline?: string;
  item_product_name?: string;   // продукт ПОЗИЦИИ этапа (приоритетнее заголовка)
  item_planned_qty?: number;
}

export interface MyOrder extends Order {
  my_stages: (OrderStage & {
    components: { name: string; qty: number; source?: string }[];
    item_product_name?: string;
    item_planned_qty?: number;
  })[];
}

export interface AvailabilityItem {
  component_name: string;
  required_qty: number;
}

export interface AvailabilityResult {
  component_name: string;
  required_qty: number;
  available_qty: number;
  ok: boolean;
}

export interface ComponentDemand {
  component_name: string;
  required: number;
  available: number;
  shortage: number;
  canProduce: boolean;
}

export interface DemandResult {
  component: string;
  totalRequired: number;
  stock: number;
  shortage: number;
}

export interface Operator {
  id: number;
  name: string;
  role: string;
  employee_id: string;
}

export interface OperatorStats {
  employee_id: string;
  name: string;
  role: string;
  batches_count: number;
  total_produced: number;
  completed_batches: number;
  completed_orders_count: number;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigned_operator_id?: string;
  assigned_operator_name?: string;
  created_by?: number;
  created_by_name?: string;
  completed_by?: number;
  completed_by_name?: string;
  created_at: string;
  completed_at?: string;
}

export interface Shift {
  id: number;
  shift_date: string;
  shift_type: string;
  start_time?: string;
  end_time?: string;
  operator_id: string;
  operator_name?: string;
  department?: string;
  comment?: string;
  status: string;
  actual_hours?: number;
}

export interface ShiftsReport {
  period: { start_date: string; end_date: string };
  employees: {
    employee_id: string;
    employee_name: string;
    employee_role: string;
    shifts: Shift[];
    total_hours: number;
    total_shifts: number;
  }[];
}

export interface ChecklistItem {
  id: string;
  text: string;
}

export const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "default-machines-state", text: "Проверено состояние станков" },
  { id: "default-workplace-order", text: "Проверен порядок на производстве" },
];

export interface FirmwareBatch {
  id: number;
  batch_id: string;
  source_batch_id: string;
  product_name: string;
  qty: number;
  good_qty?: number;
  defect_qty?: number;
  operator_id: string;
  operator_name?: string;
  firmware_version?: string;
  status: string;
  start_date?: string;
  end_date?: string;
}

export interface FinishedGood {
  id: number;
  product_name: string;
  good_qty: number;
  defect_qty: number;
  total_qty: number;
  updated_at: string;
}

export interface DocFile {
  id: number;
  name: string;
  description?: string;
  category?: string;
  tags?: string;
  file_name: string;
  file_type: string;
  file_size: number;
  content?: string;
  created_by?: number;
  created_at: string;
  updated_at: string;
}

export interface StageTypeItem {
  id: number;
  code: string;
  label: string;
  color: string;
  icon?: string;
  sort_order: number;
  is_active: boolean;
}

export interface SystemRoleItem {
  id: number;
  code: string;
  label: string;
  allowed_stage_types: string[];
  is_production: boolean;
  is_active: boolean;
}

export interface OrderStatusItem {
  id: number;
  code: string;
  label: string;
  color: string;
  is_terminal: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface StatusTransitionItem {
  id: number;
  from_status: string;
  to_status: string;
  allowed_roles: string[];
}

export interface PriorityItem {
  id: number;
  code: string;
  label: string;
  color: string;
  sort_weight: number;
  is_active: boolean;
}

export interface NotificationItem {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message?: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

export interface CustomFieldDef {
  id: number;
  name: string;
  label: string;
  field_type: "text" | "number" | "date" | "select";
  required: boolean;
  options: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SlaRule {
  id: number;
  status: string;
  max_hours: number;
  notify_roles: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SlaViolation {
  order_id: number;
  product_name: string;
  status: string;
  updated_at: string;
  hours_overdue: number;
  sla_max_hours: number;
}

export interface OrderComment {
  id: number;
  order_id: number;
  user_id: number;
  user_name?: string;
  text: string;
  created_at: string;
  updated_at: string;
}

export interface StageAssignee {
  id: number;
  stage_id: number;
  user_id: number;
  user_name?: string;
  qty_planned: number;
  qty_done: number;
  status: "pending" | "in_progress" | "done";
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLogItem {
  id: number;
  entity_type: string;
  entity_id?: number;
  user_id?: number;
  user_name?: string;
  action: string;
  old_value?: string;
  new_value?: string;
  details?: string;
  created_at: string;
}

export interface ProductCatalogItem {
  id: number;
  name: string;
  sku?: string;
  category?: string;
  description?: string;
  unit: string;
  is_active: boolean;
  needs_smd?: boolean;        // признаки канонического маршрута по ТЗ
  is_receiver?: boolean;
  needs_assembly?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatChannel {
  id: number;
  kind: "group" | "direct" | "order";
  name?: string;
  order_id?: number | null;
  unread: number;
  members: { user_id: number; user_name?: string }[];
  member_count: number;
  last_message?: string | null;
  last_message_author?: string | null;
  last_message_at?: string | null;
  updated_at?: string | null;
}

export interface ChatMessage {
  id: number;
  channel_id: number;
  user_id: number;
  user_name?: string;
  text: string;
  reply_to?: number | null;
  is_deleted: boolean;
  created_at: string;
  edited_at?: string | null;
}
