/** Cloud API interactive-message caps. Safe for client and server. */

export const WA_LIMITS = {
  interactiveBody: 1024,
  interactiveFooter: 60,
  headerText: 60,
  buttonsMax: 3,
  buttonTitle: 20,
  listRowsMax: 10,
  listRowTitle: 24,
  listRowDescription: 72,
  listButton: 20,
  replyId: 256,
  caption: 1024,
  videoBytes: 16 * 1024 * 1024,
  imageBytes: 5 * 1024 * 1024,
} as const;
