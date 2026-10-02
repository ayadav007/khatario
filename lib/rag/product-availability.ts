/**
 * What the assistant may offer. Khatario HR is built but not launched: the assistant says it is
 * coming soon, never quotes HR prices and never offers an HR trial. Flip this when HR launches,
 * then restore knowledge/prospect/modules/hr-payroll.md and run `npm run kb:generate` + reindex.
 */
export const HR_LAUNCHED = false;

export const HR_COMING_SOON =
  'Khatario HR (employees, attendance, payroll and leave) is coming soon. It is not available to sign up for yet; ' +
  'Khatario Billing and Khatario Connect are available today.';
