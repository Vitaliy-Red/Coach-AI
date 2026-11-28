// Render may reject a WebSocket upgrade while a free instance is waking up.
// Retry only before a socket exists, so a call or its greeting cannot be duplicated.
export async function openGeminiBridge(url, headers, signal, onWait, fetcher = fetch, sleep = delay) {
  const upgrade = () => fetcher(url, { headers, signal });
  const response = await upgrade().catch((e) => {
    if (signal.aborted) throw e;
    return new Response(null, { status: 503 });
  });
  if (response.webSocket || ![429, 502, 503, 504].includes(response.status)) return response;
  const seconds = retrySeconds(response, 3);
  if (seconds > 65) return response;
  onWait(response.status);
  await response.body?.cancel();
  await sleep(seconds * 1000, signal);
  const health = await fetcher(new URL('health', url), { headers: { Accept: 'application/json' }, signal }).catch((error) => {
    if (signal.aborted) throw error;
    return new Response(null, { status: 503 });
  });
  const ready = health.ok && health.headers.get('Content-Type')?.includes('application/json')
    ? await health.json().catch(() => null) : null;
  if (!health.bodyUsed) await health.body?.cancel();
  if (ready?.ready === false) return new Response(null, { status: 503 });
  if (!ready?.ready) {
    const wait = retrySeconds(health, 25);
    if (wait > 65) return new Response(null, { status: health.ok ? 503 : health.status, headers: health.headers });
    await sleep(wait * 1000, signal);
  }
  return upgrade();
}

function retrySeconds(response, fallback) {
  const retry = response.headers.get('Retry-After');
  if (!retry) return fallback;
  const seconds = /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000;
  return Math.max(1, Number.isFinite(seconds) ? seconds : fallback);
}

function delay(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    function cancel() { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener('abort', cancel, { once: true });
  });
}
