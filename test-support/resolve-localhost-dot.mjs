// Test-only preload: some sandboxes and CI resolvers cannot resolve the fully
// qualified "localhost." name that behavior tests use to model a *remote* AI
// endpoint (it is deliberately absent from the local-endpoint allowlist).
// Resolve it to loopback without touching production code paths.
import dns from 'node:dns';

const originalLookup = dns.lookup;
dns.lookup = function lookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (String(hostname).toLowerCase() === 'localhost.') {
    const opts = typeof options === 'number' ? { family: options } : (options || {});
    if (opts.all) return process.nextTick(callback, null, [{ address: '127.0.0.1', family: 4 }]);
    return process.nextTick(callback, null, '127.0.0.1', 4);
  }
  return originalLookup.call(this, hostname, options, callback);
};
