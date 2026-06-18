// API конфигурация
// Если файл открыт через file://, используем localhost:3000
// Если через http://, используем тот же origin
const API_BASE_URL = (window.location.protocol === 'file:' || window.location.origin.includes('localhost'))
    ? 'http://localhost:3000' 
    : window.location.origin;

// Логирование URL для отладки
console.log('🌐 API Base URL:', API_BASE_URL);
console.log('📍 Current Origin:', window.location.origin);
console.log('🔗 Current Protocol:', window.location.protocol);

// Хранение токена
let authToken = localStorage.getItem('crm_token') || null;

// Вспомогательные функции для работы с API
const api = {
    async request(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        console.log(`📡 API Request: ${options.method || 'GET'} ${url}`);
        
        try {
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };

            // Добавляем токен авторизации, если есть
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }

            const response = await fetch(url, {
                headers,
                ...options
            });

            console.log(`📥 API Response: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                // Если 401 (Unauthorized), очищаем токен
                if (response.status === 401) {
                    this.clearToken();
                    // Если это не страница входа, перенаправляем на вход
                    if (!window.location.pathname.includes('login')) {
                        window.location.reload();
                    }
                }
                
                let errorMessage = `HTTP ${response.status}`;
                let errorDetails = null;
                try {
                    // Клонируем response чтобы можно было прочитать его несколько раз
                    const text = await response.clone().text();
                    try {
                        const error = JSON.parse(text);
                        errorMessage = error.error || error.message || errorMessage;
                        // Сохраняем детали ошибки (например, missing_components)
                        errorDetails = error;
                    } catch (e) {
                        // Если не JSON, используем текст
                        errorMessage = text || errorMessage;
                    }
                } catch (e) {
                    // Если не удалось прочитать, используем стандартное сообщение
                    console.error('Ошибка чтения ответа:', e);
                }
                const error = new Error(errorMessage);
                // Добавляем детали ошибки в объект ошибки
                if (errorDetails) {
                    Object.assign(error, errorDetails);
                }
                throw error;
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('API Error:', error);
            console.error('   URL:', url);
            console.error('   Method:', options.method || 'GET');
            
            // Если это ошибка сети, добавляем дополнительную информацию
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error(`Не удалось подключиться к серверу. Проверьте, что API запущен на ${API_BASE_URL}`);
            }
            
            throw error;
        }
    },

    // Сохранить токен
    setToken(token) {
        authToken = token;
        localStorage.setItem('crm_token', token);
    },

    // Получить токен
    getToken() {
        return authToken;
    },

    // Удалить токен
    clearToken() {
        authToken = null;
        localStorage.removeItem('crm_token');
    },

    // Warehouse
    async getComponents() {
        return this.request('/api/warehouse/components');
    },

    async createComponent(data) {
        return this.request('/api/warehouse/components', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateComponent(id, data) {
        return this.request(`/api/warehouse/components/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteComponent(id) {
        return this.request(`/api/warehouse/components/${id}`, {
            method: 'DELETE'
        });
    },

    async verifyReservations() {
        return this.request('/api/warehouse/components/verify-reservations', {
            method: 'POST'
        });
    },

    async batchOperation(type, items, operationId, toProduction = false, writeoffReason = null, writeoffComment = '', employeeId = null) {
        return this.request('/api/warehouse/batch', {
            method: 'POST',
            body: JSON.stringify({ operationType: type, items, operationId, toProduction, writeoffReason, writeoffComment, employeeId })
        });
    },

    async getCategories() {
        return this.request('/api/warehouse/categories');
    },

    // История операций склада
    async getWarehouseOperations(params = {}) {
        const queryParams = new URLSearchParams();
        if (params.limit) queryParams.append('limit', params.limit);
        if (params.offset) queryParams.append('offset', params.offset);
        if (params.component_name) queryParams.append('component_name', params.component_name);
        if (params.operation_type) queryParams.append('operation_type', params.operation_type);
        if (params.date_from) queryParams.append('date_from', params.date_from);
        if (params.date_to) queryParams.append('date_to', params.date_to);
        const queryString = queryParams.toString();
        return this.request(`/api/warehouse/operations${queryString ? '?' + queryString : ''}`);
    },

    async getWarehouseOperationTypes() {
        return this.request('/api/warehouse/operations/types');
    },

    // Recipes
    async getRecipes() {
        return this.request('/api/recipes');
    },

    async createRecipe(data) {
        return this.request('/api/recipes', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async getRecipe(id) {
        return this.request(`/api/recipes/${id}`);
    },

    async getRecipesByProduct(productName, type) {
        return this.request(`/api/recipes/product/${encodeURIComponent(productName)}/${encodeURIComponent(type)}`);
    },

    async updateRecipe(id, data) {
        return this.request(`/api/recipes/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteRecipe(id) {
        return this.request(`/api/recipes/${id}`, {
            method: 'DELETE'
        });
    },

    // Вложения рецептур (фото, схемы) по изделию (query — надёжно для кириллицы и пробелов)
    async getRecipeAttachments(productName) {
        const q = encodeURIComponent(productName || '');
        return this.request(`/api/recipes/attachments/by-product?product_name=${q}`);
    },

    async uploadRecipeAttachment(formData) {
        const url = `${API_BASE_URL}/api/recipes/attachments/upload`;
        const headers = { 'Authorization': authToken ? `Bearer ${authToken}` : '' };
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: formData
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(err.error || `HTTP ${response.status}`);
        }
        return response.json();
    },

    async deleteRecipeAttachment(id) {
        return this.request(`/api/recipes/attachments/${id}`, {
            method: 'DELETE'
        });
    },

    getAttachmentUrl(filePath) {
        if (!filePath) return '';
        const base = filePath.startsWith('http') ? '' : API_BASE_URL;
        return base + (filePath.startsWith('/') ? filePath : '/' + filePath);
    },

    getRecipeAttachmentFileUrl(id) {
        return `${API_BASE_URL}/api/recipes/attachments/${encodeURIComponent(id)}/file`;
    },

    async openRecipeAttachmentInNewTab(id) {
        const url = this.getRecipeAttachmentFileUrl(id);
        const res = await fetch(url, {
            headers: { 'Authorization': authToken ? `Bearer ${authToken}` : '' }
        });
        if (!res.ok) throw new Error(res.status === 404 ? 'Файл не найден' : 'Не удалось загрузить файл');
        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') || '';
        let filename = '';
        const fnMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i) || disposition.match(/filename=["']?([^"';]+)["']?/i);
        if (fnMatch && fnMatch[1]) filename = decodeURIComponent(fnMatch[1].trim());
        if (!filename) filename = `attachment_${id}`;
        const u = URL.createObjectURL(blob);
        const isImage = (blob.type && blob.type.startsWith('image/'));
        if (isImage) {
            const w = window.open(u, '_blank');
            if (w) setTimeout(() => URL.revokeObjectURL(u), 60000);
            else URL.revokeObjectURL(u);
        } else {
            const a = document.createElement('a');
            a.href = u;
            a.download = filename;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(u), 1000);
        }
    },

    async getProducts(type) {
        const endpoint = type ? `/api/recipes/products/type/${encodeURIComponent(type)}` : '/api/recipes/products';
        return this.request(endpoint);
    },

    async getPlans(startDate, endDate) {
        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        const query = params.toString();
        return this.request(`/api/planning${query ? '?' + query : ''}`);
    },

    async getPlansByDate(date) {
        return this.request(`/api/planning/date/${date}`);
    },

    async createPlan(planData) {
        return this.request('/api/planning', {
            method: 'POST',
            body: JSON.stringify(planData)
        });
    },

    async updatePlan(id, planData) {
        return this.request(`/api/planning/${id}`, {
            method: 'PUT',
            body: JSON.stringify(planData)
        });
    },

    async deletePlan(id) {
        return this.request(`/api/planning/${id}`, {
            method: 'DELETE'
        });
    },

    async calculateDemand(plan) {
        return this.request('/api/recipes/calculate-demand', {
            method: 'POST',
            body: JSON.stringify({ plan })
        });
    },

    async getMaxProduction(productName) {
        return this.request(`/api/recipes/max-production/${encodeURIComponent(productName)}`);
    },

    // Production
    async getProductionBatches() {
        return this.request('/api/production/batches');
    },

    async startProduction(data) {
        return this.request('/api/production/start', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async startBatchById(batchId, operatorIds, additionalData = {}) {
        const requestBody = {
            operatorIds: operatorIds,
            ...additionalData
        };
        return this.request(`/api/production/start-batch/${encodeURIComponent(batchId)}`, {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });
    },

    async startBatchWithAssignments(batchId, requestData) {
        return this.request(`/api/production/start-batch/${encodeURIComponent(batchId)}`, {
            method: 'POST',
            body: JSON.stringify(requestData)
        });
    },

    async pauseProductionShift(batchId, qtyProduced, comment) {
        return this.request('/api/production/pause-shift', {
            method: 'POST',
            body: JSON.stringify({ batchId, qtyProduced, comment })
        });
    },

    async completeProduction(batchId, actualQty) {
        return this.request('/api/production/complete', {
            method: 'POST',
            body: JSON.stringify({ batchId, actualQty })
        });
    },

    async cancelProduction(batchId) {
        return this.request('/api/production/cancel', {
            method: 'POST',
            body: JSON.stringify({ batchId })
        });
    },

    async updateProductionBatch(batchId, data) {
        return this.request(`/api/production/batches/${encodeURIComponent(batchId)}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteProductionBatch(batchId) {
        return this.request(`/api/production/batches/${encodeURIComponent(batchId)}`, {
            method: 'DELETE'
        });
    },

    // OTK
    async getOTKBatches(status) {
        const q = status ? `?status=${encodeURIComponent(status)}` : '';
        return this.request(`/api/otk/batches${q}`);
    },
    async deleteOTKBatch(batchId) {
        return this.request(`/api/otk/batches/${encodeURIComponent(batchId)}`, { method: 'DELETE' });
    },

    async completeOTKCheck(data) {
        return this.request('/api/otk/check', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async saveDefectRecords(batchId, records, comment) {
        return this.request('/api/otk/batches/defects', {
            method: 'POST',
            body: JSON.stringify({ batchId, records, comment })
        });
    },

    async getDefectCategories() {
        return this.request('/api/otk/defect-categories').catch(() => []);
    },
    async getDefectTypes() {
        return this.request('/api/otk/defect-types').catch(() => []);
    },

    // Ready to Ship
    async getReadyToShipOrders() {
        return this.request('/api/otk/ready-to-ship');
    },

    async shipPartial(shipments) {
        return this.request('/api/otk/ship-partial', {
            method: 'POST',
            body: JSON.stringify({ shipments })
        });
    },

    async getOtkReports(dateFrom, dateTo) {
        const q = new URLSearchParams();
        if (dateFrom) q.set('date_from', dateFrom);
        if (dateTo) q.set('date_to', dateTo);
        return this.request(`/api/otk/reports?${q.toString()}`);
    },
    async deleteOtkReportBatch(batchId) {
        return this.request(`/api/otk/reports/batch/${encodeURIComponent(batchId)}`, { method: 'DELETE' });
    },

    // Регламенты ОТК
    async getRegulationProducts() {
        return this.request('/api/otk/regulations/products');
    },
    async getRegulationProduct(productName) {
        return this.request(`/api/otk/regulations/product/${encodeURIComponent(productName)}`);
    },
    async getRegulationProblems(product) {
        const q = product ? `?product=${encodeURIComponent(product)}` : '';
        return this.request(`/api/otk/regulations/problems${q}`);
    },
    async addRegulationProblem(data) {
        return this.request('/api/otk/regulations/problems', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    async updateRegulationProblem(id, data) {
        return this.request(`/api/otk/regulations/problems/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },
    async deleteRegulationProblem(id) {
        return this.request(`/api/otk/regulations/problems/${id}`, { method: 'DELETE' });
    },
    async getRegulationDefectPhotos(product) {
        const q = product ? `?product=${encodeURIComponent(product)}` : '';
        return this.request(`/api/otk/regulations/defect-photos${q}`).catch(() => []);
    },
    async addRegulationDefectPhoto(formData) {
        const url = `${this.API_BASE_URL}/api/otk/regulations/defect-photos`;
        const headers = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(url, { method: 'POST', headers, body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || res.statusText);
        }
        return res.json();
    },
    async updateRegulationDefectPhoto(id, data) {
        return this.request(`/api/otk/regulations/defect-photos/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },
    async deleteRegulationDefectPhoto(id) {
        return this.request(`/api/otk/regulations/defect-photos/${id}`, { method: 'DELETE' });
    },
    async getRegulationMeasurements(product) {
        const q = product ? `?product=${encodeURIComponent(product)}` : '';
        return this.request(`/api/otk/regulations/measurements${q}`).catch(() => []);
    },
    async addRegulationMeasurement(data) {
        return this.request('/api/otk/regulations/measurements', { method: 'POST', body: JSON.stringify(data) });
    },
    async deleteRegulationMeasurement(id) {
        return this.request(`/api/otk/regulations/measurements/${id}`, { method: 'DELETE' });
    },
    async getRegulationReplacements(product) {
        const q = product ? `?product=${encodeURIComponent(product)}` : '';
        return this.request(`/api/otk/regulations/replacements${q}`).catch(() => []);
    },
    async addRegulationReplacement(data) {
        return this.request('/api/otk/regulations/replacements', { method: 'POST', body: JSON.stringify(data) });
    },
    async deleteRegulationReplacement(id) {
        return this.request(`/api/otk/regulations/replacements/${id}`, { method: 'DELETE' });
    },
    async getRegulationTools(product) {
        const q = product ? `?product=${encodeURIComponent(product)}` : '';
        return this.request(`/api/otk/regulations/tools${q}`).catch(() => []);
    },
    async addRegulationTool(data) {
        return this.request('/api/otk/regulations/tools', { method: 'POST', body: JSON.stringify(data) });
    },
    async deleteRegulationTool(id) {
        return this.request(`/api/otk/regulations/tools/${id}`, { method: 'DELETE' });
    },

    // Сервисный центр (СЦ)
    async getScBatches() {
        return this.request('/api/sc/batches');
    },
    async getScHistory() {
        return this.request('/api/sc/history');
    },
    async completeScRepair(data) {
        return this.request('/api/sc/complete-repair', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    async getScRepairsByOrder(orderId) {
        return this.request(`/api/sc/repairs-by-order/${orderId}`);
    },

    // Operators
    async getOperators(role, options = {}) {
        let endpoint = role ? `/api/operators/role/${role}` : '/api/operators';
        if (!role && options.activeOnly) {
            endpoint += (endpoint.includes('?') ? '&' : '?') + 'active_only=1';
        }
        return this.request(endpoint);
    },

    // Статистика операторов
    async getOperatorsStats(period = 'all') {
        return this.request(`/api/operators/stats?period=${period}&t=${Date.now()}`);
    },

    async getOperatorDetailStats(employeeId, period = 'all', productionType = null) {
        let url = `/api/operators/${employeeId}/stats?period=${period}&t=${Date.now()}`;
        if (productionType) {
            url += `&production_type=${encodeURIComponent(productionType)}`;
        }
        return this.request(url);
    },

    async createOperator(data) {
        return this.request('/api/operators', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateOperator(id, data) {
        return this.request(`/api/operators/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteOperator(id) {
        return this.request(`/api/operators/${id}`, {
            method: 'DELETE'
        });
    },

    // Operations
    async getOperations(limit = 100) {
        return this.request(`/api/operations?limit=${limit}`);
    },

    async getCancellableOperations() {
        return this.request('/api/operations/cancellable');
    },

    async cancelOperation(operationId) {
        return this.request('/api/operations/cancel', {
            method: 'POST',
            body: JSON.stringify({ operationId })
        });
    },

    // Finished Goods
    async getFinishedGoods() {
        return this.request('/api/finished-goods');
    },

    // Health check
    async healthCheck() {
        return this.request('/api/health');
    },

    async getClientVersion() {
        return this.request('/api/client-version', {
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
    },
    
    // Получить базовый URL (для отображения)
    get API_BASE_URL() {
        return API_BASE_URL;
    },

    // Auth
    async login(username, password) {
        const result = await this.request('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        if (result.token) {
            this.setToken(result.token);
        }
        return result;
    },

    async register(userData) {
        // username is now required from the frontend
        return this.request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    },

    async getCurrentUser() {
        return this.request('/api/auth/me');
    },

    async changePassword(oldPassword, newPassword) {
        return this.request('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ oldPassword, newPassword })
        });
    },

    // Users Management (только для админов)
    async getUsers(includeInactive = false) {
        const q = includeInactive ? '?include_inactive=1' : '';
        return this.request('/api/auth/users' + q);
    },

    async createUser(userData) {
        return this.request('/api/auth/users', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    },

    async updateUser(userId, userData) {
        return this.request(`/api/auth/users/${userId}`, {
            method: 'PUT',
            body: JSON.stringify(userData)
        });
    },

    async deleteUser(userId, permanent = false) {
        const url = permanent 
            ? `/api/auth/users/${userId}?permanent=true`
            : `/api/auth/users/${userId}`;
        return this.request(url, { method: 'DELETE' });
    },

    // Публичная регистрация
    async register(userData) {
        return this.request('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    },

    // Получить заявки на регистрацию (только админ)
    async getPendingRegistrations() {
        return this.request('/api/auth/pending-registrations');
    },

    // Подтвердить регистрацию (только админ)
    async approveRegistration(userId, operatorFunction, departmentsAccess, employeeId) {
        return this.request(`/api/auth/approve-registration/${userId}`, {
            method: 'POST',
            body: JSON.stringify({ 
                operator_function: operatorFunction,
                departments_access: departmentsAccess || [],
                employee_id: employeeId || null
            })
        });
    },

    // Отклонить регистрацию (только админ)
    async rejectRegistration(userId) {
        return this.request(`/api/auth/reject-registration/${userId}`, {
            method: 'POST'
        });
    },

    // Запрос на восстановление пароля
    async requestPasswordReset(email) {
        return this.request('/api/auth/request-password-reset', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
    },

    // Сброс пароля по токену
    async resetPassword(token, newPassword) {
        return this.request('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({ token, newPassword })
        });
    },

    // Orders Management
    async recalculateOrderStatuses() {
        return this.request('/api/orders/recalculate-statuses', { method: 'POST' });
    },

    // Запасы на производстве
    async getProductionStock() {
        return this.request('/api/production-stock');
    },

    async getProductionStockByNames(names) {
        return this.request('/api/production-stock/by-names', {
            method: 'POST',
            body: JSON.stringify({ names })
        });
    },

    async addProductionStock(component_name, quantity, category) {
        return this.request('/api/production-stock/add', {
            method: 'POST',
            body: JSON.stringify({ component_name, quantity, category })
        });
    },

    async setProductionStock(component_name, quantity, category) {
        return this.request('/api/production-stock/set', {
            method: 'POST',
            body: JSON.stringify({ component_name, quantity, category })
        });
    },

    async transferFromWarehouse(component_name, quantity) {
        return this.request('/api/production-stock/transfer-from-warehouse', {
            method: 'POST',
            body: JSON.stringify({ component_name, quantity })
        });
    },

    async deleteProductionStock(id) {
        return this.request(`/api/production-stock/${id}`, { method: 'DELETE' });
    },

    async getOrders(status, search, includeStatuses) {
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (search) params.append('search', search);
        // По умолчанию показываем все активные заказы (исключая только завершенные)
        if (includeStatuses) {
            params.append('include_statuses', includeStatuses);
        }
        const query = params.toString();
        return this.request(`/api/orders${query ? '?' + query : ''}`);
    },

    async getArchiveOrders(search, startDate, endDate) {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        const query = params.toString();
        return this.request(`/api/orders/archive${query ? '?' + query : ''}`);
    },

    async startOrder(orderId, operatorId = null) {
        const body = operatorId ? { operator_id: operatorId } : {};
        return this.request(`/api/orders/${orderId}/start`, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    },

    async getMyOrders(status) {
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        const query = params.toString();
        return this.request(`/api/orders/my-orders${query ? '?' + query : ''}`);
    },

    async getOrder(id) {
        return this.request(`/api/orders/${id}`);
    },

    async createOrder(orderData) {
        return this.request('/api/orders', {
            method: 'POST',
            body: JSON.stringify(orderData)
        });
    },

    async updateOrder(id, orderData) {
        return this.request(`/api/orders/${id}`, {
            method: 'PUT',
            body: JSON.stringify(orderData)
        });
    },

    async updateOrderStatus(id, status) {
        return this.request(`/api/orders/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
    },

    // Ежедневный прогресс по заказам
    async addOrderDailyProgress(orderId, progressData) {
        return this.request(`/api/orders/${orderId}/daily-progress`, {
            method: 'POST',
            body: JSON.stringify(progressData)
        });
    },

    async getOrderDailyProgress(orderId, startDate = null, endDate = null) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        const query = params.toString();
        return this.request(`/api/orders/${orderId}/daily-progress${query ? '?' + query : ''}`);
    },

    async getAllDailyProgress(startDate, endDate) {
        return this.request(`/api/orders/daily-progress-all?start_date=${startDate}&end_date=${endDate}`);
    },

    async deleteOrder(id) {
        return this.request(`/api/orders/${id}`, {
            method: 'DELETE'
        });
    },

    async deleteOrderPermanently(id) {
        return this.request(`/api/orders/${id}/delete`, {
            method: 'DELETE'
        });
    },

    async getOrderStats(id) {
        return this.request(`/api/orders/${id}/stats`);
    },

    async calculatorCalculate(data) {
        return this.request('/api/orders/calculator/calculate', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async calculatorApply(data) {
        return this.request('/api/orders/calculator/apply', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async getOrderPlan(orderId) {
        return this.request(`/api/orders/${orderId}/plan`);
    },

    async createOrderPlan(orderId, data) {
        return this.request(`/api/orders/${orderId}/plan`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateOrderPlan(orderId, data) {
        return this.request(`/api/orders/${orderId}/plan`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async getLineTemplates() {
        return this.request('/api/line-templates');
    },

    async getLineTemplate(id) {
        return this.request(`/api/line-templates/${id}`);
    },

    async createLineTemplate(data) {
        return this.request('/api/line-templates', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateLineTemplate(id, data) {
        return this.request(`/api/line-templates/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteLineTemplate(id) {
        return this.request(`/api/line-templates/${id}`, {
            method: 'DELETE'
        });
    },

    async getOrderComponentDemand(id) {
        return this.request(`/api/orders/${id}/component-demand`);
    },

    async getMaxProduction(productName, excludeOrderId) {
        const params = new URLSearchParams();
        if (excludeOrderId) params.append('excludeOrderId', excludeOrderId);
        const query = params.toString();
        return this.request(`/api/recipes/max-production/${encodeURIComponent(productName)}${query ? '?' + query : ''}`);
    },

    async calculateOrderDemand(data) {
        return this.request('/api/recipes/calculate-order-demand', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    // Firmware Management
    async getFirmwareBatches(status, source_batch_id) {
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        if (source_batch_id) params.append('source_batch_id', source_batch_id);
        const query = params.toString();
        return this.request(`/api/firmware${query ? '?' + query : ''}`);
    },

    async getFirmwareBatch(id) {
        return this.request(`/api/firmware/${id}`);
    },

    async createFirmwareBatch(data) {
        return this.request('/api/firmware', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async completeFirmwareBatch(id, data) {
        return this.request(`/api/firmware/${id}/complete`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateFirmwareBatch(id, data) {
        return this.request(`/api/firmware/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },


    // Users (рейтинг, дни рождения, фото)
    async getTopUsers() {
        // Добавляем timestamp для предотвращения кэширования
        return this.request(`/api/users/rating/top?t=${Date.now()}`);
    },

    async getBirthdaysToday() {
        return this.request('/api/users/birthdays/today');
    },

    // Получить последние операции
    async getRecentActivity(limit = 3) {
        return this.request(`/api/activity/recent?limit=${limit}`);
    },

    async getUserProfile(userId) {
        return this.request(`/api/users/${userId}/profile`);
    },

    async updateUserPhoto(userId, photoUrl) {
        return this.request(`/api/users/${userId}/photo`, {
            method: 'PUT',
            body: JSON.stringify({ photo_url: photoUrl })
        });
    },


    // Shift Schedule
    async getShifts(startDate, endDate, operatorId, department, shiftType, status) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        if (operatorId) params.append('operator_id', operatorId);
        if (department) params.append('department', department);
        if (shiftType) params.append('shift_type', shiftType);
        if (status) params.append('status', status);
        const query = params.toString();
        return this.request(`/api/shifts${query ? '?' + query : ''}`);
    },

    async getMyShifts(startDate, endDate) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        const query = params.toString();
        return this.request(`/api/shifts/my-shifts${query ? '?' + query : ''}`);
    },

    async createShift(shiftData) {
        return this.request('/api/shifts', {
            method: 'POST',
            body: JSON.stringify(shiftData)
        });
    },

    async updateShift(id, shiftData) {
        return this.request(`/api/shifts/${id}`, {
            method: 'PUT',
            body: JSON.stringify(shiftData)
        });
    },

    async deleteShift(id) {
        return this.request(`/api/shifts/${id}`, {
            method: 'DELETE'
        });
    },

    async deleteAllShiftsForOperator(operatorId, startDate, endDate) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        const query = params.toString();
        return this.request(`/api/shifts/operator/${operatorId}${query ? '?' + query : ''}`, {
            method: 'DELETE'
        });
    },

    async confirmShift(id) {
        return this.request(`/api/shifts/${id}/confirm`, {
            method: 'POST'
        });
    },

    async completeShift(id, actualHours, comment) {
        return this.request(`/api/shifts/${id}/complete`, {
            method: 'POST',
            body: JSON.stringify({ actual_hours: actualHours, comment: comment || null })
        });
    },

    async createBulkShifts(shifts) {
        return this.request('/api/shifts/bulk', {
            method: 'POST',
            body: JSON.stringify({ shifts })
        });
    },

    async getShiftsReport(startDate, endDate) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        const query = params.toString();
        return this.request(`/api/shifts/report${query ? '?' + query : ''}`);
    },

    // SMD: Проекты
    async getSMDProjects(activeOnly = false) {
        const params = activeOnly ? '?active_only=true' : '';
        return this.request(`/api/smd/projects${params}`);
    },

    // SMD: Линии производства
    async getSMDLines(activeOnly = false) {
        const params = activeOnly ? '?active_only=true' : '';
        return this.request(`/api/smd/lines${params}`);
    },

    async getSMDLine(lineId) {
        return this.request(`/api/smd/lines/${lineId}`);
    },

    // SMD: Установщики
    async getSMDMountingOperators(lineId = null, activeOnly = false) {
        const params = new URLSearchParams();
        if (lineId) params.append('line_id', lineId);
        if (activeOnly) params.append('active_only', 'true');
        const query = params.toString();
        return this.request(`/api/smd/mounting-operators${query ? '?' + query : ''}`);
    },

    // SMD: Распределение
    async getSMDAvailableLines(projectId) {
        const params = new URLSearchParams();
        if (projectId) params.append('project_id', projectId);
        const query = params.toString();
        return this.request(`/api/smd/distribution/available${query ? '?' + query : ''}`);
    },

    async autoDistributeOrder(orderId, projectId) {
        return this.request('/api/smd/distribution/auto', {
            method: 'POST',
            body: JSON.stringify({ order_id: orderId, project_id: projectId })
        });
    },

    // Ежедневный прогресс производства
    async addDailyProgress(progressData) {
        return this.request('/api/production/daily-progress', {
            method: 'POST',
            body: JSON.stringify(progressData)
        });
    },

    async getDailyProgress(batchId, startDate = null, endDate = null) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        const query = params.toString();
        return this.request(`/api/production/daily-progress/${batchId}${query ? '?' + query : ''}`);
    },

    async getDailyProgressReport(startDate = null, endDate = null, lineId = null, orderId = null) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        if (lineId) params.append('line_id', lineId);
        if (orderId) params.append('order_id', orderId);
        const query = params.toString();
        return this.request(`/api/production/daily-progress-report${query ? '?' + query : ''}`);
    },

    async deleteDailyProgress(id) {
        return this.request(`/api/production/daily-progress/${id}`, {
            method: 'DELETE'
        });
    },

    // График смен
    async getShiftSchedules() {
        return this.request('/api/shift-schedules');
    },

    async createShiftSchedule(data) {
        return this.request('/api/shift-schedules', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateShiftSchedule(id, data) {
        return this.request(`/api/shift-schedules/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    async deleteShiftSchedule(id) {
        return this.request(`/api/shift-schedules/${id}`, {
            method: 'DELETE'
        });
    },
    
    async deleteShiftScheduleHours(scheduleId, workDate) {
        return this.request(`/api/shift-schedules/${scheduleId}/hours/${workDate}`, {
            method: 'DELETE'
        });
    },

    async saveShiftScheduleHours(scheduleId, workDate, hours, comment, status = 'work') {
        return this.request(`/api/shift-schedules/${scheduleId}/hours`, {
            method: 'POST',
            body: JSON.stringify({
                work_date: workDate,
                hours: hours,
                comment: comment || null,
                status: status
            })
        });
    },

    async getShiftScheduleHours(startDate, endDate) {
        return this.request(`/api/shift-schedules/hours?start_date=${startDate}&end_date=${endDate}`);
    },

    async exportShiftScheduleReport(startDate, endDate, format = 'json') {
        const url = `${API_BASE_URL}/api/shift-schedules/export/report?start_date=${startDate}&end_date=${endDate}&format=${format}`;
        console.log('📤 Export request:', url);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken || localStorage.getItem('crm_token')}`
            }
        });
        
        // Проверяем Content-Type перед парсингом
        const contentType = response.headers.get('content-type');
        const isJson = contentType && contentType.includes('application/json');
        
        if (!response.ok) {
            let errorMessage = 'Ошибка экспорта отчета';
            if (isJson) {
                try {
                    const error = await response.json();
                    errorMessage = error.error || errorMessage;
                } catch (e) {
                    console.error('Ошибка парсинга JSON ошибки:', e);
                }
            } else {
                // Если ответ не JSON (например, HTML страница ошибки)
                const text = await response.text();
                console.error('Сервер вернул не-JSON ответ:', text.substring(0, 200));
                errorMessage = `Ошибка ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        
        if (format === 'pdf') {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `shift_report_${startDate}_${endDate}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } else {
            // Для JSON формата проверяем Content-Type
            if (!isJson) {
                const text = await response.text();
                console.error('❌ Сервер вернул не-JSON ответ:', text.substring(0, 500));
                console.error('Content-Type:', contentType);
                console.error('Status:', response.status, response.statusText);
                console.error('URL:', url);
                
                // Если это HTML страница ошибки, пытаемся извлечь информацию
                if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                    // Проверяем, не 404 ли это
                    if (text.includes('Cannot GET') || text.includes('Cannot POST') || text.includes('404')) {
                        throw new Error('Маршрут не найден. Проверьте URL API.');
                    }
                    throw new Error('Сервер вернул HTML страницу вместо JSON. Проверьте настройки сервера.');
                }
                throw new Error('Сервер вернул неверный формат ответа');
            }
            try {
                const data = await response.json();
                console.log('✅ Получен отчет:', {
                    employeesCount: data.employees?.length || 0,
                    period: data.period,
                    hasEmployees: !!data.employees
                });
                return data;
            } catch (parseError) {
                console.error('Ошибка парсинга JSON:', parseError);
                const text = await response.text();
                console.error('Текст ответа:', text.substring(0, 500));
                throw new Error('Ошибка парсинга ответа сервера: ' + parseError.message);
            }
        }
    },

    // === Общие задачи ===
    async getTasks() {
        return this.request('/api/tasks');
    },
    async createTask(title, description, priority, assigned_operator_id) {
        return this.request('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({ title, description, priority, assigned_operator_id })
        });
    },
    async completeTask(id) {
        return this.request(`/api/tasks/${id}/complete`, { method: 'PUT' });
    },
    async reopenTask(id) {
        return this.request(`/api/tasks/${id}/reopen`, { method: 'PUT' });
    },
    async deleteTask(id) {
        return this.request(`/api/tasks/${id}`, { method: 'DELETE' });
    },

    // === Общий чеклист начала смены ===
    async getShiftChecklistItems() {
        return this.request('/api/shift-checklist');
    },
    async createShiftChecklistItem(text) {
        return this.request('/api/shift-checklist', {
            method: 'POST',
            body: JSON.stringify({ text })
        });
    },
    async deleteShiftChecklistItem(id) {
        return this.request(`/api/shift-checklist/${id}`, { method: 'DELETE' });
    },
    async applySmdStartChecklistPreset() {
        return this.request('/api/shift-checklist/presets/smd-start', {
            method: 'POST'
        });
    },
    async getShiftStartDailyStatus() {
        return this.request('/api/shift-checklist/status');
    },
    async confirmShiftRegulation(operatorNumber) {
        return this.request('/api/shift-checklist/regulation-confirm', {
            method: 'POST',
            body: JSON.stringify({
                operator_number: operatorNumber
            })
        });
    },
    async completeShiftChecklist(comment, checklistItems = []) {
        return this.request('/api/shift-checklist/complete', {
            method: 'POST',
            body: JSON.stringify({
                comment: comment || null,
                checklist_items: Array.isArray(checklistItems) ? checklistItems : []
            })
        });
    },
    async getShiftChecklistHistory(params = {}) {
        const queryParams = new URLSearchParams();
        if (params.date_from) queryParams.append('date_from', params.date_from);
        if (params.date_to) queryParams.append('date_to', params.date_to);
        if (params.user_id) queryParams.append('user_id', params.user_id);
        const query = queryParams.toString();
        return this.request(`/api/shift-checklist/history${query ? '?' + query : ''}`);
    }
};
