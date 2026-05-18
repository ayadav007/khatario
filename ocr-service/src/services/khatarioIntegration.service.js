export const khatarioIntegrationService = {
  getReadiness({ validationResult }) {
    return {
      provider: 'khatario',
      configured: true,
      ready: validationResult.status === 'valid',
      status: validationResult.status === 'valid' ? 'ready_for_sync' : validationResult.status
    };
  }
};
