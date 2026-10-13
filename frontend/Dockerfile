# Static files are the same on every platform: build them once natively, not under QEMU,
# where npm ci can hang for the arm64 image.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.31-alpine
# Hosts without compose DNS (Railway: api.railway.internal:8000) override the upstream.
# Workers by the CPUs the container may use: on a shared host nginx would start one per host core.
ENV API_UPSTREAM=api:8000 TIKO_WORKERS=1 NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 NGINX_ENTRYPOINT_WORKER_PROCESSES_AUTOTUNE=1
# An open board takes two connections, the browser's and the API's, so the stock 1024 ends at
# about 510 open boards per worker. The file limit goes with it: some hosts start at 1024.
RUN sed -i -e 's/worker_connections .*/worker_connections 16384;/' \
    -e '/^worker_processes/a worker_rlimit_nofile 32768;' /etc/nginx/nginx.conf \
    && grep -q 'worker_connections 16384;' /etc/nginx/nginx.conf \
    && grep -q '^worker_rlimit_nofile 32768;' /etc/nginx/nginx.conf && nginx -t
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 api-upstream.envsh /docker-entrypoint.d/16-api-upstream.envsh
COPY --chmod=755 api-workers.envsh /docker-entrypoint.d/17-api-workers.envsh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3000
