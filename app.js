// ── STATE ────────────────────────────────────────────────────
let state = {
  user: null,
  leagues: [],
  currentLeagueIdx: 0,
  allPlayers: {},
  playerValues: {},
  valueSource: 'ktc',
  mode: 'winnow', // 'winnow' | 'rebuild'
  mySelectedItems: [],
  theirSelectedItems: [],
  currentRosterFilter: 'all',
  currentWaiverFilter: 'all',
};

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.valueSource = btn.dataset.source;
    });
  });

  const savedUser = localStorage.getItem(CACHE_KEY_PREFIX + 'last_user');
  if (savedUser) {
    document.getElementById('usernameInput').value = savedUser;
  }

  document.getElementById('usernameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadUser();
  });
});

// ── LOGIN ────────────────────────────────────────────────────
async function loadUser() {
  const username = document.getElementById('usernameInput').value.trim();
  if (!username) return;

  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');

  showLoading('Lade Benutzerdaten...');

  try {
    const user = await getUser(username);
    if (!user || !user.user_id) throw new Error('Benutzer nicht gefunden');
    state.user = user;
    localStorage.setItem(CACHE_KEY_PREFIX + 'last_user', username);

    showLoading('Lade Ligen...');
    const leagues = await getUserLeagues(user.user_id, '2024');
    const dynastyLeagues = leagues.filter(l =>
      l.settings && (l.settings.type === 2 || l.name.toLowerCase().includes('dynasty'))
    );
    state.leagues = dynastyLeagues.length > 0 ? dynastyLeagues : leagues;

    showLoading('Lade Spielerdaten...');
    state.allPlayers = await getAllPlayers();

    showLoading('Lade Spielerwerte...');
    state.playerValues = await fetchPlayerValues(state.valueSource);

    showLoading('Lade Roster & Picks...');
    for (let lg of state.leagues) {
      lg.rosters = await getLeagueRosters(lg.league_id);
      lg.users = await getLeagueUsers(lg.league_id);
      lg.tradedPicks = await getLeagueDraftPicks(lg.league_id);
    }

    hideLoading();
    initApp();

  } catch(e) {
    hideLoading();
    const msg = e.message || 'Unbekannter Fehler';
    if (msg.includes('Netzwerkfehler') || msg.includes('Failed to fetch')) {
      errEl.innerHTML = '⚠️ Verbindung fehlgeschlagen.<br><small>Die App muss über einen Webserver geöffnet werden – nicht als lokale Datei.<br>Tipp: Lade sie auf <strong>GitHub Pages</strong> hoch oder nutze die <strong>VS Code Live Server</strong> Extension.</small>';
    } else {
      errEl.textContent = '⚠️ ' + msg;
    }
    errEl.classList.remove('hidden');
  }
}

function logout() {
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('appScreen').classList.remove('active');
}

// ── APP INIT ─────────────────────────────────────────────────
function initApp() {
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('appScreen').classList.add('active');

  buildLeagueTabs();
  selectLeague(0);

  document.getElementById('lastUpdated').textContent =
    'Aktualisiert: ' + new Date().toLocaleTimeString('de-DE');
}

function buildLeagueTabs() {
  const tabsEl = document.getElementById('leagueTabs');
  tabsEl.innerHTML = '';
  state.leagues.forEach((lg, i) => {
    const btn = document.createElement('button');
    btn.className = 'league-tab' + (i === 0 ? ' active' : '');
    btn.textContent = lg.name;
    btn.title = lg.name;
    btn.onclick = () => selectLeague(i);
    tabsEl.appendChild(btn);
  });
}

function selectLeague(idx) {
  state.currentLeagueIdx = idx;
  document.querySelectorAll('.league-tab').forEach((b, i) => {
    b.classList.toggle('active', i === idx);
  });
  refreshAllTabs();
}

function getCurrentLeague() {
  return state.leagues[state.currentLeagueIdx];
}

function getMyRoster() {
  const lg = getCurrentLeague();
  if (!lg) return null;
  return lg.rosters.find(r => r.owner_id === state.user.user_id);
}

function getRosterOwnerName(roster, users) {
  const user = users.find(u => u.user_id === roster.owner_id);
  return (user && (user.display_name || user.username)) || 'Unbekannt';
}

// ── MODE ─────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  document.getElementById('modeWinNow').classList.toggle('active', mode === 'winnow');
  document.getElementById('modeRebuild').classList.toggle('active', mode === 'rebuild');
  const badge = document.getElementById('tradeMode');
  if (badge) badge.textContent = mode === 'winnow' ? 'WIN NOW' : 'REBUILD';
  renderTrades();
}

// ── TABS ─────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.getAttribute('onclick').includes("'" + name + "'")) b.classList.add('active');
  });

  if (name === 'overview') renderOverview();
  if (name === 'roster')   renderRoster();
  if (name === 'league')   renderLeague();
  if (name === 'trades')   renderTrades();
  if (name === 'waiver')   renderWaiver();
}

