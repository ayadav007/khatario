-- Migration: 044_add_company_introduction.sql
-- Purpose: Add company introduction field to businesses table
-- This field is used by the AI sales agent to provide context about the company

-- Add company_introduction field to businesses table
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS company_introduction TEXT;

-- Add comment for documentation
COMMENT ON COLUMN businesses.company_introduction IS 'Company introduction/about us text used by AI chatbot to answer customer questions';
