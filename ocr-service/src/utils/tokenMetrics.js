const approxTokensFromChars = (text) => Math.ceil((text || '').length / 4);

export const estimateTokenMetrics = ({ rawOcr = '', cleanedOcr = '', compactedOcr = '', prompt = '' } = {}) => {
  const rawOcrTokens = approxTokensFromChars(rawOcr);
  const cleanedOcrTokens = approxTokensFromChars(cleanedOcr);
  const compactedOcrTokens = approxTokensFromChars(compactedOcr);
  const promptTokens = approxTokensFromChars(prompt);

  const reduction = rawOcrTokens > 0
    ? Number((((rawOcrTokens - compactedOcrTokens) / rawOcrTokens) * 100).toFixed(1))
    : 0;

  return {
    method: 'approx_chars_div_4',
    rawOcrTokens,
    cleanedOcrTokens,
    compactedOcrTokens,
    promptTokens,
    reductionPercent: reduction
  };
};
