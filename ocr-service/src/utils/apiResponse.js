export const sendSuccess = (res, {
  statusCode = 200,
  message = 'OK',
  data = null,
  meta = undefined
} = {}) => {
  res.status(statusCode).json({
    success: true,
    message,
    data,
    meta
  });
};
