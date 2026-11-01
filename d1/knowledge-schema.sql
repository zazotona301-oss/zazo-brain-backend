CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,
  language TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_path, source_revision, chunk_index)
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx ON knowledge_chunks(source_path);
CREATE TABLE IF NOT EXISTS knowledge_sync_files (
  source_path TEXT PRIMARY KEY,
  source_revision TEXT NOT NULL,
  indexed_chunks INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  title,
  content,
  source_path UNINDEXED,
  chunk_id UNINDEXED,
  tokenize='unicode61 remove_diacritics 2'
);
