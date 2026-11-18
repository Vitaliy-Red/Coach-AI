import { providerConfig } from '../_lib/provider.js';
import { json, checkAccess } from '../_lib/http.js';

// GET /api/config — что подключено: провайдер, нужен ли код команды, частота звука.
export async function onRequestGet({ request, env }) {
  const cfg = providerConfig(env);
  const accessCode = Boolean(String(env.ACCESS_CODE || '').trim());
  return json({
    ready: cfg.ok,
    textReady: Boolean(cfg.text),
    textProvider: cfg.textProvider || null,
    provider: cfg.provider || null,
    missing: cfg.ok ? [] : cfg.missing,
    rate: cfg.ok ? cfg.realtime.rate : null,
    maxCall: cfg.maxCall,
    accessCode,
    codeOk: checkAccess(request, env),
  });
}
