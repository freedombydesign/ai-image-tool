-- ============================================================================
-- AI IMAGE TOOL - SUPABASE SCHEMA
-- ============================================================================
-- Run this in SQL Editor in your Supabase project

-- 1. User Avatars (stores avatar image and AI-generated description)
CREATE TABLE IF NOT EXISTS ai_tool_avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- browser fingerprint or session ID
  image_url TEXT, -- Supabase Storage URL
  description TEXT, -- AI-generated appearance description
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_tool_avatars_user ON ai_tool_avatars(user_id);

-- 2. Thumbnail History (stores generated thumbnails)
CREATE TABLE IF NOT EXISTS ai_tool_thumbnails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  image_url TEXT NOT NULL, -- Supabase Storage URL or base64
  prompt TEXT,
  style TEXT,
  model TEXT,
  reference_used BOOLEAN DEFAULT false,
  avatar_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_tool_thumbnails_user ON ai_tool_thumbnails(user_id);
CREATE INDEX idx_ai_tool_thumbnails_created ON ai_tool_thumbnails(created_at DESC);

-- 3. Banner History (stores generated YouTube banners)
CREATE TABLE IF NOT EXISTS ai_tool_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  prompt TEXT,
  style TEXT,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_tool_banners_user ON ai_tool_banners(user_id);

-- 4. Batch Scene History (stores batch-generated scenes)
CREATE TABLE IF NOT EXISTS ai_tool_batch_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  batch_id TEXT NOT NULL, -- groups scenes from same batch
  scene_index INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  prompt TEXT,
  style TEXT,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_tool_batch_scenes_user ON ai_tool_batch_scenes(user_id);
CREATE INDEX idx_ai_tool_batch_scenes_batch ON ai_tool_batch_scenes(batch_id);

-- 5. User Settings/Preferences
CREATE TABLE IF NOT EXISTS ai_tool_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  default_model TEXT DEFAULT 'dall-e-3',
  default_style TEXT,
  theme TEXT DEFAULT 'dark',
  settings_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_tool_settings_user ON ai_tool_settings(user_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE ai_tool_avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_thumbnails ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_batch_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_tool_settings ENABLE ROW LEVEL SECURITY;

-- Allow anon access (since we're not using auth, just user_id tracking)
CREATE POLICY "Allow all for anon" ON ai_tool_avatars FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON ai_tool_thumbnails FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON ai_tool_banners FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON ai_tool_batch_scenes FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON ai_tool_settings FOR ALL USING (true);

-- ============================================================================
-- STORAGE BUCKET (run separately in Storage section)
-- ============================================================================
-- Create a bucket called 'ai-tool-images' with public access
-- Settings: Public bucket = ON, File size limit = 10MB

-- ============================================================================
-- DONE! Add to your .env:
-- SUPABASE_URL=https://your-project.supabase.co
-- SUPABASE_ANON_KEY=your-anon-key
-- ============================================================================
