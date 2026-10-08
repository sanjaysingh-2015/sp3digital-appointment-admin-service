/** Errors the global handler in app.js turns into { error: { code, message } }. */
function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

module.exports = { httpError };
