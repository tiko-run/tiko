FROM python:3.12-slim
WORKDIR /updater
COPY updater.py ./
# Runs as root: the Docker socket belongs to root on the host.
CMD ["python", "-u", "updater.py"]
