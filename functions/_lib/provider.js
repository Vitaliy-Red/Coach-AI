// Настройки провайдера голоса и текста берутся из переменных окружения Cloudflare Pages.
//
// Вариант A — Yandex AI Studio (работает из России, оплата в рублях):
//   PROVIDER=yandex, YANDEX_API_KEY, YANDEX_FOLDER_ID
// Вариант B — OpenAI (как голос ChatGPT; официально в России не работает):
//   PROVIDER=openai, OPENAI_API_KEY
// Необязательно: ACCESS_CODE (код команды), REALTIME_MODEL, LLM_MODEL, EVAL_MODEL,
//   VOICE_FEMALE, VOICE_MALE, VOICE_ROLE, MAX_CALL_SECONDS, YANDEX_TRANSCRIPTION.
//
// Текст (диалог и разбор) может идти через бесплатные открытые модели Cloudflare Workers AI:
//   привязка AI в настройках проекта. Тогда текст идёт через неё, голос — через PROVIDER.
//   TEXT_PROVIDER=yandex|openai — вернуть текст платному провайдеру; CF_MODEL, CF_EVAL_MODEL — модели.

// Открытые модели Workers AI: нейроны Cloudflare на 1 млн токенов (бесплатно 10 000 нейронов в сутки).
export const CF_MODELS = {
  '@cf/google/gemma-4-26b-a4b-it': { in: 9091, out: 27273 },
  '@cf/openai/gpt-oss-120b': { in: 31818, out: 68182, reasoning: true },
  '@cf/openai/gpt-oss-20b': { in: 18182, out: 27273, reasoning: true },
  '@cf/qwen/qwen3-30b-a3b-fp8': { in: 4625, out: 30475, noThink: true },
  '@cf/zai-org/glm-4.7-flash': { in: 5500, out: 36400, reasoning: true },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { in: 31876, out: 50488 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 26668, out: 204805 },
};
export const CF_DAILY_NEURONS = 10000;
export const CF_CHAT_DEFAULT = '@cf/google/gemma-4-26b-a4b-it';
export const CF_EVAL_DEFAULT = '@cf/openai/gpt-oss-120b';

export function cfNeurons(model, inTok, outTok) {
  const r = CF_MODELS[model] || { in: 30000, out: 70000 };
  return ((Number(inTok) || 0) * r.in + (Number(outTok) || 0) * r.out) / 1e6;
}

export function providerConfig(env = {}) {
  const base = voiceConfig(env);
  const want = String(env.TEXT_PROVIDER || (env.AI ? 'cloudflare' : '')).toLowerCase().trim();
  if (want === 'cloudflare' && env.AI) {
    const text = {
      kind: 'cloudflare',
      ai: env.AI,
      model: env.CF_MODEL || CF_CHAT_DEFAULT,
      evalModel: env.CF_EVAL_MODEL || CF_EVAL_DEFAULT,
      jsonMode: false,
    };
    return { ...base, text, textProvider: 'cloudflare' };
  }
  return { ...base, textProvider: base.text ? base.provider : '' };
}

function voiceConfig(env = {}) {
  const raw = String(env.PROVIDER || '').toLowerCase().trim();
  const provider = raw || (env.YANDEX_API_KEY ? 'yandex' : env.OPENAI_API_KEY ? 'openai' : '');
  const maxCall = clampInt(env.MAX_CALL_SECONDS, 60, 1800, 900);

  if (provider === 'yandex') {
    const key = env.YANDEX_API_KEY;
    const folder = env.YANDEX_FOLDER_ID;
    const missing = [!key && 'YANDEX_API_KEY', !folder && 'YANDEX_FOLDER_ID'].filter(Boolean);
    if (missing.length) return { provider, ok: false, missing, maxCall };
    const scheme = env.YANDEX_AUTH_SCHEME || 'Bearer';
    const auth = { Authorization: `${scheme} ${key}`, 'OpenAI-Project': folder, 'x-folder-id': folder };
    const rtModel = env.REALTIME_MODEL || `gpt://${folder}/speech-realtime-250923`;
    const rate = clampInt(env.AUDIO_RATE, 8000, 48000, 16000);
    return {
      provider,
      ok: true,
      maxCall,
      realtime: {
        url: `https://ai.api.cloud.yandex.net/v1/realtime/openai?model=${rtModel}`,
        headers: auth,
        model: rtModel,
        voices: { female: env.VOICE_FEMALE || 'masha', male: env.VOICE_MALE || 'kirill' },
        role: env.VOICE_ROLE || '',
        rate,
        transcriptionModel: env.TRANSCRIPTION_MODEL || '',
        transcription: ['1', 'on', 'true', 'yes'].includes(String(env.YANDEX_TRANSCRIPTION || '').toLowerCase()),
        flavor: 'yandex',
      },
      text: {
        url: 'https://llm.api.cloud.yandex.net/v1/chat/completions',
        headers: auth,
        model: env.LLM_MODEL || `gpt://${folder}/yandexgpt/latest`,
        evalModel: env.EVAL_MODEL || env.LLM_MODEL || `gpt://${folder}/yandexgpt/latest`,
        jsonMode: false,
      },
    };
  }

  if (provider === 'openai') {
    const key = env.OPENAI_API_KEY;
    if (!key) return { provider, ok: false, missing: ['OPENAI_API_KEY'], maxCall };
    const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const auth = { Authorization: `Bearer ${key}` };
    const rtModel = env.REALTIME_MODEL || 'gpt-realtime-2.1';
    return {
      provider,
      ok: true,
      maxCall,
      realtime: {
        url: `${base}/realtime?model=${encodeURIComponent(rtModel)}`,
        headers: auth,
        model: rtModel,
        voices: { female: env.VOICE_FEMALE || 'marin', male: env.VOICE_MALE || 'cedar' },
        role: '',
        rate: 24000,
        transcriptionModel: env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
        flavor: 'openai',
      },
      text: {
        url: `${base}/chat/completions`,
        headers: auth,
        model: env.LLM_MODEL || 'gpt-4.1-mini',
        evalModel: env.EVAL_MODEL || 'gpt-4.1',
        jsonMode: true,
      },
    };
  }

  return { provider: '', ok: false, missing: ['PROVIDER'], maxCall };
}

// Конфигурация голосовой сессии в формате OpenAI Realtime (его поддерживает и Yandex AI Studio).
// Для Yandex отправляем только поля из его документации, чтобы сессия не отклонялась.
export function sessionConfig(rt, { instructions, gender, tools }) {
  const voice = gender === 'male' ? rt.voices.male : rt.voices.female;
  const format = { type: 'audio/pcm', rate: rt.rate };
  if (rt.flavor === 'openai') {
    return {
      type: 'realtime',
      model: rt.model,
      instructions,
      output_modalities: ['audio'],
      audio: {
        input: {
          format,
          transcription: { model: rt.transcriptionModel, language: 'ru' },
          noise_reduction: { type: 'near_field' },
          turn_detection: {
            type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600,
            create_response: true, interrupt_response: true,
          },
        },
        output: { format, voice },
      },
      tools,
      tool_choice: 'auto',
    };
  }
  const input = {
    format,
    languages: ['ru-RU'],
    turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 600 },
  };
  if (rt.transcription) input.transcription = rt.transcriptionModel ? { model: rt.transcriptionModel, language: 'ru' } : { language: 'ru' };
  const output = { format, voice };
  if (rt.role) output.role = rt.role;
  return { type: 'realtime', instructions, output_modalities: ['audio'], audio: { input, output }, tools, tool_choice: 'auto' };
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
