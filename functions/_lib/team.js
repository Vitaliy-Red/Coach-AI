// Список сотрудников хранится в секрете STAFF_CONFIG у Cloudflare.
export function staffConfig(env) {
  try {
    const config = JSON.parse(env.STAFF_CONFIG || '{}');
    return {
      signingKey: typeof config.signingKey === 'string' ? config.signingKey : '',
      teams: Array.isArray(config.teams) ? config.teams : [],
      leaders: Array.isArray(config.leaders) ? config.leaders : [],
    };
  } catch { return { signingKey: '', teams: [], leaders: [] }; }
}

export function teamOf(env, name) {
  return staffConfig(env).teams.find((team) => team.members.includes(name) || team.lead === name)?.id || '';
}
