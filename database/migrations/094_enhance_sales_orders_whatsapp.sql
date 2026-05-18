-- Migration: Enhance sales_orders for WhatsApp payment and OCR tracking
-- Purpose: Track WhatsApp conversation and payment verification for sales orders

-- Enhance sales_orders table
ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS whatsapp_conversation_id UUID REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS payment_screenshot_url TEXT,
ADD COLUMN IF NOT EXISTS payment_screenshot_message_id UUID REFERENCES whatsapp_conversation_messages(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS ocr_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'verified', 'rejected', 'requires_review'
ADD COLUMN IF NOT EXISTS ocr_data JSONB DEFAULT '{}'::jsonb; -- {extracted_amount, confidence_score, raw_text, etc.}

-- Add index for WhatsApp conversation tracking
CREATE INDEX IF NOT EXISTS idx_sales_orders_whatsapp_conv ON sales_orders(whatsapp_conversation_id) WHERE whatsapp_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_orders_ocr_status ON sales_orders(ocr_status);

-- Comments
COMMENT ON COLUMN sales_orders.whatsapp_conversation_id IS 'Link to the WhatsApp conversation where this order was placed';
COMMENT ON COLUMN sales_orders.payment_screenshot_url IS 'URL to the payment screenshot provided by the customer';
COMMENT ON COLUMN sales_orders.ocr_status IS 'Status of AI/OCR verification of the payment screenshot';
COMMENT ON COLUMN sales_orders.ocr_data IS 'Data extracted from the payment screenshot via AI/OCR';
