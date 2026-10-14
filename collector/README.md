# Usage stats collector

The Cloudflare Worker behind `https://t.tiko.run/v1/events`. It accepts the install event and the daily ping described in [Usage stats](https://docs.tiko.run/privacy/), keeps only the documented fields, adds the time and the country, and writes one row into Postgres. The address of a request is never stored. Rows older than 13 months become monthly totals.

- `worker.js`: the Worker, no dependencies
- `schema.sql`: tables and the Worker's database role
- `node --test`: checks what is kept and what is refused

Deploy: run `schema.sql` on the database, then `wrangler secret put DATABASE_URL` with the `collector` role's connection string and `wrangler deploy`.
