-- External Documents & Source URLs
-- For fetching and processing documents/websites to extract events

-- Add default vision model setting
INSERT INTO app_settings (key, value) VALUES
  ('openrouter_vision_model', 'google/gemini-2.0-flash-001')
ON CONFLICT (key) DO NOTHING;

-- External source URLs (manual calendar sources added by users)
CREATE TABLE IF NOT EXISTS external_source_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  url TEXT NOT NULL,
  display_name TEXT NOT NULL,
  url_type TEXT NOT NULL CHECK (url_type IN ('calendar_page', 'pdf', 'ics')),

  auto_sync BOOLEAN DEFAULT true,
  sync_frequency_days INT DEFAULT 7,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,

  child_id UUID REFERENCES children(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  UNIQUE(household_id, url)
);

-- External documents (PDFs, attachments, fetched pages)
CREATE TABLE IF NOT EXISTS external_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES external_integrations(id) ON DELETE CASCADE,
  source_url_id UUID REFERENCES external_source_urls(id) ON DELETE CASCADE,

  external_id TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('mykid_attachment', 'iskole_letter', 'iskole_attachment', 'spond_attachment', 'kidplan_file', 'manual_url')),
  source_url TEXT,

  title TEXT,
  filename TEXT,
  mime_type TEXT NOT NULL,
  storage_path TEXT,
  file_size INT,

  extracted_text TEXT,
  ai_processed BOOLEAN DEFAULT false,
  ai_processed_at TIMESTAMPTZ,

  document_date DATE,
  expires_at TIMESTAMPTZ,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(integration_id, external_id)
);

-- Unique constraint for source_url_id (used by manual URL upserts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_external_documents_source_url
  ON external_documents(source_url_id) WHERE source_url_id IS NOT NULL;

-- Add source_document_id to external_suggestions
ALTER TABLE external_suggestions
ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES external_documents(id) ON DELETE SET NULL;

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'external-documents',
  'external-documents',
  false,
  10485760,  -- 10MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'text/html']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for external_source_urls
ALTER TABLE external_source_urls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own household source urls"
  ON external_source_urls FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert source urls for own household"
  ON external_source_urls FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update own household source urls"
  ON external_source_urls FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete own household source urls"
  ON external_source_urls FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- RLS policies for external_documents
ALTER TABLE external_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own household documents"
  ON external_documents FOR SELECT
  TO authenticated
  USING (household_id = get_user_household_id());

CREATE POLICY "Users can insert documents for own household"
  ON external_documents FOR INSERT
  TO authenticated
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can update own household documents"
  ON external_documents FOR UPDATE
  TO authenticated
  USING (household_id = get_user_household_id())
  WITH CHECK (household_id = get_user_household_id());

CREATE POLICY "Users can delete own household documents"
  ON external_documents FOR DELETE
  TO authenticated
  USING (household_id = get_user_household_id());

-- Storage policies for external-documents bucket
CREATE POLICY "Users can view own household docs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'external-documents' AND
    (storage.foldername(name))[1] = get_user_household_id()::text
  );

CREATE POLICY "Users can upload to own household docs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'external-documents' AND
    (storage.foldername(name))[1] = get_user_household_id()::text
  );

CREATE POLICY "Users can delete own household docs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'external-documents' AND
    (storage.foldername(name))[1] = get_user_household_id()::text
  );

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_external_documents_household ON external_documents(household_id);
CREATE INDEX IF NOT EXISTS idx_external_documents_ai_processed ON external_documents(ai_processed) WHERE NOT ai_processed;
CREATE INDEX IF NOT EXISTS idx_external_source_urls_household ON external_source_urls(household_id);
CREATE INDEX IF NOT EXISTS idx_external_source_urls_sync ON external_source_urls(last_sync_at) WHERE auto_sync;
