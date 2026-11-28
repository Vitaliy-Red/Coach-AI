import test from 'node:test';
import assert from 'node:assert/strict';
import { openGeminiBridge } from '../functions/_lib/gemini-bridge.js';
import { TextCall } from '../assets/js/textcall.js';
import { VoiceCall } from '../assets/js/voice.js';
import { api } from '../assets/js/api.js';

test('a transient upgrade failure warms the bridge and retries exactly once', async () => {
  const requests = [], waits = [], statuses = [];
  const socket = { webSocket: {} };
  const replies = [new Response('', { status: 429, headers: { 'Retry-After': '7' } }), Response.json({ ready: true }), socket];
  const result = await openGeminiBridge('https://bridge.example/api/coach-realtime', {Upgrade: 'websocket'}, new AbortController().signal,
    s => statuses.push(s), async (url, init) => { requests.push([new URL(url).pathname, init.headers.Upgrade]); return replies.shift(); },
    async ms => { waits.push(ms); });
  assert.equal(result, socket);
  assert.deepEqual(requests, [['/api/coach-realtime','websocket'], ['/api/health',undefined], ['/api/coach-realtime','websocket']]);
  assert.deepEqual(waits, [7000]);
  assert.deepEqual(statuses, [429]);
});

test('healthy, permanent, and long rate-limit responses each make one request', async () => {
  for (const reply of [{webSocket:{}}, new Response('',{status:403}), new Response('',{status:429,headers:{'Retry-After':'120'}})]) {
    let requests = 0;
    const result = await openGeminiBridge('https://bridge.example/api/coach-realtime', {}, new AbortController().signal, assert.fail,
      async () => { requests++; return reply; });
    assert.equal(requests,1); assert.equal(result,reply);
  }
});

test('a cold health endpoint returning 429 still allows one upgrade after Retry-After', async () => {
  const waits = [], socket = { webSocket: {} };
  const responses = [new Response(null, {status:429}), new Response(null, {status:429, headers:{'Retry-After':'35'}}), socket];
  const result = await openGeminiBridge('https://bridge.example/api/coach-realtime', {}, new AbortController().signal,
    () => {}, async () => responses.shift(), async ms => { waits.push(ms); });
  assert.equal(result, socket);
  assert.deepEqual(waits, [3000, 35000]);
  assert.equal(responses.length, 0);
});

test('a long Retry-After on the health endpoint postpones the next call', async () => {
  const responses = [new Response(null,{status:503}), new Response(null,{status:429,headers:{'Retry-After':'90'}})];
  const result = await openGeminiBridge('https://bridge.example/api/coach-realtime', {}, new AbortController().signal,
    () => {}, async () => responses.shift(), async () => {});
  assert.equal(result.status,429);assert.equal(result.headers.get('Retry-After'),'90');assert.equal(responses.length,0);
});

test('an interruption preserves the transcript and a normal client goodbye stays a goodbye', () => {
  const results = [];
  const call = new VoiceCall({ scenario:'hh', on:{onEnd:r=>results.push(r)} });
  call.cleanup = () => {};
  call.connected = true;
  call.clientText('c1','Алло!',true);
  call.handle({type:'coach.upstream_closed',code:1011});
  assert.equal(results[0].reason,'dropped');
  assert.equal(results[0].transcript[0].text,'Алло!');
  const goodbye = new VoiceCall({scenario:'hh'});
  goodbye.connected = true;
  goodbye.endRequested = 'отказ';
  let finishing = false;
  goodbye.finishAfterPlayback = () => { finishing = true; };
  goodbye.disconnected();
  assert.equal(finishing,true);
});

test('the dialogue continues the previous scenario, duration and transcript without a second greeting', async () => {
  const previous = { sid:'local-test',realScenario:'price',gender:'male',level:'hard',durationSec:42,transcript:[{role:'client',text:'Почему так дорого?',t:40}] };
  const calls = [];
  const original = api.chat;
  api.chat = async body => { calls.push(body); return {reply:'Слушаю.',ended:false}; };
  const session = new TextCall({ scenario:'random',level:'hard',sid:previous.sid,previous });
  try {
    await session.start(); assert.equal(calls.length,0);
    await session.send('Какой бюджет вы планировали?');
    assert.equal(calls[0].sid,previous.sid); assert.equal(calls[0].scenario,'price');
    assert.equal(calls[0].gender,'male'); assert.equal(calls[0].messages.length,2);
    assert.equal(calls[0].messages[0].text,previous.transcript[0].text);
    assert.ok(session.now() >= 42);
  } finally { session.hangup(); api.chat = original; }
});

test('both recognizers listen to the microphone selected for the call, including after unmuting', async () => {
  const starts = [];
  class Recognizer {
    start(track) { starts.push(track); }
    stop() { this.onend?.(); }
  }
  const savedWindow = globalThis.window;
  globalThis.window = { SpeechRecognition: Recognizer };
  const track = { kind: 'audio', readyState: 'live' };
  const stream = { getAudioTracks: () => [track] };
  try {
    const { BrowserVoiceCall } = await import('../assets/js/browservoice.js');
    const backup = new BrowserVoiceCall({ scenario: 'hh' });
    backup.stream = stream;
    backup.listen();
    backup.setMuted(true);
    backup.setMuted(false);
    backup.closeRec();

    const realtime = new VoiceCall({ scenario: 'hh' });
    realtime.stream = stream;
    realtime.setMuted(true);
    realtime.startBrowserStt();
    assert.deepEqual(starts, [track, track]);
    realtime.setMuted(false);
    realtime.rec.onend();
    assert.deepEqual(starts, [track, track, track, track]);
  } finally {
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  }
});
