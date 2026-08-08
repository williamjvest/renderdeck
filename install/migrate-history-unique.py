#!/usr/bin/env python3
"""
One-time migration: history UNIQUE (machine, job_id, state) -> (+ app).

Pre-v0.3 servers omitted `app` from the uniqueness constraint, so After Effects
and DaVinci Resolve on the same machine emitting the same job_id collided and
the second app's row was silently dropped by INSERT OR IGNORE. SQLite cannot
ALTER a constraint, so the table is rebuilt.

    python3 install/migrate-history-unique.py /path/to/state.db
"""
import sqlite3
import sys

db = sys.argv[1] if len(sys.argv) > 1 else None
if not db:
    sys.exit("usage: migrate-history-unique.py <state.db>")

c = sqlite3.connect(db)
row = c.execute("SELECT sql FROM sqlite_master WHERE name='history'").fetchone()
if not row:
    sys.exit("no history table; nothing to do")
if "UNIQUE(machine, app, job_id, state)" in row[0]:
    print("already migrated")
    sys.exit(0)

rows = list(c.execute("SELECT machine,app,job_id,name,state,elapsed_s,output,error,ts"
                      " FROM history ORDER BY ts"))
c.execute("ALTER TABLE history RENAME TO history_old")
c.execute("""CREATE TABLE history(
    id INTEGER PRIMARY KEY AUTOINCREMENT, machine TEXT, app TEXT,
    job_id TEXT, name TEXT, state TEXT, elapsed_s REAL, output TEXT,
    error TEXT, ts REAL, UNIQUE(machine, app, job_id, state))""")
c.executemany("INSERT OR IGNORE INTO history"
              "(machine,app,job_id,name,state,elapsed_s,output,error,ts)"
              " VALUES(?,?,?,?,?,?,?,?,?)", rows)
kept = c.execute("SELECT COUNT(*) FROM history").fetchone()[0]
c.execute("DROP TABLE history_old")
c.commit()
print(f"migrated {len(rows)} row(s) -> {kept} retained under the wider constraint")
