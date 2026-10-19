#!/bin/sh
# Runs a command with TIKO_TEST_DATABASE_URL set: the given server, or a throwaway postgres:18.
set -eu
if [ -n "${TIKO_TEST_DATABASE_URL:-}" ]; then
    exec "$@"
fi
name="tiko-test-pg-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test -p 127.0.0.1::5432 \
    --tmpfs /var/lib/postgresql postgres:18 -c fsync=off >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1' EXIT INT TERM
port=$(docker port "$name" 5432/tcp | head -n 1 | sed 's/.*://')
# The image restarts the server once after its first setup; wait for the final one.
i=0
until docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres 2>/dev/null \
    && docker logs "$name" 2>&1 | grep -q 'PostgreSQL init process complete'; do
    i=$((i + 1))
    [ "$i" -lt 60 ] || { echo "postgres did not start" >&2; exit 1; }
    sleep 0.5
done
TIKO_TEST_DATABASE_URL="postgresql://postgres:test@127.0.0.1:$port/postgres" "$@"
