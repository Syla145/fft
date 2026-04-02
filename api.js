// ── API MODULE ──────────────────────────────────────────────
const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const CACHE_KEY_PREFIX = 'dynastyhq_';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// allorigins wraps the response in { contents: "..." }
// corsproxy.io returns raw JSON
const CORS_PROXIES = [
  { build: url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, unwrap: r => JSON.parse(r.contents) },
  { build: url => `https://corsproxy.io/?${encodeURIComponent(url)}`,              unwrap: r => r },
  { build: url => `https://thingproxy.freeboard.io/fetch/${url}`,                  unwrap: r => r },
];
let workingProxyIdx = null;

// ── CACHE HELPERS ─────────────────────────────────────────────
function cacheSet(key, data) {
  try { localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch(e) {}
}
function cacheGet(key, maxAge = CACHE_TTL) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    return (Date.now() - ts > maxAge) ? null : data;
  } catch(e) { return null; }
}

// ── CORE FETCH WITH PROXY ─────────────────────────────────────
async function fetchJSON(url) {
  // Try all proxies (start with cached working one)
  const order = workingProxyIdx !== null
    ? [workingProxyIdx, ...CORS_PROXIES.map((_,i) => i).filter(i => i !== workingProxyIdx)]
    : CORS_PROXIES.map((_,i) => i);

  let lastErr = '';
  for (const i of order) {
    const proxy = CORS_PROXIES[i];
    try {
      const proxyUrl = proxy.build(url);
      const res = await fetch(proxyUrl, { redirect: 'follow' });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const raw = await res.json();
      const data = proxy.unwrap(raw);
      workingProxyIdx = i;
      return data;
    } catch(e) { lastErr = e.message; }
  }
  throw new Error(`API nicht erreichbar (${lastErr}). Bitte kurz warten und erneut versuchen.`);
}

// ── SLEEPER FETCH WITH CACHE ───────────────────────────────────
async function sleeperFetch(path, maxAge = CACHE_TTL) {
  const cacheKey = 'sl_' + path.replace(/\//g, '_');
  const cached = cacheGet(cacheKey, maxAge);
  if (cached) return cached;
  const data = await fetchJSON(SLEEPER_BASE + path);
  cacheSet(cacheKey, data);
  return data;
}

// ── SLEEPER ENDPOINTS ─────────────────────────────────────────
async function getUser(username) {
  // lowercase username as sleeper expects it
  const data = await fetchJSON(`${SLEEPER_BASE}/user/${encodeURIComponent(username.toLowerCase())}`);
  if (!data || !data.user_id) throw new Error(`Benutzer "${username}" nicht gefunden.`);
  return data;
}

async function getLeagueRosters(leagueId) {
  return await sleeperFetch(`/league/${leagueId}/rosters`);
}

async function getLeagueUsers(leagueId) {
  return await sleeperFetch(`/league/${leagueId}/users`);
}

async function getLeagueDraftPicks(leagueId) {
  return await sleeperFetch(`/league/${leagueId}/traded_picks`);
}

async function getAllPlayers() {
  const cacheKey = 'players_nfl';
  const cached = cacheGet(cacheKey, 12 * 60 * 60 * 1000);
  if (cached) return cached;
  const data = await fetchJSON(`${SLEEPER_BASE}/players/nfl`);
  cacheSet(cacheKey, data);
  return data;
}

// ── PLAYER VALUES ─────────────────────────────────────────────
async function fetchPlayerValues(source) {
  if (source === 'ktc') return await fetchKTCValues();
  return await fetchFantasyCalcValues();
}

async function fetchKTCValues() {
  const cached = cacheGet('ktc_values', 6 * 60 * 60 * 1000);
  if (cached) return cached;
  try {
    const data = await fetchJSON('https://keeptradecut.com/api/rankings?format=1&lineup=1&page=0&numQBs=1');
    const map = {};
    (Array.isArray(data) ? data : (data.rankings || [])).forEach(p => {
      if (p.sleeperId) map[p.sleeperId] = p.value || p.overallValue || 0;
      if (p.playerName) map[normalizeName(p.playerName)] = p.value || p.overallValue || 0;
    });
    if (Object.keys(map).length > 0) { cacheSet('ktc_values', map); return map; }
  } catch(e) {}
  return await fetchFantasyCalcValues();
}

async function fetchFantasyCalcValues() {
  const cached = cacheGet('fc_values', 6 * 60 * 60 * 1000);
  if (cached) return cached;
  try {
    const data = await fetchJSON('https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&ppr=1&numTeams=10');
    const map = {};
    (Array.isArray(data) ? data : []).forEach(item => {
      const p = item.player || item;
      const val = item.value || 0;
      if (p.sleeperId) map[p.sleeperId] = val;
      if (p.name) map[normalizeName(p.name)] = val;
    });
    if (Object.keys(map).length > 0) { cacheSet('fc_values', map); return map; }
  } catch(e) {}
  return {};
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── PICK VALUE ESTIMATE ───────────────────────────────────────
function estimatePickValue(season, round, teamStrength) {
  const yearsOut = Math.max(0, parseInt(season) - new Date().getFullYear());
  const base = { 1: 3500, 2: 1800, 3: 900, 4: 400 }[round] || 300;
  let val = base * Math.pow(0.85, yearsOut);
  if (round === 1) val *= (1 + (1 - (teamStrength || 0.5)) * 0.5);
  return Math.round(val);
}
