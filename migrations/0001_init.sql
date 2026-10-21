-- Zazo Brain schema for Neon/Postgres: review and run manually. The Worker never runs SQL.
-- Worlds are the top-level knowledge partitions; no independent regions table is created.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS worlds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, slug)
);

CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid REFERENCES worlds(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  instruction text NOT NULL,
  context text NOT NULL DEFAULT '',
  response text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (world_id IS NOT NULL OR room_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid REFERENCES worlds(id) ON DELETE SET NULL,
  room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
  title text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rooms_world_idx ON rooms(world_id);
CREATE INDEX IF NOT EXISTS memories_world_created_idx ON memories(world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memories_room_created_idx ON memories(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memories_content_fts_idx ON memories USING gin (to_tsvector('simple', instruction || ' ' || context || ' ' || response));
CREATE INDEX IF NOT EXISTS conversations_world_idx ON conversations(world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at ASC);
-- Create this only after embedding data is populated enough for a useful ANN index.
-- CREATE INDEX memories_embedding_hnsw_idx ON memories USING hnsw (embedding vector_cosine_ops);

INSERT INTO worlds (name, slug, description) VALUES
  ('التقنية والبرمجيات', 'World_Technology_Software', 'المعرفة حول التقنية والبرمجيات والمنتجات الرقمية.'),
  ('السياسة والجغرافيا السياسية', 'World_Politics_Geopolitics', 'الأحداث السياسية والعلاقات الدولية والجغرافيا السياسية.'),
  ('الاقتصاد والمال', 'World_Economy_Finance', 'الاقتصاد والأسواق والتمويل وإدارة المال.'),
  ('الدين والفلسفة', 'World_Religion_Philosophy', 'الأديان والفلسفة والأسئلة الفكرية والقيم.'),
  ('العلم والطبيعة', 'World_Science_Nature', 'العلوم والبيئة والطبيعة والاكتشافات.'),
  ('التاريخ والثقافة', 'World_History_Culture', 'التاريخ والفنون والثقافة والهوية.'),
  ('الحياة الشخصية', 'World_Personal_Life', 'المعرفة المتعلقة بالحياة اليومية والعادات والنمو الشخصي.')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now();

INSERT INTO rooms (world_id, name, slug, description)
SELECT id, 'عام', 'general', 'الغرفة العامة لهذا العالم.'
FROM worlds
WHERE slug IN (
  'World_Technology_Software', 'World_Politics_Geopolitics', 'World_Economy_Finance',
  'World_Religion_Philosophy', 'World_Science_Nature', 'World_History_Culture', 'World_Personal_Life'
)
ON CONFLICT (world_id, slug) DO NOTHING;
