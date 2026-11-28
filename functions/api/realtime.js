import { providerConfig, sessionConfig } from '../_lib/provider.js';
import { checkAccess } from '../_lib/http.js';
import { buildClientPrompt, resolveScenario, resolveGender, END_CALL_TOOL, scenarioExists } from '../_lib/prompt.js';
import { PRIVATE } from '../_lib/private.js';
import { openGeminiBridge } from '../_lib/gemini-bridge.js';
import { currentStaff, staffAuthEnabled } from '../_lib/staff-auth.js';

// GET /api/realtime?scenario=hh&level=medium&code=... (WebSocket)
// Реле между браузером и голосовым сервисом (протокол OpenAI Realtime; его же поддерживает Yandex AI Studio).
// Ключ и промпт клиента остаются на сервере: браузер их не видит и не может подменить.

const CLIENT_ALLOWED = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'response.cancel',
  'response.create',
  'conversation.item.truncate',
  'conversation.item.create',
]);

export async function onRequest(context) {
  const { request, env } = context;
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('Нужно WebSocket-подключение', { status: 426 });
  }
  const url = new URL(request.url);
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const toClient = (obj) => {
    try { server.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch {}
  };
  const fatal = (code, message) => {
    toClient({ type: 'coach.error', error: { code, message } });
    try { server.close(1011, code); } catch {}
  };

  const run = async () => {
    if (!checkAccess(request, env)) return fatal('access', 'Неверный код команды');
    if (staffAuthEnabled(env) && !await currentStaff(request, env))
      return fatal('staff', 'Выберите свой профиль и войдите с личным кодом.');
    const cfg = providerConfig(env);
    if (!cfg.ok) return fatal('config', 'Голос не подключён: нет ' + cfg.missing.join(', '));
    const reqId = url.searchParams.get('scenario') || '';
    if (!scenarioExists(reqId)) return fatal('scenario', 'Неизвестный тренажёр');
    const resolved = resolveScenario(reqId, url.searchParams.get('level') || 'medium');
    const gender = resolveGender(PRIVATE[resolved.id]);
    const instructions = buildClientPrompt({ id: resolved.id, level: resolved.level, mode: 'voice', gender });

    const sid = url.searchParams.get('sid') || '';
    const trace = /^[\w-]{8,64}$/.test(sid) ? sid : crypto.randomUUID();
    const startup = new AbortController();
    const cancelStart = () => startup.abort();
    server.addEventListener('close', cancelStart);
    const startupTimer = setTimeout(cancelStart, 80000);
    let upstreamResp;
    try {
      const headers = { Upgrade: 'websocket', ...cfg.realtime.headers };
      if (cfg.provider === 'gemini') {
        headers['X-Coach-Session'] = trace;
        upstreamResp = await openGeminiBridge(cfg.realtime.url, headers, startup.signal, (status) => {
          console.info('coach.voice', { trace, event: 'bridge_wait', status });
          toClient({ type: 'coach.status', phase: 'warming' });
        });
      } else {
        upstreamResp = await fetch(cfg.realtime.url, { headers, signal: startup.signal });
      }
    } catch (e) {
      console.warn('coach.voice', { trace, event: 'bridge_unavailable' });
      return fatal('upstream', 'Голосовой сервер не успел подключиться. Попробуйте ещё раз или начните тренировку в режиме «Диалог».');
    } finally {
      clearTimeout(startupTimer);
      server.removeEventListener('close', cancelStart);
    }
    const upstream = upstreamResp.webSocket;
    if (!upstream) {
      if (cfg.provider === 'gemini') {
        console.warn('coach.voice', { trace, event: 'bridge_rejected', status: upstreamResp.status });
        await upstreamResp.body?.cancel();
        return fatal('upstream', 'Голосовой сервер временно недоступен (HTTP ' + upstreamResp.status + '). Можно продолжить тренировку в резервном режиме.');
      }
      const text = await upstreamResp.text().catch(() => '');
      return fatal('upstream', `Голосовой сервис ответил ${upstreamResp.status}. ${text.slice(0, 300)}`);
    }
    upstream.accept();
    if (startup.signal.aborted || server.readyState !== 1) { upstream.close(1000, 'client left'); return; }

    let closed = false;
    let greeted = false;
    let sessionOk = false;
    let limitTimer = 0;
    let greetTimer = 0;
    const closeAll = (code = 1000, reason = '') => {
      if (closed) return;
      closed = true;
      clearTimeout(limitTimer);
      clearTimeout(greetTimer);
      try { upstream.close(code, reason); } catch {}
      try { server.close(code, reason); } catch {}
    };
    const greet = () => {
      if (greeted || closed) return;
      greeted = true;
      sessionOk = true;
      try { upstream.send(JSON.stringify({ type: 'response.create' })); } catch {}
    };
    limitTimer = setTimeout(() => { toClient({ type: 'coach.timeout' }); closeAll(1000, 'time limit'); }, cfg.maxCall * 1000);
    // У Gemini подтверждение приходит только после настройки сессии на Render.
    if (cfg.provider !== 'gemini') greetTimer = setTimeout(greet, 3000); // если сервис не прислал session.updated

    upstream.send(JSON.stringify({
      type: 'session.update',
      session: sessionConfig(cfg.realtime, { instructions, gender, tools: [END_CALL_TOOL] }),
    }));

    toClient({
      type: 'coach.ready',
      rate: cfg.realtime.rate,
      provider: cfg.provider,
      maxCall: cfg.maxCall,
      // Для «случайного клиента» браузер узнаёт настоящий сценарий, но показывает его только в разборе.
      resolved: { id: resolved.id, level: resolved.level, gender },
    });

    upstream.addEventListener('message', (ev) => {
      let data = ev.data;
      if (typeof data !== 'string') { toClient(data); return; }
      // Аудио пересылаем без разбора JSON — это экономит время процессора.
      const head = data.slice(0, 160);
      if (data.length < 200_000 && head.includes('"session.')) {
        try {
          const obj = JSON.parse(data);
          if (obj.session) { delete obj.session.instructions; delete obj.session.tools; }
          if (obj.type === 'session.updated') { sessionOk = true; greet(); }
          data = JSON.stringify(obj);
        } catch {}
      } else if (!sessionOk && head.includes('"type":"error"')) {
        // Сервис отклонил настройки сессии: без них клиент не в роли — честно прерываем звонок.
        let msg = '';
        try { msg = JSON.parse(data).error?.message || ''; } catch {}
        fatal('session', 'Голосовой сервис не принял настройки звонка. ' + msg.slice(0, 300));
        closeAll(1011, 'session rejected');
        return;
      }
      toClient(data);
    });

    server.addEventListener('message', (ev) => {
      const data = ev.data;
      if (typeof data !== 'string') return;
      if (data.startsWith('{"type":"input_audio_buffer.append"')) {
        try { upstream.send(data); } catch {}
        return;
      }
      let obj;
      try { obj = JSON.parse(data); } catch { return; }
      if (!obj || !CLIENT_ALLOWED.has(obj.type)) return;
      if (obj.type === 'response.create') obj = { type: 'response.create' }; // без подмены инструкций
      if (obj.type === 'conversation.item.create') {
        const it = obj.item || {};
        const isText = it.type === 'message' && it.role === 'user' && Array.isArray(it.content) &&
          it.content.length > 0 && it.content.every((c) => c && c.type === 'input_text' && typeof c.text === 'string' && c.text.length <= 2000);
        const isToolResult = it.type === 'function_call_output' && typeof it.call_id === 'string';
        if (!isText && !isToolResult) return;
      }
      try { upstream.send(JSON.stringify(obj)); } catch {}
    });

    server.addEventListener('close', () => closeAll());
    server.addEventListener('error', () => closeAll());
    upstream.addEventListener('close', (e) => {
      if (!closed) console.info('coach.voice', { trace, event: 'bridge_closed', code: e.code });
      if (!closed) toClient({ type: 'coach.upstream_closed', code: e.code, reason: e.reason || '' });
      closeAll();
    });
    upstream.addEventListener('error', () => {
      if (!closed) toClient({ type: 'coach.error', error: { code: 'upstream', message: 'Обрыв соединения с голосовым сервисом' } });
      closeAll();
    });
  };

  context.waitUntil(run().catch((e) => fatal('internal', 'Ошибка сервера: ' + e.message)));
  return new Response(null, { status: 101, webSocket: client });
}
