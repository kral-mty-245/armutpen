"""SQLite lives in the Docker data volume, never in the public source tree."""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

DB_PATH = os.getenv('DB_PATH', '/data/armut.sqlite3')


def day():
    return datetime.now(ZoneInfo('Europe/Istanbul')).date().isoformat()


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def migrate():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE NOT NULL,
          password TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          credits INTEGER NOT NULL DEFAULT 20 CHECK(credits >= 0), credit_day TEXT NOT NULL,
          survey TEXT, settings TEXT NOT NULL DEFAULT '{"thinking":"medium","systemPrompt":""}'
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS identities (
          provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT, login TEXT, PRIMARY KEY(provider, subject), UNIQUE(provider, user_id)
        );
        CREATE TABLE IF NOT EXISTS oauth_states (
          state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, user_id TEXT,
          verifier TEXT NOT NULL, expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL, ai_named INTEGER NOT NULL DEFAULT 0, files TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0, repo TEXT, pending_action TEXT,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS versions (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL, files TEXT NOT NULL, label TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS ai_jobs (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, cost INTEGER NOT NULL,
          credit_day TEXT NOT NULL, started INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);
        ''')


DEFAULT_FILES = {
    'index.html': '<!DOCTYPE html>\n<html lang="tr">\n<head><meta charset="UTF-8"><title>Yeni proje</title></head>\n<body>\n  <h1>Hayal et. Birlikte üretelim.</h1>\n  <p>NOMI AI ile konuş veya kodlamaya başla.</p>\n</body>\n</html>',
    'src/style.css': 'body { background: #171b22; color: #d8e6b3; font-family: system-ui; text-align: center; padding: 48px 20px; }',
    'src/script.js': 'console.log("Projen hazır!");'
}


def serialize_project(row):
    result = dict(row)
    result['files'] = json.loads(result['files'])
    result.pop('user_id', None)
    return result


if __name__ == '__main__':
    migrate()
