import { providerConfig } from '../_lib/provider.js';
import { json, checkAccess } from '../_lib/http.js';
import { resetOldTrainingData } from '../_lib/training-data.js';
import { staffAuthEnabled, currentStaff } from '../_lib/staff-auth.js';

// GET /api/config — что подключено: провайдер, нужен ли код команды, частота звука.
export async function onRequestGet({ request, env }) {
  const cfg = providerConfig(env);
  const accessCode = Boolean(String(env.ACCESS_CODE || '').trim());
  const host = new URL(request.url).hostname;
  let historyResetApplied;
  if (['superjob-coach.pages.dev', 'red-coach.pages.dev'].includes(host)) {
    try { historyResetApplied = await resetOldTrainingData(env); }
    catch (error) { console.error('training data reset failed', error?.message); historyResetApplied = false; }
  }
  return json({
    ready: cfg.ok,
    textReady: Boolean(cfg.text),
    // Голос: browser — бесплатно (голос браузера + текстовая модель), realtime — живой голос Yandex/OpenAI.
    voiceEngine: String(env.VOICE_ENGINE || '').toLowerCase() === 'realtime' ? 'realtime' : 'browser',
    textProvider: cfg.textProvider || null,
    provider: cfg.provider || null,
    missing: cfg.ok ? [] : cfg.missing,
    rate: cfg.ok ? cfg.realtime.rate : null,
    maxCall: cfg.maxCall,
    accessCode,
    codeOk: checkAccess(request, env),
    historyResetApplied,
    staffLogin: staffAuthEnabled(env),
    profile: await currentStaff(request, env),
  });
}
