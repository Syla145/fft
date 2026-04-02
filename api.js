// ── API MODULE ──────────────────────────────────────────────
const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const CACHE_KEY_PREFIX = 'dynastyhq_';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// ── CACHE HELPERS ────────────────────────────────────────────
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

// ── SLEEPER API ──────────────────────────────────────────────
async function sleeperFetch(path) {
  const cacheKey = 'sleeper_' + path.replace(/\//g, '_');
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await fetch(SLEEPER_BASE + path);
  if (!res.ok) throw new Error(`Sleeper API Fehler: ${res.status}`);
  const data = await res.json();
  cacheSet(cacheKey, data);
  return data;
}

async function getUser(username) {
  return await sleeperFetch(`/user/${username}`);
}

async function getUserLeagues(userId, season = '2024') {
  return await sleeperFetch(`/user/${userId}/leagues/nfl/${season}`);
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

async function getLeagueDrafts(leagueId) {
  return await sleeperFetch(`/league/${leagueId}/drafts`);
}

async function getAllPlayers() {
  const cacheKey = 'players_nfl';
  const cached = cacheGet(cacheKey, 12 * 60 * 60 * 1000); // 12h cache
  if (cached) return cached;

  const res = await fetch(`${SLEEPER_BASE}/players/nfl`);
  if (!res.ok) throw new Error('Spielerdaten konnten nicht geladen werden');
  const data = await res.json();
  cacheSet(cacheKey, data);
  return data;
}

// ── PLAYER VALUES API ────────────────────────────────────────
async function fetchPlayerValues(source) {
  switch(source) {
    case 'ktc':      return await fetchKTCValues();
    case 'fantasycalc': return await fetchFantasyCalcValues();
    case 'sleeper':  return {}; // Use sleeper rankings as fallback
    default:         return await fetchKTCValues();
  }
}

async function fetchKTCValues() {
  const cacheKey = 'ktc_values';
  const cached = cacheGet(cacheKey, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  try {
    // KTC unofficial endpoint
    const res = await fetch('https://keeptradecut.com/api/rankings?format=1&lineup=1&page=0&numQBs=1', {
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      const map = {};
      (data.rankings || data || []).forEach(p => {
        if (p.sleeperId) map[p.sleeperId] = p.value || p.overallValue || 0;
        if (p.playerName) map[normalizeName(p.playerName)] = p.value || p.overallValue || 0;
      });
      cacheSet(cacheKey, map);
      return map;
    }
  } catch(e) {}

  // Fallback: FantasyCalc
  return await fetchFantasyCalcValues();
}

async function fetchFantasyCalcValues() {
  const cacheKey = 'fc_values';
  const cached = cacheGet(cacheKey, 6 * 60 * 60 * 1000);
  if (cached) return cached;

  try {
    const res = await fetch('https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&ppr=1&numTeams=10');
    if (res.ok) {
      const data = await res.json();
      const map = {};
      (data || []).forEach(item => {
        const p = item.player || item;
        const val = item.value || item.overallValue || 0;
        if (p.sleeperId) map[p.sleeperId] = val;
        if (p.name) map[normalizeName(p.name)] = val;
      });
      cacheSet(cacheKey, map);
      return map;
    }
  } catch(e) {}

  // Final fallback: return empty map, values will show as 0
  console.warn('Spielerwerte konnten nicht geladen werden – kein Wert verfügbar');
  return {};
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── PICKS HELPER ─────────────────────────────────────────────
function buildPicksMap(tradedPicks, rosters, userId) {
  // traded_picks: [{ season, round, roster_id (original), previous_owner_id, owner_id }]
  const myRoster = rosters.find(r => r.owner_id === userId);
  if (!myRoster) return { myPicks: [], theirPicks: {} };

  const years = ['2025', '2026', '2027'];
  const myPicks = [];

  tradedPicks.forEach(pick => {
    if (pick.owner_id === myRoster.roster_id.toString() ||
        pick.owner_id === myRoster.roster_id) {
      myPicks.push(pick);
    }
  });

  // Also add own future picks not traded away
  const tradedAway = tradedPicks
    .filter(p => p.previous_owner_id === myRoster.roster_id ||
                 p.previous_owner_id === myRoster.roster_id.toString())
    .map(p => `${p.season}_${p.round}`);

  years.forEach(yr => {
    [1,2,3,4].forEach(rd => {
      const key = `${yr}_${rd}`;
      if (!tradedAway.includes(key)) {
        myPicks.push({ season: yr, round: rd, roster_id: myRoster.roster_id, own: true });
      }
    });
  });

  return myPicks;
}

// ── PICK VALUE ESTIMATE ──────────────────────────────────────
function estimatePickValue(season, round, teamStrength) {
  const currentYear = new Date().getFullYear();
  const yearsOut = parseInt(season) - currentYear;
  // Base values by round
  const baseValues = { 1: 3500, 2: 1800, 3: 900, 4: 400 };
  let val = baseValues[round] || 300;
  // Adjust for years out
  val = val * Math.pow(0.85, yearsOut);
  // Adjust for team strength (higher strength = later pick = less value for round 1)
  if (round === 1) {
    const multiplier = 1 + (1 - (teamStrength || 0.5)) * 0.5;
    val = val * multiplier;
  }
  return Math.round(val);
}
