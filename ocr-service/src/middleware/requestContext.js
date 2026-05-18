import crypto from 'crypto';

export const requestContext = (req, res, next) => {
  const requestId = req.get('x-request-id') || crypto.randomUUID();
  req.id = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};
