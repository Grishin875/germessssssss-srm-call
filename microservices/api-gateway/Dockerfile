FROM python:3.12-slim
WORKDIR /app
COPY api-gateway/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api-gateway/. .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
