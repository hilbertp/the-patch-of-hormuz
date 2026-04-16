function log(level, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

module.exports = { log };
