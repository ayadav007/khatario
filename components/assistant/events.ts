/** `window.dispatchEvent(new CustomEvent(ASSISTANT_ASK_EVENT, { detail: { question } }))` opens the in-app assistant and asks. */
export const ASSISTANT_ASK_EVENT = 'khatario-assistant:ask';

export function askAssistant(question: string): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_ASK_EVENT, { detail: { question } }));
}
