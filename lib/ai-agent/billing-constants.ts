/** Khatario AI add-on: the agent runs on Khatario's model key instead of the shop's own. */
export const KHATARIO_AI_PRICE_MONTHLY = Number(process.env.NEXT_PUBLIC_KHATARIO_AI_PRICE || 299);
export const KHATARIO_AI_MONTHLY_QUOTA = Number(process.env.NEXT_PUBLIC_KHATARIO_AI_MONTHLY_QUOTA || 3000);
/** Free replies on Khatario's key before buying, counted in Test mode and the test chat. */
export const KHATARIO_AI_TRIAL_REPLIES = Number(process.env.NEXT_PUBLIC_KHATARIO_AI_TRIAL_REPLIES || 100);
