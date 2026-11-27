// Render may reject a WebSocket upgrade while a free instance is waking up.
// Retry only before a socket exists, so a call or its greeting cannot be duplicated.
export async function openGeminiBridge(url, headers, signal, onWait, fetcher = fetch, sleep = delay) {
  const upgrade = () => fetcher(url, { headers, signal });
  let response = await upgrade().catch((e) => {
    if (signal.aborted) throw e;
    return new Response(null, { status: 503 });
  });
  if (response.webSocket || ![429, 502, 503, 504].includes(response.status)) return response;
  const retry = response.headers.get('Retry-After');
  const seconds = retry === null ? 3 : /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000;
  if (seconds > 65) return response;
  onWait(response.status);
  await response.body?.cancel();
  await sleep(Math.max(1, Number.isFinite(seconds) ? seconds : 3) * 1000, signal);
  const health = await fetcher(new URL('health', url), { headers: { Accept: 'application/json' }, signal });
  const ready = health.ok && health.headers.get('Content-Type')?.includes('application/json')
    ? await health.json().catch(() => null) : null;
  if (!health.bodyUsed) await health.body?.cancel();
  if (health.status === 429) return new Response(null, { status: 429, headers: health.headers });
  if (ready?.ready === false) return new Response(null, { status: 503 });
  if (!ready?.ready) await sleep(5000, signal);
  response = await upgrade();
  return response;
}

function delay(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
    function cancel() { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener('abort', cancel, { once: true });
  });
}
