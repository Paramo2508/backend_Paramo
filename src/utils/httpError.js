// Error with an HTTP status that errorHandler can expose safely. `fields` maps each invalid
// input field to a message so the frontend can show it next to that field.
function httpError(status, message, fields) {
  const error = new Error(message);
  error.status = status;
  if (fields) error.fields = fields;
  return error;
}

module.exports = { httpError };
