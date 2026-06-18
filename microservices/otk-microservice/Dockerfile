FROM python:3.12-slim
WORKDIR /app
COPY otk-microservice/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY otk-microservice/. .
COPY shared/ /app/shared
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
