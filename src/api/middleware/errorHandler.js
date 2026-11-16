function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const error = { message: status === 500 ? 'Internal server error' : err.message };
  if (status < 500 && err.fields) error.fields = err.fields;
  // How long to wait after a usage limit (the route assistant, ADR-033).
  if (status === 429 && Number.isFinite(err.retryAfterSeconds)) {
    res.set('Retry-After', String(err.retryAfterSeconds));
  }

  res.status(status).json({ error });
}

module.exports = { errorHandler };
