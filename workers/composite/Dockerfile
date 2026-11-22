# Container for the pixel-locked compositor (rembg u2netp + Pillow). Not built or deployed in this repo's CI: needs a container host.
# Build:  docker build -t coldstart-composite workers/composite
# Run:    docker run -p 8080:8080 -e COMPOSITE_KEY=<random> coldstart-composite
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8080 REMBG_MODEL=isnet-general-use REMBG_SECOND_MODEL=u2netp U2NET_HOME=/models
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY service.py .
# Weights are fetched at build time and verified against the checksum pinned in service.py (the service refuses to start on a mismatch).
RUN python -c "import service"   # downloads u2netp.onnx into /models and verifies the pinned sha256
RUN chmod -R a+rX /models
USER 1000
EXPOSE 8080
CMD ["python", "service.py"]
