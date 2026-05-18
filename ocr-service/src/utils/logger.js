const formatPayload = (level, payload) => {
  if (typeof payload === 'string') {
    return JSON.stringify({
      level,
      message: payload,
      timestamp: new Date().toISOString()
    });
  }

  return JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    ...payload
  });
};

export const logger = {
  info(payload) {
    console.info(formatPayload('info', payload));
  },
  warn(payload) {
    console.warn(formatPayload('warn', payload));
  },
  error(payload) {
    console.error(formatPayload('error', payload));
  }
};

export const requestLoggerStream = {
  write(message) {
    logger.info({ message: message.trim(), type: 'http_request' });
  }
};
