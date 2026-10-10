FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu torch && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001

# Tắt access log mặc định vì URL truy vấn có thể chứa dữ liệu nhạy cảm.
CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
