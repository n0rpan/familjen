-- Migration: Encrypt Google Calendar Tokens
-- Uses pgcrypto to encrypt sensitive OAuth tokens at rest

-- Enable pgcrypto extension (Supabase has this pre-installed in extensions schema)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Create a function to get the encryption key from app settings
-- The key should be set via: INSERT INTO app_settings (key, value) VALUES ('encryption_key', 'your-32-char-key');
CREATE OR REPLACE FUNCTION get_encryption_key()
RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT value FROM app_settings WHERE key = 'encryption_key'),
    'default-key-change-in-production'  -- Fallback for development only
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Encrypt function using AES-256 (using extensions schema for pgcrypto)
CREATE OR REPLACE FUNCTION encrypt_token(plaintext TEXT)
RETURNS TEXT AS $$
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN
    RETURN NULL;
  END IF;
  RETURN encode(
    extensions.pgp_sym_encrypt(plaintext, get_encryption_key()),
    'base64'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Decrypt function (using extensions schema for pgcrypto)
CREATE OR REPLACE FUNCTION decrypt_token(ciphertext TEXT)
RETURNS TEXT AS $$
BEGIN
  IF ciphertext IS NULL OR ciphertext = '' THEN
    RETURN NULL;
  END IF;
  RETURN extensions.pgp_sym_decrypt(
    decode(ciphertext, 'base64'),
    get_encryption_key()
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Return NULL if decryption fails (wrong key, corrupted data, etc.)
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add encrypted columns to google_calendar_tokens
ALTER TABLE google_calendar_tokens
  ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT;

-- Migrate existing plaintext tokens to encrypted (if any exist)
UPDATE google_calendar_tokens
SET
  access_token_encrypted = encrypt_token(access_token),
  refresh_token_encrypted = encrypt_token(refresh_token)
WHERE access_token_encrypted IS NULL
  AND access_token IS NOT NULL;

-- Create a view that automatically decrypts tokens for reading
CREATE OR REPLACE VIEW google_calendar_tokens_decrypted AS
SELECT
  id,
  email,
  COALESCE(decrypt_token(access_token_encrypted), access_token) as access_token,
  COALESCE(decrypt_token(refresh_token_encrypted), refresh_token) as refresh_token,
  token_type,
  expiry_date,
  created_at,
  updated_at
FROM google_calendar_tokens;

-- Grant access to the view
GRANT SELECT ON google_calendar_tokens_decrypted TO authenticated;

-- Create a function to upsert tokens with automatic encryption
CREATE OR REPLACE FUNCTION upsert_calendar_token(
  p_email TEXT,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_token_type TEXT DEFAULT 'Bearer',
  p_expiry_date BIGINT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO google_calendar_tokens (
    email,
    access_token,
    refresh_token,
    access_token_encrypted,
    refresh_token_encrypted,
    token_type,
    expiry_date,
    updated_at
  )
  VALUES (
    p_email,
    '',  -- Clear plaintext
    '',  -- Clear plaintext
    encrypt_token(p_access_token),
    encrypt_token(p_refresh_token),
    p_token_type,
    p_expiry_date,
    NOW()
  )
  ON CONFLICT (email) DO UPDATE SET
    access_token = '',
    refresh_token = '',
    access_token_encrypted = encrypt_token(p_access_token),
    refresh_token_encrypted = encrypt_token(p_refresh_token),
    token_type = p_token_type,
    expiry_date = p_expiry_date,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: After verifying encryption works, run this to clear plaintext tokens:
-- UPDATE google_calendar_tokens SET access_token = '', refresh_token = ''
-- WHERE access_token_encrypted IS NOT NULL;