function refreshAllTabs() {
  renderOverview();
  renderRoster();
  renderLeague();
  renderTrades();
  renderWaiver();
}

// ── PLAYER HELPERS ───────────────────────────────────────────
function getPlayer(id) {
  return state.allPlayers[id] || {};
}

function getPlayerValue(playerId) {
  const p = getPlayer(playerId);
  if (state.playerValues[playerId]) return state.playerValues[playerId];
  const nameKey = normalizeName((p.first_name || '') + (p.last_name || ''));
  return state.playerValues[nameKey] || 0;
}

function getPickValue(pick) {
  return estimatePickValue(pick.season, pick.round, 0.5);
}

function getPlayerAge(p) {
  if (!p || !p.birth_date) return null;
  const birth = new Date(p.birth_date);
  const age = Math.floor((new Date() - birth) / (365.25 * 24 * 3600 * 1000));
  return age;
}

function getInjuryLabel(status) {
  if (!status) return '';
  const s = status.toUpperCase();
  if (s === 'QUESTIONABLE') return '<span class="player-injury inj-Q">Q</span>';
  if (s === 'DOUBTFUL') return '<span class="player-injury inj-D">D</span>';
  if (s === 'OUT') return '<span class="player-injury inj-D">OUT</span>';
  if (s === 'IR') return '<span class="player-injury inj-IR">IR</span>';
  if (s === 'PUP') return '<span class="player-injury inj-PUP">PUP</span>';
  return '';
}

function getPositionClass(pos) {
  const map = { QB: 'pos-QB', RB: 'pos-RB', WR: 'pos-WR', TE: 'pos-TE', K: 'pos-K' };
  return map[pos] || 'pos-K';
}

function getBye(teamAbbr) {
  const byes = {
    ARI:14,ATL:12,BAL:14,BUF:12,CAR:11,CHI:7,CIN:12,CLE:10,DAL:7,DEN:14,
    DET:5,GB:6,HOU:14,IND:14,JAX:12,KC:6,LV:10,LAC:5,LAR:6,MIA:10,
    MIN:6,NE:14,NO:12,NYG:11,NYJ:12,PHI:5,PIT:9,SF:9,SEA:10,TB:11,
    TEN:5,WAS:14
  };
  return byes[teamAbbr] || '-';
}

function getRosterValue(roster) {
  if (!roster || !roster.players) return 0;
  return roster.players.reduce((sum, id) => sum + getPlayerValue(id), 0);
}

function getMyPicks(roster, tradedPicks) {
  if (!roster) return [];
  const picks = [];
  const years = ['2025', '2026', '2027'];

  // picks owned via trade
  tradedPicks.forEach(pick => {
    const ownerId = parseInt(pick.owner_id);
    if (ownerId === roster.roster_id) {
      picks.push({ ...pick, own: false });
    }
  });

  // own future picks not traded away
  const tradedAwayKeys = tradedPicks
    .filter(p => parseInt(p.previous_owner_id) === roster.roster_id &&
                 parseInt(p.owner_id) !== roster.roster_id)
    .map(p => `${p.season}_${p.round}`);

  years.forEach(yr => {
    [1,2,3,4].forEach(rd => {
      const key = `${yr}_${rd}`;
      if (!tradedAwayKeys.includes(key)) {
        picks.push({ season: yr, round: rd, roster_id: roster.roster_id, own: true });
      }
    });
  });

  return picks;
}

function gradeFromPercentile(pct) {
  if (pct >= 0.8) return 'A';
  if (pct >= 0.6) return 'B';
  if (pct >= 0.4) return 'C';
  if (pct >= 0.2) return 'D';
  return 'F';
}

