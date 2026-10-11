'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

// Observe only Electron's selected session profile. Never manufacture or copy keys.
function keyRecord(profile, flush = false) {
  let fd;
  try {
    const file = path.join(profile, 'Local State');
    const entry = fs.lstatSync(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 1024 * 1024) return { present: false, key: null };
    fd = fs.openSync(file, flush ? 'r+' : 'r');
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > 1024 * 1024 || st.ino !== entry.ino || st.dev !== entry.dev) return { present: false, key: null };
    const bytes = fs.readFileSync(fd);
    const value = JSON.parse(bytes).os_crypt?.encrypted_key;
    if (typeof value !== 'string' || !value.length || value.length > 65536) return { present: true, key: null };
    const key = crypto.createHash('sha256').update(value).digest('hex');
    if (flush) {
      fs.fsyncSync(fd); // Windows FlushFileBuffers needs a writable handle; contents are never edited.
      const current = fs.lstatSync(file);
      if (current.isSymbolicLink() || current.ino !== st.ino || current.dev !== st.dev || !fs.readFileSync(file).equals(bytes)) return { present: false, key: null };
    }
    return { present: true, key };
  } catch { return { present: false, key: null }; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

module.exports = { keyRecord };
