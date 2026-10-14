'use strict';
// Do not forward test stdout as attestation. File-summary events exist for declared tests,
// unlike the runner's synthetic "passed file" event for an empty test file.
module.exports = async function* (source) {
  const files = new Map(); let overall = null, outputBytes = 0;
  for await (const event of source) {
    if (event.type === 'test:stdout' || event.type === 'test:stderr') {
      outputBytes += Buffer.byteLength(event.data.message || '');
      if (outputBytes > 1024 * 1024) throw new Error('Test output exceeded the 1 MiB bound.');
    }
    if (event.type === 'test:summary') {
      if (event.data.file) files.set(event.data.file, { file: event.data.file, success: event.data.success, counts: event.data.counts });
      else overall = { success: event.data.success, counts: event.data.counts };
    }
  }
  yield JSON.stringify({ orbitQa: 1, files: [...files.values()], overall }) + '\n';
};