// ── OVERVIEW ─────────────────────────────────────────────────
function renderOverview() {
  const lg = getCurrentLeague();
  if (!lg) return;

  const myRoster = getMyRoster();
  if (!myRoster) return;

  // Compute values for all rosters
  const rosterValues = lg.rosters.map(r => ({ id: r.roster_id, val: getRosterValue(r) }));
  rosterValues.sort((a, b) => b.val - a.val);
  const myVal = getRosterValue(myRoster);
  const myRank = rosterValues.findIndex(r => r.id === myRoster.roster_id) + 1;

  // Age stats
  const ages = (myRoster.players || [])
    .map(id => getPlayerAge(getPlayer(id)))
    .filter(a => a && a >= 20 && a <= 40);
  const avgAge = ages.length ? (ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1) : '–';

  // Position counts
  const players = (myRoster.players || []).map(id => ({ ...getPlayer(id), id }));
  const posCount = { QB: 0, RB: 0, WR: 0, TE: 0 };
  players.forEach(p => { if (posCount[p.position] !== undefined) posCount[p.position]++; });

  // Stats cards
  const statsEl = document.getElementById('overviewStats');
  statsEl.innerHTML = `
    <div class="stat-card" style="--accent-color: var(--accent)">
      <div class="stat-label">Liga-Rang</div>
      <div class="stat-value">#${myRank}</div>
      <div class="stat-sub">von ${lg.rosters.length} Teams</div>
    </div>
    <div class="stat-card" style="--accent-color: var(--green)">
      <div class="stat-label">Roster-Wert</div>
      <div class="stat-value" style="font-size:26px">${Math.round(myVal/1000)}K</div>
      <div class="stat-sub">KTC Gesamtwert</div>
    </div>
    <div class="stat-card" style="--accent-color: var(--yellow)">
      <div class="stat-label">Ø Alter</div>
      <div class="stat-value">${avgAge}</div>
      <div class="stat-sub">Jahre</div>
    </div>
    <div class="stat-card" style="--accent-color: var(--orange)">
      <div class="stat-label">QB / RB</div>
      <div class="stat-value" style="font-size:26px">${posCount.QB}/${posCount.RB}</div>
      <div class="stat-sub">auf dem Roster</div>
    </div>
    <div class="stat-card" style="--accent-color: var(--accent)">
      <div class="stat-label">WR / TE</div>
      <div class="stat-value" style="font-size:26px">${posCount.WR}/${posCount.TE}</div>
      <div class="stat-sub">auf dem Roster</div>
    </div>
    <div class="stat-card" style="--accent-color: var(--text2)">
      <div class="stat-label">Spieler total</div>
      <div class="stat-value">${(myRoster.players || []).length}</div>
      <div class="stat-sub">im Kader</div>
    </div>
  `;

  // Charts
  renderAgeChart(myRoster);
  renderPosChart(myRoster);
  renderRankChart(lg, rosterValues);
}

function renderAgeChart(roster) {
  const ctx = document.getElementById('ageChart');
  if (!ctx) return;
  const buckets = { '20-22': 0, '23-25': 0, '26-28': 0, '29-31': 0, '32+': 0 };
  (roster.players || []).forEach(id => {
    const age = getPlayerAge(getPlayer(id));
    if (!age) return;
    if (age <= 22) buckets['20-22']++;
    else if (age <= 25) buckets['23-25']++;
    else if (age <= 28) buckets['26-28']++;
    else if (age <= 31) buckets['29-31']++;
    else buckets['32+']++;
  });

  if (ctx._chart) ctx._chart.destroy();
  ctx._chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Object.keys(buckets),
      datasets: [{
        data: Object.values(buckets),
        backgroundColor: ['#00e5ff','#00c8e0','#00aabe','#007f8f','#004a54'],
        borderRadius: 6,
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8a9bb5' }, grid: { color: '#1e2a38' } },
        y: { ticks: { color: '#8a9bb5', stepSize: 1 }, grid: { color: '#1e2a38' } }
      }
    }
  });
}

function renderPosChart(roster) {
  const ctx = document.getElementById('posChart');
  if (!ctx) return;
  const pos = { QB: 0, RB: 0, WR: 0, TE: 0 };
  (roster.players || []).forEach(id => {
    const p = getPlayer(id);
    if (pos[p.position] !== undefined) pos[p.position]++;
  });

  if (ctx._chart) ctx._chart.destroy();
  ctx._chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(pos),
      datasets: [{
        data: Object.values(pos),
        backgroundColor: ['#ff6d00','#00e676','#00e5ff','#ffd600'],
        borderColor: '#0f1218', borderWidth: 3,
      }]
    },
    options: {
      plugins: {
        legend: { labels: { color: '#8a9bb5', font: { size: 12 } } }
      }
    }
  });
}

function renderRankChart(lg, rosterValues) {
  const ctx = document.getElementById('rankChart');
  if (!ctx) return;

  const myRosterId = getMyRoster()?.roster_id;
  const labels = rosterValues.map((rv, i) => {
    const roster = lg.rosters.find(r => r.id === rv.id || r.roster_id === rv.id);
    if (!roster) return `Team ${i+1}`;
    const user = lg.users.find(u => u.user_id === roster.owner_id);
    return (user && (user.display_name || user.username)) || `Team ${i+1}`;
  });

  const bgColors = rosterValues.map(rv =>
    rv.id === myRosterId ? '#00e5ff' : '#1c2330'
  );
  const borderColors = rosterValues.map(rv =>
    rv.id === myRosterId ? '#00e5ff' : '#263040'
  );

  if (ctx._chart) ctx._chart.destroy();
  ctx._chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: rosterValues.map(r => r.val),
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8a9bb5', callback: v => Math.round(v/1000)+'K' }, grid: { color: '#1e2a38' } },
        y: { ticks: { color: '#8a9bb5', font: { size: 11 } }, grid: { display: false } }
      }
    }
  });
}

