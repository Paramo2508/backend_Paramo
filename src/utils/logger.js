const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function defaultLevel() {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

// Secrets that must never reach a log line, even inside an error message (ADR-033). They are read
// on every line so a key set after start-up (tests) is also hidden.
const SECRET_VARIABLES = [
  'LLM_API_KEY',
  'ORS_API_KEY',
  'OPENROUTESERVICE_API_KEY',
  'JWT_SECRET',
  'GOOGLE_CLIENT_SECRET'
];
const REDACTED = '[REDACTED]';

function redact(message) {
  let text = String(message);
  SECRET_VARIABLES.forEach((name) => {
    const secret = (process.env[name] || '').trim();
    // Short values (placeholders, empty) would hide ordinary words.
    if (secret.length >= 8) text = text.split(secret).join(REDACTED);
  });
  return text.replace(/(Bearer\s+)[\w.~+/-]+=*/gi, `$1${REDACTED}`);
}

function write(level, message) {
  const threshold = LEVELS[defaultLevel()] ?? LEVELS.info;
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(message)}\n`;
  (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(line);
}

const logger = {
  debug: (message) => write('debug', message),
  info: (message) => write('info', message),
  warn: (message) => write('warn', message),
  error: (message) => write('error', message)
};

module.exports = { logger, redact };
