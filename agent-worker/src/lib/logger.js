const safe = value => value instanceof Error
  ? { name: value.name, code: value.code, message: value.message, stack: process.env.NODE_ENV === 'development' ? value.stack : undefined }
  : value;

export function log(level, event, fields = {}) {
  const record = { time: new Date().toISOString(), level, event };
  for (const [key, value] of Object.entries(fields)) record[key] = safe(value);
  const target = level === 'error' ? console.error : console.log;
  target(JSON.stringify(record));
}