// ── ROSTER ───────────────────────────────────────────────────
function renderRoster(filter) {
  if (filter !== undefined) state.currentRosterFilter = filter;
  const lg = getCurrentLeague();
  const myRoster = getMyRoster();
  if (!myRoster) return;

  const grid = document.getElementById('rosterGrid');
  const picks = getMyPicks(myRoster, lg.tradedPicks);

  let items = [];

  // Players
  (myRoster.players || []).forEach(id => {
    const p = getPlayer(id);
    items.push({ type: 'player', id, player: p, value: getPlayerValue(id) });
  });

  // Picks
  picks.forEach(pick => {
    items.push({ type: 'pick', pick, value: getPickValue(pick) });
  });

  // Sort by value desc
  items.sort((a, b) => b.value - a.value);

  // Filter
  const f = state.currentRosterFilter;
  if (f !== 'all') {
    if (f === 'PICK') items = items.filter(i => i.type === 'pick');
    else items = items.filter(i => i.type === 'player' && i.player.position === f);
  }

  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state">Keine Spieler gefunden</div>';
    return;
  }

  grid.innerHTML = items.map(item => {
    if (item.type === 'player') {
      const p = item.player;
      const age = getPlayerAge(p);
      const inj = getInjuryLabel(p.injury_status);
      const byeWeek = getBye(p.team);
      return `
        <div class="player-card" onclick="showPlayerModal('${item.id}')">
          <span class="player-pos ${getPositionClass(p.position)}">${p.position || '?'}</span>
          <div class="player-name">${p.first_name || ''} ${p.last_name || ''}</div>
          <div class="player-meta">${p.team || 'FA'} · ${age ? age + ' J.' : ''} · Bye: ${byeWeek}</div>
          <div class="player-value-row">
            <span class="player-ktc">${item.value || '–'}</span>
            ${inj}
          </div>
        </div>`;
    } else {
      const pick = item.pick;
      const roundNames = { 1: '1. Runde', 2: '2. Runde', 3: '3. Runde', 4: '4. Runde' };
      return `
        <div class="player-card">
          <span class="player-pos pos-PICK">PICK</span>
          <div class="player-name">${pick.season} ${roundNames[pick.round] || pick.round + '. Rd'}</div>
          <div class="player-meta">${pick.own ? 'Eigener Pick' : 'Tausch-Pick'}</div>
          <div class="player-value-row">
            <span class="player-ktc">~${item.value}</span>
          </div>
        </div>`;
    }
  }).join('');
}

function filterRoster(pos) {
  state.currentRosterFilter = pos;
  document.querySelectorAll('#tab-roster .filter-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick').includes("'" + pos + "'"));
  });
  renderRoster();
}

