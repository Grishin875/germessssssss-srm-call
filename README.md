# CRM Germess — Микросервисный бэкенд (Python / FastAPI)

## Архитектура

```
                        ┌─────────────┐
                        │ api-gateway │  :8000
                        │  (proxy +   │
                        │rate limiting)│
                        └──────┬──────┘
           ┌───────────────────┼───────────────────────┐
           │                   │                       │
    ┌──────▼──────┐   ┌────────▼───────┐   ┌──────────▼──────┐
    │    auth     │   │   warehouse    │   │ business-logic  │
    │   :8001     │   │    :8005       │   │    :8008        │
    └─────────────┘   └────────────────┘   └─────────────────┘
           │                   │                       │
    ┌──────▼──────┐   ┌────────▼───────┐   ┌──────────▼──────┐
    │    otk      │   │   products     │   │     admin       │
    │   :8002     │   │    :8003       │   │    :8004        │
    └─────────────┘   └────────────────┘   └─────────────────┘
           │                   │                       │
    ┌──────▼──────┐   ┌────────▼───────┐   ┌──────────▼──────┐
    │  shipment   │   │   documents    │   │  integration    │
    │   :8006     │   │    :8007       │   │  (1С/Bitrix)    │
    └─────────────┘   └────────────────┘   │    :8009        │
                                           └─────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   PostgreSQL :5432  │
                    │   Redis      :6379  │
                    └────────────────────┘
```

## Сервисы

| Сервис | Порт | Описание |
|--------|------|----------|
| api-gateway | 8000 | Proxy, rate limiting, CORS |
| auth | 8001 | JWT, пользователи, RBAC |
| otk | 8002 | Контроль качества, регламенты |
| products | 8003 | Рецептура, готовая продукция |
| admin | 8004 | Операторы, задачи, смены |
| warehouse | 8005 | Склад, production_stock |
| shipment | 8006 | Отгрузка |
| documents | 8007 | Прошивки, SMD |
| business-logic | 8008 | Заказы, партии, статусные машины |
| integration | 8009 | 1С / Битрикс24 |

## Быстрый старт

```bash
# 1. Скопировать и заполнить .env
cp .env.example .env
# Сгенерировать JWT_SECRET:
python -c "import secrets; print(secrets.token_hex(64))"

# 2. Запустить всё
docker-compose up --build

# 3. Проверить
curl http://localhost:8000/api/ping
curl http://localhost:8000/api/health
```

## API через Gateway (порт 8000)

Все запросы идут через `http://localhost:8000/api/...`

### Авторизация
```bash
# Логин
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

# Использование токена
curl http://localhost:8000/api/warehouse/components \
  -H "Authorization: Bearer <token>"
```

### Основные эндпоинты

| Метод | URL | Описание |
|-------|-----|----------|
| POST | /api/auth/login | Вход |
| GET | /api/auth/me | Текущий пользователь |
| GET | /api/warehouse/components | Список компонентов |
| POST | /api/warehouse/batch | Оприходование/списание |
| GET | /api/orders | Список заказов |
| POST | /api/orders | Создать заказ |
| POST | /api/orders/{id}/start | Перевести в работу |
| GET | /api/production/batches | Партии производства |
| POST | /api/production/start-batch/{id} | Запустить партию |
| POST | /api/production/complete | Завершить партию |
| GET | /api/otk/batches | Партии ОТК |
| POST | /api/otk/check | Проверить партию |
| GET | /api/recipes | Рецептура |
| GET | /api/operators | Операторы |
| GET | /api/tasks | Задачи |
| GET | /api/shifts | График смен |
| GET | /api/firmware | Прошивки |
| POST | /api/integration/onec/orders | Webhook из 1С |
| POST | /api/integration/bitrix/deals | Webhook из Битрикс24 |

## Тесты

```bash
# Auth
cd microservices/auth-microservice
pip install -r tests/requirements-test.txt
pytest tests/

# Warehouse
cd microservices/warehouse-microservice
pytest tests/
```

## Переменные окружения

| Переменная | Описание |
|-----------|----------|
| JWT_SECRET | Секрет для JWT (мин. 64 символа) |
| POSTGRES_PASSWORD | Пароль PostgreSQL |
| ONEC_WEBHOOK_SECRET | HMAC-секрет для webhook 1С |
| BITRIX_WEBHOOK_SECRET | HMAC-секрет для webhook Битрикс24 |
# germessssssss-srm-call
