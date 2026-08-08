#!/usr/bin/env python3
"""
One-time migration: snapshot PRIMARY KEY (machine) -> (machine, app).

Servers created before v0.2.0 keyed snapshots on machine alone, so a machine
running watchers for two programs had them overwrite each other. SQLite cannot
ALTER a primary key, so the table is rebuilt. History is untouched.

    python3 install/migrate-snapshot-pk.py /path/to/state.db
"""
import sqlite3, sys

db = sys.argv[1] if len(sys.argv) > 1 else None
if not db:
    sys.exit("usage: migrate-snapshot-pk.py <state.db>")
c = sqlite3.connect(db)
cols = [r[1] for r in c.execute("PRAGMA table_info(snapshot)")]
if not cols:
    sys.exit("no snapshot table; nothing to do")
sql = c.execute("SELECT sql FROM sqlite_master WHERE name='snapshot'").fetchone()[0]
if "PRIMARY KEY (machine, app)" in sql:
    print("already migrated"); sys.exit(0)
rows = list(c.execute("SELECT machine,app,jobs,ts FROM snapshot"))
c.execute("DROP TABLE snapshot")
c.execute("""CREATE TABLE snapshot(machine TEXT, app TEXT, jobs TEXT, ts REAL,
             PRIMARY KEY (machine, app))""")
c.executemany("INSERT OR REPLACE INTO snapshot VALUES(?,?,?,?)", rows)
c.commit()
print(f"migrated {len(rows)} snapshot row(s) to (machine, app)")
