FROM python:3.12-slim
WORKDIR /app
COPY products-microservice/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY products-microservice/. .
COPY shared/ /app/shared
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003"]
