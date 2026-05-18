/**
 * Payment Screenshot OCR Service
 * Uses AI to verify if an image is a payment screenshot and extract payment details.
 * OCR is a fallback path — combine model output with explicit validation rules.
 */

import { getAIProvider } from './ai-provider-factory';

export interface PaymentOCRResult {
  isPaymentScreenshot: boolean;
  extractedAmount?: number;
  extractedUPIId?: string;
  extractedTransactionId?: string;
  extractedDate?: string;
  confidenceScore: number; // 0-100
  rawText?: string;
  reason?: string; // If verification fails, reason why
}

/** Minimum model confidence to auto-pass when all rules match */
export const OCR_MIN_AUTO_VERIFY_CONFIDENCE =
  Number.parseInt(process.env.WHATSAPP_OCR_MIN_AUTO_VERIFY_CONFIDENCE || '', 10) || 75;

/** Below this, treat as rejected unless review flags apply */
export const OCR_MIN_SCREENSHOT_CONFIDENCE =
  Number.parseInt(process.env.WHATSAPP_OCR_MIN_SCREENSHOT_CONFIDENCE || '', 10) || 40;

export type OcrProofStatus = 'verified' | 'rejected' | 'requires_review';

export type PaymentOcrRuleCheck = {
  is_payment_screenshot: boolean;
  amount_matches_expected: boolean;
  has_extracted_amount: boolean;
  model_confidence_meets_auto_verify: boolean;
  model_confidence_above_floor: boolean;
};

export type PaymentOcrValidationResult = {
  ocrStatus: OcrProofStatus;
  /** Combined score 0–100 (model + rule bonuses, capped) */
  effectiveConfidence: number;
  ruleChecks: PaymentOcrRuleCheck;
  summary: string;
};

function amountMatches(expected: number | undefined, extracted: number | undefined): boolean {
  if (expected == null || extracted == null || !Number.isFinite(expected) || !Number.isFinite(extracted)) {
    return false;
  }
  return Math.abs(expected - extracted) < 1;
}

/**
 * Apply validation rules on top of vision/OCR model output.
 * Default order outcome is conservative: ambiguous → requires_review.
 */
export function evaluatePaymentOcrWithRules(
  ocr: PaymentOCRResult,
  options: { expectedAmount?: number }
): PaymentOcrValidationResult {
  const expected = options.expectedAmount;
  const extracted = ocr.extractedAmount;
  const modelConf = Math.min(100, Math.max(0, ocr.confidenceScore || 0));

  const hasExtractedAmount = extracted != null && Number.isFinite(extracted);
  const amountOk = amountMatches(expected, extracted);
  const screenshotSaysYes = ocr.isPaymentScreenshot === true;
  const meetsAuto = modelConf >= OCR_MIN_AUTO_VERIFY_CONFIDENCE;
  const aboveFloor = modelConf >= OCR_MIN_SCREENSHOT_CONFIDENCE;

  let bonus = 0;
  if (screenshotSaysYes) bonus += 5;
  if (hasExtractedAmount) bonus += 5;
  if (expected != null && amountOk) bonus += 10;

  const effectiveConfidence = Math.min(100, Math.round(modelConf + bonus));

  const ruleChecks: PaymentOcrRuleCheck = {
    is_payment_screenshot: screenshotSaysYes,
    amount_matches_expected: expected != null ? amountOk : hasExtractedAmount,
    has_extracted_amount: hasExtractedAmount,
    model_confidence_meets_auto_verify: meetsAuto,
    model_confidence_above_floor: aboveFloor
  };

  // Not a payment screenshot and model is weak → reject
  if (!screenshotSaysYes && modelConf < OCR_MIN_SCREENSHOT_CONFIDENCE) {
    return {
      ocrStatus: 'rejected',
      effectiveConfidence,
      ruleChecks,
      summary: ocr.reason || 'Image does not appear to be a payment screenshot.'
    };
  }

  // Screenshot OK + amount matches + strong confidence → verified
  if (screenshotSaysYes && expected != null && amountOk && meetsAuto) {
    return {
      ocrStatus: 'verified',
      effectiveConfidence,
      ruleChecks,
      summary: 'OCR: payment screenshot detected, amount matches order total.'
    };
  }

  // Screenshot OK + amount matches + medium confidence → human review
  if (screenshotSaysYes && expected != null && amountOk && aboveFloor && !meetsAuto) {
    return {
      ocrStatus: 'requires_review',
      effectiveConfidence,
      ruleChecks,
      summary: 'OCR: amount matches but confidence is below auto-verify threshold.'
    };
  }

  // Amount mismatch or missing amount when we expected one
  if (screenshotSaysYes && expected != null && !amountOk) {
    return {
      ocrStatus: 'requires_review',
      effectiveConfidence,
      ruleChecks,
      summary: hasExtractedAmount
        ? `OCR: amount ₹${extracted} does not match order total ₹${expected}.`
        : 'OCR: could not read an amount from the screenshot.'
    };
  }

  // Looks like payment activity but unclear
  if (screenshotSaysYes || aboveFloor) {
    return {
      ocrStatus: 'requires_review',
      effectiveConfidence,
      ruleChecks,
      summary: ocr.reason || 'OCR: please verify payment proof manually.'
    };
  }

  return {
    ocrStatus: 'rejected',
    effectiveConfidence,
    ruleChecks,
    summary: ocr.reason || 'OCR: could not validate payment proof.'
  };
}