// ── LEAGUE ───────────────────────────────────────────────────
function renderLeague() {
  const lg = getCurrentLeague();
  if (!lg) return;

  const rosterValues = lg.rosters.map(r => {
    const user = lg.users.find(u => u.user_id === r.owner_id);
    const name = (user && (user.display_name || user.username)) || 'Unbekannt';
    const val = getRosterValue(r);
    const picks = getMyPicks(r, lg.tradedPicks);
    const pickVal = picks.reduce((s, p) => s + getPickValue(p), 0);
    const pos = { QB: 0, RB: 0, WR: 0, TE: 0 };
    (r.players || []).forEach(id => {
      const p = getPlayer(id);
      if (pos[p.position] !== undefined) pos[p.position] += getPlayerValue(id);
    });
    return { roster: r, name, val, pickVal, pos };
  });

  rosterValues.sort((a, b) => b.val - a.val);
  const maxVal = rosterValues[0]?.val || 1;

  // Per-position league max for grading
  const posMaxes = { QB: 0, RB: 0, WR: 0, TE: 0 };
  rosterValues.forEach(rv => {
    Object.keys(posMaxes).forEach(pos => {
      if (rv.pos[pos] > posMaxes[pos]) posMaxes[pos] = rv.pos[pos];
    });
  });

  const tableEl = document.getElementById('leagueTable');
  tableEl.innerHTML = `
    <table class="league-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>Roster-Wert</th>
          <th>QB</th><th>RB</th><th>WR</th><th>TE</th>
        </tr>
      </thead>
      <tbody>
        ${rosterValues.map((rv, i) => {
          const isMe = rv.roster.owner_id === state.user.user_id;
          const grades = {};
          Object.keys(posMaxes).forEach(pos => {
            const pct = posMaxes[pos] > 0 ? rv.pos[pos] / posMaxes[pos] : 0;
            grades[pos] = gradeFromPercentile(pct);
          });
          return `
            <tr class="rank-${i+1} ${isMe ? 'my-team' : ''}"
                onclick="showTeamDetail(${rv.roster.roster_id})">
              <td><span class="rank-num">${i+1}</span></td>
              <td>${rv.name}${isMe ? '<span class="badge-my-team">ICH</span>' : ''}</td>
              <td>
                <div class="strength-bar-wrap">
                  <div class="strength-bar">
                    <div class="strength-fill" style="width:${Math.round(rv.val/maxVal*100)}%"></div>
                  </div>
                  <span style="font-size:12px;color:var(--text2);min-width:48px">${Math.round(rv.val/1000)}K</span>
                </div>
              </td>
              ${['QB','RB','WR','TE'].map(pos =>
                `<td><span class="pos-grade grade-${grades[pos]}">${grades[pos]}</span></td>`
              ).join('')}
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function showTeamDetail(rosterId) {
  const lg = getCurrentLeague();
  const roster = lg.rosters.find(r => r.roster_id === rosterId);
  if (!roster) return;

  const user = lg.users.find(u => u.user_id === roster.owner_id);
  const name = (user && (user.display_name || user.username)) || 'Unbekannt';
  const isMe = roster.owner_id === state.user.user_id;

  const players = (roster.players || [])
    .map(id => ({ id, p: getPlayer(id), val: getPlayerValue(id) }))
    .sort((a, b) => b.val - a.val)
    .slice(0, 10);

  const detailEl = document.getElementById('teamDetail');
  detailEl.classList.remove('hidden');
  detailEl.innerHTML = `
    <h3>${name}${isMe ? ' <span class="badge-my-team">ICH</span>' : ''}</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
      ${players.map(({id, p, val}) => `
        <div class="player-card" onclick="showPlayerModal('${id}')">
          <span class="player-pos ${getPositionClass(p.position)}">${p.position || '?'}</span>
          <div class="player-name">${p.first_name || ''} ${p.last_name || ''}</div>
          <div class="player-meta">${p.team || 'FA'}</div>
          <div class="player-value-row">
            <span class="player-ktc">${val || '–'}</span>
          </div>
        </div>`).join('')}
    </div>
    <button onclick="document.getElementById('teamDetail').classList.add('hidden')"
      style="margin-top:16px;background:transparent;border:1px solid var(--border2);color:var(--text2);padding:8px 16px;border-radius:6px;cursor:pointer;font-size:12px">
      ✕ Schließen
    </button>`;

  detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── TRADES ───────────────────────────────────────────────────
function renderTrades() {
  const lg = getCurrentLeague();
  const myRoster = getMyRoster();
  if (!myRoster || !lg) return;

  const tradesEl = document.getElementById('tradesList');
  const isWinNow = state.mode === 'winnow';

  // Analyse my roster needs
  const myPlayers = (myRoster.players || []).map(id => ({ id, p: getPlayer(id), val: getPlayerValue(id) }));
  const myPosByValue = { QB: [], RB: [], WR: [], TE: [] };
  myPlayers.forEach(item => {
    if (myPosByValue[item.p.position]) myPosByValue[item.p.position].push(item);
  });
  Object.keys(myPosByValue).forEach(pos => myPosByValue[pos].sort((a,b) => b.val - a.val));

  // Weakness: position where my total value is lowest relative to league avg
  const allPosAvg = { QB: 0, RB: 0, WR: 0, TE: 0 };
  const posCount = { QB: 0, RB: 0, WR: 0, TE: 0 };
  lg.rosters.forEach(r => {
    (r.players || []).forEach(id => {
      const p = getPlayer(id);
      if (allPosAvg[p.position] !== undefined) {
        allPosAvg[p.position] += getPlayerValue(id);
        posCount[p.position]++;
      }
    });
  });
  Object.keys(allPosAvg).forEach(pos => { if (posCount[pos]) allPosAvg[pos] /= posCount[pos]; });

  // My surplus positions (can sell)
  const myPosTotal = {};
  Object.keys(myPosByValue).forEach(pos => {
    myPosTotal[pos] = myPosByValue[pos].reduce((s,i) => s+i.val, 0);
  });

  // For win-now: sell young depth, get proven starters
  // For rebuild: sell old players, get picks + youth
  const trades = [];

  lg.rosters.forEach(r => {
    if (r.owner_id === state.user.user_id) return;
    const user = lg.users.find(u => u.user_id === r.owner_id);
    const partnerName = (user && (user.display_name || user.username)) || 'Unbekannt';

    const theirPlayers = (r.players || [])
      .map(id => ({ id, p: getPlayer(id), val: getPlayerValue(id) }))
      .sort((a,b) => b.val - a.val);

    const theirPosByValue = { QB: [], RB: [], WR: [], TE: [] };
    theirPlayers.forEach(item => {
      if (theirPosByValue[item.p.position]) theirPosByValue[item.p.position].push(item);
    });

    // Find trade opportunity
    let bestGive = null, bestGet = null, reason = '';

    if (isWinNow) {
      // Find position where they're stronger and I'm weak
      let bestDiff = 0;
      Object.keys(myPosTotal).forEach(pos => {
        const theirTotal = theirPosByValue[pos].reduce((s,i) => s+i.val, 0);
        const diff = theirTotal - myPosTotal[pos];
        if (diff > bestDiff && theirPosByValue[pos].length > 2) {
          bestDiff = diff;
          // They give their depth, I give my surplus
          const surplusPos = Object.keys(myPosTotal).sort((a,b) => myPosTotal[b]-myPosTotal[a])[0];
          const giveCandidate = myPosByValue[surplusPos]?.slice(1,3);
          const getCandidate = theirPosByValue[pos]?.slice(0,2);
          if (giveCandidate?.length && getCandidate?.length) {
            bestGive = giveCandidate;
            bestGet = getCandidate;
            reason = `Verbessert deine ${pos}-Situation`;
          }
        }
      });
    } else {
      // Rebuild: sell aging stars, get picks
      const myStars = myPlayers.filter(i => {
        const age = getPlayerAge(i.p);
        return age && age >= 28 && i.val > 2000;
      }).slice(0,2);

      const theirPicks = getMyPicks(r, lg.tradedPicks).filter(p => p.season >= '2025');

      if (myStars.length > 0 && theirPicks.length > 0) {
        bestGive = myStars.slice(0,1);
        bestGet = null;
        reason = 'Tausch gegen Future Picks (Rebuild)';
        trades.push({
          partner: partnerName,
          give: bestGive.map(i => `${i.p.first_name} ${i.p.last_name} (${i.val})`),
          get: theirPicks.slice(0,2).map(p => `${p.season} ${p.round}. Runde (~${getPickValue(p)})`),
          giveVal: bestGive.reduce((s,i) => s+i.val, 0),
          getVal: theirPicks.slice(0,2).reduce((s,p) => s+getPickValue(p), 0),
          reason,
          badge: 'fair'
        });
        return;
      }
    }

    if (bestGive && bestGet) {
      const giveVal = bestGive.reduce((s,i) => s+i.val, 0);
      const getVal = bestGet.reduce((s,i) => s+i.val, 0);
      const diff = getVal - giveVal;
      let badge = diff > 500 ? 'good' : diff < -300 ? 'upgrade' : 'fair';

      trades.push({
        partner: partnerName,
        give: bestGive.map(i => `${i.p.first_name} ${i.p.last_name} (${i.val})`),
        get: bestGet.map(i => `${i.p.first_name} ${i.p.last_name} (${i.val})`),
        giveVal, getVal, diff, reason, badge
      });
    }
  });

  if (trades.length === 0) {
    tradesEl.innerHTML = '<div class="empty-state">Keine Trade-Vorschläge gefunden. Spielerwerte werden benötigt.</div>';
    return;
  }

  trades.sort((a,b) => (b.getVal - b.giveVal) - (a.getVal - a.giveVal));

  tradesEl.innerHTML = trades.slice(0, 8).map(t => {
    const diff = t.getVal - t.giveVal;
    const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff >= 0 ? 'diff-pos' : 'diff-neg';
    const badgeLabels = { good: '✓ GEWINN', fair: '⟺ FAIR', upgrade: '↑ UPGRADE' };
    return `
      <div class="trade-card">
        <div class="trade-card-header">
          <span class="trade-partner">Trade mit ${t.partner}</span>
          <span class="trade-badge badge-${t.badge}">${badgeLabels[t.badge]}</span>
        </div>
        <div class="trade-sides">
          <div class="trade-give">
            <strong style="font-size:11px;letter-spacing:2px;color:var(--text3);text-transform:uppercase">Du gibst ab</strong>
            ${t.give.map(s => `<span>${s}</span>`).join('')}
          </div>
          <div class="trade-arrow">⇄</div>
          <div class="trade-get">
            <strong style="font-size:11px;letter-spacing:2px;color:var(--text3);text-transform:uppercase">Du bekommst</strong>
            ${t.get.map(s => `<span>${s}</span>`).join('')}
          </div>
        </div>
        <div class="trade-value-row">
          <span class="value-give">Abgabe: ${t.giveVal}</span>
          <span class="value-diff ${diffClass}">${diffStr} Punkte</span>
          <span class="value-get">Erhalt: ${t.getVal}</span>
        </div>
        <div style="font-size:12px;color:var(--text3);margin-top:8px">💡 ${t.reason}</div>
      </div>`;
  }).join('');
}

// ── TRADE CHECK ──────────────────────────────────────────────
function searchPlayers(side, query) {
  const dropEl = document.getElementById(side === 'my' ? 'myDropdown' : 'theirDropdown');
  if (!query || query.length < 2) { dropEl.classList.add('hidden'); return; }

  const q = query.toLowerCase();
  const lg = getCurrentLeague();
  const myRoster = getMyRoster();

  // All players with values
  let pool = [];

  if (side === 'my') {
    // My roster players
    (myRoster?.players || []).forEach(id => {
      const p = getPlayer(id);
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      if (name.toLowerCase().includes(q)) {
        pool.push({ label: name, val: getPlayerValue(id), id, type: 'player' });
      }
    });
    // My picks
    const myPicks = getMyPicks(myRoster, lg.tradedPicks);
    myPicks.forEach((pick, i) => {
      const label = `${pick.season} ${pick.round}. Runde Pick`;
      if (label.toLowerCase().includes(q)) {
        pool.push({ label, val: getPickValue(pick), id: 'pick_' + i, type: 'pick', pick });
      }
    });
  } else {
    // All players in all rosters
    lg.rosters.forEach(r => {
      (r.players || []).forEach(id => {
        const p = getPlayer(id);
        const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
        if (name.toLowerCase().includes(q)) {
          pool.push({ label: name, val: getPlayerValue(id), id, type: 'player' });
        }
      });
      const picks = getMyPicks(r, lg.tradedPicks);
      picks.forEach((pick, i) => {
        const label = `${pick.season} ${pick.round}. Runde Pick`;
        if (label.toLowerCase().includes(q)) {
          pool.push({ label, val: getPickValue(pick), id: 'pick_r' + r.roster_id + '_' + i, type: 'pick', pick });
        }
      });
    });
  }

  pool = pool.slice(0, 12);

  if (pool.length === 0) { dropEl.innerHTML = '<div class="dropdown-item"><span class="item-name" style="color:var(--text3)">Keine Ergebnisse</span></div>'; dropEl.classList.remove('hidden'); return; }

  dropEl.innerHTML = pool.map(item => `
    <div class="dropdown-item" onclick="addItem('${side}', '${item.id}', '${item.label.replace(/'/g,"\\'")}', ${item.val})">
      <span class="item-name">${item.label}</span>
      <span class="item-ktc">${item.val || '–'}</span>
    </div>`).join('');
  dropEl.classList.remove('hidden');
}

function addItem(side, id, label, val) {
  const arr = side === 'my' ? state.mySelectedItems : state.theirSelectedItems;
  if (arr.find(i => i.id === id)) return;
  arr.push({ id, label, val: parseInt(val) || 0 });

  const dropEl = document.getElementById(side === 'my' ? 'myDropdown' : 'theirDropdown');
  const inputEl = document.getElementById(side === 'my' ? 'mySearch' : 'theirSearch');
  dropEl.classList.add('hidden');
  inputEl.value = '';

  renderSelectedItems(side);
}

function removeItem(side, id) {
  if (side === 'my') state.mySelectedItems = state.mySelectedItems.filter(i => i.id !== id);
  else state.theirSelectedItems = state.theirSelectedItems.filter(i => i.id !== id);
  renderSelectedItems(side);
}

function renderSelectedItems(side) {
  const arr = side === 'my' ? state.mySelectedItems : state.theirSelectedItems;
  const el = document.getElementById(side === 'my' ? 'mySelected' : 'theirSelected');
  el.innerHTML = arr.map(item => `
    <div class="selected-chip">
      <span class="chip-name">${item.label}</span>
      <span class="chip-val">${item.val || '–'}</span>
      <button class="chip-remove" onclick="removeItem('${side}', '${item.id}')">✕</button>
    </div>`).join('') || '<div style="color:var(--text3);font-size:12px;padding:8px 0">Spieler suchen...</div>';
}

function evaluateTrade() {
  const myItems = state.mySelectedItems;
  const theirItems = state.theirSelectedItems;

  if (myItems.length === 0 || theirItems.length === 0) {
    document.getElementById('tradeResult').innerHTML =
      '<div class="empty-state">Bitte auf beiden Seiten Spieler/Picks auswählen</div>';
    document.getElementById('tradeResult').classList.remove('hidden');
    return;
  }

  const myVal = myItems.reduce((s,i) => s + i.val, 0);
  const theirVal = theirItems.reduce((s,i) => s + i.val, 0);
  const diff = theirVal - myVal;
  const pct = myVal > 0 ? diff / myVal : 0;

  let verdict, verdictClass, verdictEmoji;
  if (pct > 0.1) { verdict = 'GUTER TRADE FÜR DICH'; verdictClass = 'verdict-good'; verdictEmoji = '✅'; }
  else if (pct < -0.1) { verdict = 'UNGÜNSTIG FÜR DICH'; verdictClass = 'verdict-bad'; verdictEmoji = '❌'; }
  else { verdict = 'FAIRER TRADE'; verdictClass = 'verdict-fair'; verdictEmoji = '⚖️'; }

  const diffStr = diff >= 0 ? `+${diff}` : `${diff}`;

  document.getElementById('tradeResult').innerHTML = `
    <div class="result-verdict ${verdictClass}">${verdictEmoji} ${verdict}</div>
    <div class="result-breakdown">
      <div class="result-col">
        <div class="result-col-label">Du gibst ab</div>
        <div class="result-col-val" style="color:var(--red)">${myVal}</div>
      </div>
      <div class="result-col">
        <div class="result-col-label">Differenz</div>
        <div class="result-col-val ${diff >= 0 ? 'diff-pos' : 'diff-neg'}">${diffStr}</div>
      </div>
      <div class="result-col">
        <div class="result-col-label">Du bekommst</div>
        <div class="result-col-val" style="color:var(--green)">${theirVal}</div>
      </div>
    </div>`;
  document.getElementById('tradeResult').classList.remove('hidden');
}

// ── WAIVER ───────────────────────────────────────────────────
function renderWaiver(filter) {
  if (filter !== undefined) state.currentWaiverFilter = filter;
  const lg = getCurrentLeague();
  if (!lg) return;

  // Build set of all rostered player IDs
  const rostered = new Set();
  lg.rosters.forEach(r => (r.players || []).forEach(id => rostered.add(id)));

  // Find free agents with values
  const freeAgents = Object.keys(state.allPlayers)
    .filter(id => !rostered.has(id))
    .map(id => {
      const p = state.allPlayers[id];
      const val = getPlayerValue(id);
      return { id, p, val };
    })
    .filter(item => item.val > 0 && item.p.position && ['QB','RB','WR','TE'].includes(item.p.position))
    .sort((a,b) => b.val - a.val);

  const f = state.currentWaiverFilter;
  const filtered = f === 'all' ? freeAgents : freeAgents.filter(i => i.p.position === f);

  const listEl = document.getElementById('waiverList');
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Keine freien Spieler gefunden</div>';
    return;
  }

  listEl.innerHTML = filtered.slice(0, 30).map((item, i) => {
    const p = item.p;
    const age = getPlayerAge(p);
    const inj = getInjuryLabel(p.injury_status);
    return `
      <div class="waiver-item" onclick="showPlayerModal('${item.id}')">
        <div class="waiver-rank">${i+1}</div>
        <div>
          <div class="waiver-name">
            <span class="player-pos ${getPositionClass(p.position)}" style="font-size:10px;padding:2px 6px">${p.position}</span>
            ${p.first_name || ''} ${p.last_name || ''} ${inj}
          </div>
          <div class="waiver-meta">${p.team || 'FA'} · Bye: ${getBye(p.team)}</div>
        </div>
        <div class="waiver-ktc">${item.val}</div>
        <div class="waiver-age">${age ? age + ' J.' : '–'}</div>
      </div>`;
  }).join('');
}

function filterWaiver(pos) {
  state.currentWaiverFilter = pos;
  document.querySelectorAll('#tab-waiver .filter-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick').includes("'" + pos + "'"));
  });
  renderWaiver();
}

