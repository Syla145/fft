// ── API MODULE ──────────────────────────────────────────────
const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const CACHE_KEY_PREFIX = 'dynastyhq_';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// CORS Proxies – tried in order until one works
const CORS_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];
let workingProxyIdx = null;

// ── CACHE HELPERS ─────────────────────────────────────────────
function cacheSet(key, data) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch(e) {}
}

function cacheGet(key, maxAge = CACHE_TTL) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > maxAge) return null;
    return data;
  } catch(e) { return null; }
}

// ── FETCH WITH PROXY FALLBACK ─────────────────────────────────
async function fetchWithProxy(url) {
  // 1. Try direct first (works if Sleeper ever fixes CORS)
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    if (res.ok) return await res.json();
  } catch(e) {}

  // 2. Try cached working proxy first
  if (workingProxyIdx !== null) {
    try {
      const proxyUrl = CORS_PROXIES[workingProxyIdx](url);
      const res = await fetch(proxyUrl);
      if (res.ok) return await res.json();
    } catch(e) { workingProxyIdx = null; }
  }

  // 3. Try all proxies in order
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    try {
      const proxyUrl = CORS_PROXIES[i](url);
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const data = await res.json();
        workingProxyIdx = i; // remember this one
        return data;
      }
    } catch(e) {}
  }

  throw new Error('Sleeper API nicht erreichbar. Bitte kurz warten und erneut versuchen.');
}

// ── SLEEPER API ───────────────────────────────────────────────
async function sleeperFetch(path) {
  const cacheKey = 'sleeper_' + path.replace(/\//g, '_');
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchWithProxy(SLEEPER_BASE + path);
  cacheSet(cacheKey, data);
  return data;
}

async function getUser(username) {
  const data = await fetchWithProxy(`${SLEEPER_BASE}/user/${encodeURIComponent(username)}`);
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

  const data = await fetchWithProxy(`${SLEEPER_BASE}/players/nfl`);
  cacheSet(cacheKey, data);
  return data;
}

// ── PLAYER VALUES API ─────────────────────────────────────────
async function fetchPlayerValues(source) {
  switch(source) {
    case 'ktc':         return await fetchKTCValues();
    case 'fantasycalc': return await fetchFantasyCalcValues();
    default:            return await fetchFantasyCalcValues();
  }
}

async function fetchKTCValues() {
  const cacheKey = 'ktc_values';
  const cached = cacheGet(cacheKey, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  // Try KTC via proxy
  try {
    const url = 'https://keeptradecut.com/api/rankings?format=1&lineup=1&page=0&numQBs=1';
    const data = await fetchWithProxy(url);
    const map = {};
    (Array.isArray(data) ? data : (data.rankings || [])).forEach(p => {
      if (p.sleeperId) map[p.sleeperId] = p.value || p.overallValue || 0;
      if (p.playerName) map[normalizeName(p.playerName)] = p.value || p.overallValue || 0;
    });
    if (Object.keys(map).length > 0) {
      cacheSet(cacheKey, map);
      return map;
    }
  } catch(e) {}

  // Fallback to FantasyCalc
  return await fetchFantasyCalcValues();
}

async function fetchFantasyCalcValues() {
  const cacheKey = 'fc_values';
  const cached = cacheGet(cacheKey, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  try {
    const url = 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&ppr=1&numTeams=10';
    const data = await fetchWithProxy(url);
    const map = {};
    (Array.isArray(data) ? data : []).forEach(item => {
      const p = item.player || item;
      const val = item.value || item.overallValue || 0;
      if (p.sleeperId) map[p.sleeperId] = val;
      if (p.name) map[normalizeName(p.name)] = val;
    });
    if (Object.keys(map).length > 0) {
      cacheSet(cacheKey, map);
      return map;
    }
  } catch(e) {}

  console.warn('Spielerwerte nicht verfügbar – alle Werte werden als 0 angezeigt.');
  return {};
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── PICK VALUE ESTIMATE ───────────────────────────────────────
function estimatePickValue(season, round, teamStrength) {
  const currentYear = new Date().getFullYear();
  const yearsOut = Math.max(0, parseInt(season) - currentYear);
  const baseValues = { 1: 3500, 2: 1800, 3: 900, 4: 400 };
  let val = baseValues[round] || 300;
  val = val * Math.pow(0.85, yearsOut);
  if (round === 1) val = val * (1 + (1 - (teamStrength || 0.5)) * 0.5);
  return Math.round(val);
}
