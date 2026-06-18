FROM python:3.12-slim
WORKDIR /app
COPY business-logic-microservice/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY business-logic-microservice/. .
COPY shared/ /app/shared
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8008"]