/**
 * Verify payment screenshot using AI vision/OCR
 */
export async function verifyPaymentScreenshot(
  businessId: string,
  imageUrl: string,
  expectedAmount?: number,
  expectedUPIId?: string
): Promise<PaymentOCRResult> {
  try {
    const provider = await getAIProvider(businessId);
    if (!provider) {
      return {
        isPaymentScreenshot: false,
        confidenceScore: 0,
        reason: 'AI provider not configured'
      };
    }

    // AI vision analysis prompt
    const prompt = `Analyze this payment screenshot image and extract the following information:
1. Is this a valid payment/transaction screenshot? (yes/no)
2. Payment amount (extract the number, ignore currency symbols)
3. UPI ID or payment receiver ID (if visible)
4. Transaction ID or reference number (if visible)
5. Transaction date (if visible)
6. Overall confidence (0-100) that this is a real payment screenshot

Expected Amount: ${expectedAmount || 'Not specified'}
Expected UPI ID: ${expectedUPIId || 'Not specified'}

Return your response as JSON in this EXACT format:
{
  "isPaymentScreenshot": true,
  "extractedAmount": 1500.00,
  "extractedUPIId": "username@paytm",
  "extractedTransactionId": "TXN123456",
  "extractedDate": "2024-01-15",
  "confidenceScore": 85,
  "rawText": "All visible text from the image",
  "reason": "Why it is or isn't a payment screenshot"
}`;

    const response = await provider.analyzeImage(imageUrl, prompt);
    
    // Parse AI response
    try {
      // Find JSON block in response if it's not pure JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const result = JSON.parse(jsonStr);
      
      return {
        isPaymentScreenshot: result.isPaymentScreenshot === true || result.isPaymentScreenshot === 'true',
        extractedAmount: result.extractedAmount ? parseFloat(result.extractedAmount.toString()) : undefined,
        extractedUPIId: result.extractedUPIId,
        extractedTransactionId: result.extractedTransactionId,
        extractedDate: result.extractedDate,
        confidenceScore: result.confidenceScore || 0,
        rawText: result.rawText,
        reason: result.reason
      };
    } catch (parseError) {
      console.error('[Payment OCR] Failed to parse AI response:', response);
      return parseTextResponse(response, expectedAmount, expectedUPIId);
    }

  } catch (error) {
    console.error('[Payment OCR] Error verifying screenshot:', error);
    return {
      isPaymentScreenshot: false,
      confidenceScore: 0,
      reason: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Parse text response if AI didn't return valid JSON
 */
function parseTextResponse(
  text: string,
  expectedAmount?: number,
  expectedUPIId?: string
): PaymentOCRResult {
  const lowerText = text.toLowerCase();
  
  // Check for payment-related keywords
  const paymentKeywords = ['payment', 'paid', 'successful', 'transaction', 'upi', 'sent', 'received', 'transfer'];
  const hasPaymentKeywords = paymentKeywords.some(keyword => lowerText.includes(keyword));
  
  // Try to extract amount
  const amountMatch = text.match(/[₹Rs\$]?\s*(\d+(?:[,.]\d{2})?)/i);
  let extractedAmount = undefined;
  if (amountMatch) {
    extractedAmount = parseFloat(amountMatch[1].replace(',', ''));
  }
  
  // Try to extract UPI ID
  const upiMatch = text.match(/([a-zA-Z0-9.\-_]+@[a-zA-Z]{2,64})/);
  const extractedUPIId = upiMatch ? upiMatch[1] : undefined;
  
  // Calculate confidence based on matches
  let confidence = 30; // Base confidence for text-only analysis
  if (hasPaymentKeywords) confidence += 20;
  if (extractedAmount) confidence += 15;
  if (extractedUPIId) confidence += 15;
  if (expectedAmount && extractedAmount && Math.abs(expectedAmount - extractedAmount) < 1) {
    confidence += 20; // Amount matches expected
  }
  
  return {
    isPaymentScreenshot: hasPaymentKeywords,
    extractedAmount,
    extractedUPIId,
    confidenceScore: Math.min(confidence, 100),
    rawText: text,
    reason: 'Parsed from text response (JSON parsing failed)'
  };
}
