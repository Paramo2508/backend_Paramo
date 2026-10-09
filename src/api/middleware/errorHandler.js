function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const error = { message: status === 500 ? 'Internal server error' : err.message };
  if (status < 500 && err.fields) error.fields = err.fields;

  res.status(status).json({ error });
}

module.exports = { errorHandler };
