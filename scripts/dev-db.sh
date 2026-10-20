#!/bin/sh
# A Postgres for `make dev-api` on 127.0.0.1:5433; its data stays in the volume tiko-dev-db.
set -eu
name=tiko-dev-db
if ! docker start "$name" >/dev/null 2>&1; then
    docker run -d --name "$name" -e POSTGRES_PASSWORD=dev -p 127.0.0.1:5433:5432 \
        -v tiko-dev-db:/var/lib/postgresql postgres:18 >/dev/null
fi
i=0
# Over TCP, which opens only after the first-start setup is done.
until docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || { echo "postgres did not start" >&2; exit 1; }
    sleep 0.5
done
