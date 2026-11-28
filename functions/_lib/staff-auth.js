import { staffConfig } from './team.js';
import { fail } from './http.js';

export const STAFF_COOKIE = '__Host-red_coach';
export const STAFF_SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function staffAuthEnabled(env) {
  return Boolean(env.STAFF_CONFIG);
}

export function staffProfile(env, name, team, role) {
  const { teams, leaders } = staffConfig(env);
  if (role === 'leader') {
    const leader = leaders.find((item) => item.name === name);
    return leader ? { name, team: leader.teams[0] || '', role, teams: leader.teams } : null;
  }
  const member = teams.find((item) => item.id === team && item.members.includes(name));
  return member ? { name, team, role: 'manager' } : null;
}

export function staffProfiles(env) {
  const { teams, leaders } = staffConfig(env);
  return [
    ...teams.flatMap(({ id, members }) => members.map((name) => ({ name, team: id, role: 'manager' }))),
    ...leaders.map(({ name, teams: leaderTeams }) => ({ name, team: leaderTeams[0] || '', role: 'leader', teams: leaderTeams })),
  ];
}

function keyFor(env, usage) {
  const { signingKey } = staffConfig(env);
  if (!/^[\da-f]{64}$/.test(signingKey)) throw new Error('Staff login needs a configured signing key');
  return crypto.subtle.importKey('raw', encoder.encode(signingKey), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function sign(env, message) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await keyFor(env, 'sign'), encoder.encode(message)));
}

export async function staffCode(env, profile) {
  const subject = JSON.stringify([profile.role, profile.team, profile.name]);
  const signature = await sign(env, 'login:' + subject);
  return Array.from(signature.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validStaffCode(supplied, expected) {
  if (!/^[0-9a-f]{24}$/.test(supplied)) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_');
}

function decode64(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (character) => character.charCodeAt(0));
}

export async function createStaffSession(env, profile) {
  const data = base64url(encoder.encode(JSON.stringify({
    name: profile.name, team: profile.team, role: profile.role, expires: Date.now() + STAFF_SESSION_SECONDS * 1000,
  })));
  return data + '.' + base64url(await sign(env, 'session:' + data));
}

export async function currentStaff(request, env) {
  if (!staffAuthEnabled(env)) return null;
  const cookie = (request.headers.get('Cookie') || '').split(';').find((part) => part.trimStart().startsWith(STAFF_COOKIE + '='));
  const token = cookie?.trimStart().slice(STAFF_COOKIE.length + 1) || '';
  if (!/^[\w-]{1,500}\.[\w-]{43}$/.test(token)) return null;
  try {
    const [data, signature] = token.split('.');
    const valid = await crypto.subtle.verify('HMAC', await keyFor(env, 'verify'), decode64(signature), encoder.encode('session:' + data));
    if (!valid) return null;
    const { name, team, role, expires } = JSON.parse(decoder.decode(decode64(data)));
    return expires > Date.now() ? staffProfile(env, name, team, role) : null;
  } catch { return null; }
}

export function staffDenied() {
  return fail(401, 'staff', 'Выберите свой профиль и войдите с личным кодом.');
}
