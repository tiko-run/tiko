-- Who is on which stage of which board, so a person's workload never reads every board.
-- Rewritten for a board each time it is saved; filled here from the boards saved so far.
CREATE TABLE IF NOT EXISTS planning_stages (
    board_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    row_title TEXT NOT NULL,
    type TEXT NOT NULL,
    start TEXT NOT NULL,
    "end" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS planning_stages_person ON planning_stages (person_id);
CREATE INDEX IF NOT EXISTS planning_stages_board ON planning_stages (board_id);

-- A parent row keeps stages from before it had children; they are not drawn, so not counted.
INSERT INTO planning_stages (board_id, person_id, row_title, type, start, "end")
SELECT b.id, p.value,
       COALESCE(NULLIF(json_extract(r.value, '$.title'), ''), json_extract(r.value, '$.key'), ''),
       COALESCE(json_extract(s.value, '$.type'), ''),
       json_extract(s.value, '$.start'), json_extract(s.value, '$.end')
FROM boards b,
     json_each(b.doc, '$.nodes') n,
     json_each(n.value, '$.data.content.rows') r,
     json_each(r.value, '$.stages') s,
     json_each(s.value, '$.people') p
WHERE json_extract(n.value, '$.type') = 'module'
  AND json_extract(n.value, '$.data.kind') = 'gantt'
  AND NOT EXISTS (
      SELECT 1 FROM json_each(n.value, '$.data.content.rows') c
      WHERE json_extract(c.value, '$.parent') = json_extract(r.value, '$.id')
  );
