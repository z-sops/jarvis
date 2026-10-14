'use strict';
const fs = require('fs'), { TextDecoder } = require('util');
// Byte offsets make bounded reads independent of the total file size.
function readTextWindow(file, { offset = 0, limit = 20000 } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 4 || limit > 20000) throw new Error('Use a nonnegative byte offset and a byte limit from 4 to 20000.');
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd); if (!st.isFile()) throw new Error('Not a regular file.');
    const buffer = Buffer.alloc(Math.min(limit, Math.max(0, st.size - offset))), n = fs.readSync(fd, buffer, 0, buffer.length, offset);
    if (buffer.subarray(0, n).includes(0)) throw new Error('This looks like a binary file, not text.');
    const decoder = new TextDecoder('utf-8', { fatal: true }); let content, consumed = n;
    const maxTrim = offset + n < st.size ? Math.min(3, n) : 0;
    for (let trim = 0; trim <= maxTrim; trim++) {
      try { content = decoder.decode(buffer.subarray(0, n - trim)); consumed = n - trim; break; } catch { /* only a split trailing character can be omitted */ }
    }
    if (content === undefined || (n && !consumed)) throw new Error('Invalid UTF-8 or an offset inside a character. Use the previous nextOffset.');
    const nextOffset = offset + consumed;
    return { content, offset, bytesRead: consumed, nextOffset, totalBytes: st.size, truncated: nextOffset < st.size, unit: 'utf8_bytes', dataOnly: true };
  } finally { fs.closeSync(fd); }
}
module.exports = { readTextWindow };
