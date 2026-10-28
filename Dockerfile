FROM python:3.12.14-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY simulador/ simulador/
COPY config/ config/

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
ENTRYPOINT ["python", "-m", "simulador"]
CMD ["vivo"]
