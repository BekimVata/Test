// Small fetch wrapper: timeouts, retries on rate limits / server errors, readable errors.
const sleep = ms => new Promise(r => setTimeout(r, ms));

class ApiError extends Error {
  constructor(service, status, body) {
    super(`${service} returned ${status}: ${String(body).slice(0, 300)}`);
    this.service = service; this.status = status; this.body = body;
  }
}

async function request(service, url, opts = {}, { retries = 3, timeoutMs = 120000, raw = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ApiError(service, res.status, await res.text());
        const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * Math.pow(2, attempt);
        await sleep(Math.min(wait, 30000));
        continue;
      }
      if (raw) {
        if (!res.ok) throw new ApiError(service, res.status, await res.text());
        return Buffer.from(await res.arrayBuffer());
      }
      const text = await res.text();
      let data; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = text; }
      if (!res.ok) throw new ApiError(service, res.status, typeof data === 'string' ? data : JSON.stringify(data));
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ApiError) throw e;
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

module.exports = { request, ApiError, sleep };
