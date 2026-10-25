/**
 * Latency experiment knobs for Gemini invoice vision.
 * Isolated from the accuracy mapper so this folder can be reverted independently.
 */

/** Long-side cap after crop / on the server. Never used to upscale. */
export const INVOICE_VISION_MAX_LONG_SIDE = 1600;

/**
 * Till rolls are long and narrow: at 1600px long side a receipt is ~450px wide and its
 * characters are a few pixels each. Tall (or wide) images keep at least this short side…
 */
export const INVOICE_VISION_MIN_SHORT_SIDE = 800;

/** …up to this long side. Normal A4 / phone-shaped bills still stop at 1600. */
export const INVOICE_VISION_TALL_MAX_LONG_SIDE = 3200;

/** Browser canvas JPEG quality (0–1). */
export const INVOICE_VISION_JPEG_QUALITY = 0.8;

/** Sharp JPEG quality (1–100) when the server must re-encode a too-large image. */
export const INVOICE_VISION_SERVER_JPEG_QUALITY = 80;

/**
 * Dense supermarket bills can be 80–100 lines of required JSON keys.
 * 32768 is ≥2× that budget and stays under Flash-Lite's 65536 cap.
 * This is a maximum, not a target — typical invoices stop far earlier.
 */
export const GEMINI_INVOICE_MAX_OUTPUT_TOKENS = 32_768;

/**
 * Gemini 2.5 Flash-Lite: thinking is off by default; 2.5 Flash uses a large
 * dynamic budget unless set to 0. Explicit 0 avoids extra reasoning latency.
 */
export const GEMINI_INVOICE_THINKING_BUDGET = 0;

/** Gemini 3+ replaces thinkingBudget with thinkingLevel and cannot switch thinking off. */
export const GEMINI_INVOICE_THINKING_LEVEL = 'low' as const;

/**
 * Explicit REST enum. HIGH keeps document-text tiling; the pixel cap is the
 * main image-token reduction. MEDIUM would cut tokens further at accuracy risk.
 */
export const GEMINI_INVOICE_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_HIGH' as const;
