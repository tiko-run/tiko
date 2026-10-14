# Usage stats collector

The Cloudflare Worker behind `https://t.tiko.run/v1/events`. It accepts the install event and the daily ping described in [Usage stats](https://docs.tiko.run/privacy/), keeps only the documented fields, adds the time and the country, and writes one row into Postgres. The address of a request is never stored. Rows older than 13 months become monthly totals.

- `worker.js`: the Worker, no dependencies
- `schema.sql`: tables and the Worker's database role
- `node --test`: checks what is kept and what is refused

Deploy: run `schema.sql` on the database, give the `collector` role a password, then `wrangler secret put DATABASE_URL` with that role's connection string and `wrangler deploy`.

`wrangler.toml` routes the Worker to `t.tiko.run`, the tiko project's own collector. To run one for your fork or company, change `routes` to your domain and set `TIKO_STATS_URL` on your instances and when you run the installers.
