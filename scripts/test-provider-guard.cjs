// Tests must install fake transports explicitly. Never fall through to host fetch.
globalThis.fetch = async () => { throw new Error('Unmocked HTTP is disabled in offline tests'); };
for (const protocol of ['node:http', 'node:https']) {
  const client = require(protocol);
  for (const method of ['request', 'get']) {
    const original = client[method];
    client[method] = function (input, ...args) {
      const hostname = typeof input === 'string' || input instanceof URL
        ? new URL(input).hostname : input?.hostname ?? input?.host ?? '';
      if (/(^|\.)(googleapis\.com|openai\.com|anthropic\.com)(:|$)/i.test(hostname))
        throw new Error('Provider HTTP is disabled in offline tests');
      return original.call(this, input, ...args);
    };
  }
}