// ── PLAYER MODAL ─────────────────────────────────────────────
function showPlayerModal(playerId) {
  const p = getPlayer(playerId);
  if (!p || !p.last_name) return;

  const val = getPlayerValue(playerId);
  const age = getPlayerAge(p);
  const byeWeek = getBye(p.team);
  const inj = p.injury_status || 'Gesund';

  document.getElementById('modalContent').innerHTML = `
    <button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-player-header">
      <div class="modal-pos-badge ${getPositionClass(p.position)}"
           style="background: var(--bg4); border: 2px solid currentColor;">
        ${p.position || '?'}
      </div>
      <div>
        <div class="modal-name">${p.first_name || ''} ${p.last_name || ''}</div>
        <div class="modal-meta">${p.team || 'Free Agent'} · ${p.position || ''}</div>
      </div>
    </div>
    <div class="modal-stats">
      <div class="modal-stat">
        <div class="modal-stat-label">KTC Wert</div>
        <div class="modal-stat-val">${val || '–'}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Alter</div>
        <div class="modal-stat-val">${age ? age + ' J.' : '–'}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Bye-Week</div>
        <div class="modal-stat-val">${byeWeek}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Status</div>
        <div class="modal-stat-val" style="font-size:16px;color:${inj==='Gesund'?'var(--green)':'var(--yellow)'}">${inj}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">College</div>
        <div class="modal-stat-val" style="font-size:16px">${p.college || '–'}</div>
      </div>
      <div class="modal-stat">
        <div class="modal-stat-label">Erfahrung</div>
        <div class="modal-stat-val" style="font-size:16px">${p.years_exp != null ? p.years_exp + ' J.' : '–'}</div>
      </div>
    </div>`;

  document.getElementById('playerModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('playerModal').classList.add('hidden');
}

// ── LOADING ──────────────────────────────────────────────────
function showLoading(msg) {
  document.getElementById('loadingMsg').textContent = msg || 'Laden...';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

// Close dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) {
    document.querySelectorAll('.search-dropdown').forEach(d => d.classList.add('hidden'));
  }
});
