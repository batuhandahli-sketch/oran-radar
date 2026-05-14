const state = {
  analyses: [],
  iddaaCodeGroups: [],
  oddsTotalGroups: [],
  filtered: [],
  activeView: localStorage.getItem("oran-radar-view") || "code",
  selectedId: null,
  sport: "1",
  loading: false,
  autoTimer: null,
  lastResult: null,
  requestSeq: 0,
  controller: null
};

const els = {
  connectionStatus: document.querySelector("#connectionStatus .status-text"),
  themeOptions: document.querySelectorAll(".theme-option"),
  dateInput: document.querySelector("#dateInput"),
  daysInput: document.querySelector("#daysInput"),
  toleranceInput: document.querySelector("#toleranceInput"),
  toleranceLabel: document.querySelector("#toleranceLabel"),
  sameLeagueInput: document.querySelector("#sameLeagueInput"),
  autoRefreshInput: document.querySelector("#autoRefreshInput"),
  refreshButton: document.querySelector("#refreshButton"),
  viewTabs: document.querySelectorAll(".view-tab"),
  viewPanels: document.querySelectorAll("[data-view-panel]"),
  searchInput: document.querySelector("#searchInput"),
  matchList: document.querySelector("#matchList"),
  matchCountLabel: document.querySelector("#matchCountLabel"),
  metricMatches: document.querySelector("#metricMatches"),
  metricOdds: document.querySelector("#metricOdds"),
  metricHistory: document.querySelector("#metricHistory"),
  metricCodeGroups: document.querySelector("#metricCodeGroups"),
  metricOddsTotalGroups: document.querySelector("#metricOddsTotalGroups"),
  metricUpdated: document.querySelector("#metricUpdated"),
  codeGroupsLabel: document.querySelector("#codeGroupsLabel"),
  codeGroups: document.querySelector("#codeGroups"),
  oddsTotalGroupsLabel: document.querySelector("#oddsTotalGroupsLabel"),
  oddsTotalGroups: document.querySelector("#oddsTotalGroups"),
  emptyState: document.querySelector("#emptyState"),
  analysisContent: document.querySelector("#analysisContent"),
  selectedLeague: document.querySelector("#selectedLeague"),
  selectedTitle: document.querySelector("#selectedTitle"),
  selectedMeta: document.querySelector("#selectedMeta"),
  signalConfidence: document.querySelector("#signalConfidence"),
  signalText: document.querySelector("#signalText"),
  oddsStrip: document.querySelector("#oddsStrip"),
  sampleBadge: document.querySelector("#sampleBadge"),
  outcomeBars: document.querySelector("#outcomeBars"),
  goalBadge: document.querySelector("#goalBadge"),
  goalBars: document.querySelector("#goalBars"),
  closestBadge: document.querySelector("#closestBadge"),
  similarTable: document.querySelector("#similarTable"),
  loadingBar: document.querySelector("#loadingBar .loading-progress")
};

// --- Utilities ---

function toInputDate(dmy) {
  const [day, month, year] = dmy.split("/");
  return `${year}-${month}-${day}`;
}

function fromInputDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatPercent(value) {
  return value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

function formatOdd(value) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(2);
}

function formatOddsTotal(match) {
  const odds = match?.odds || {};
  const values = [odds.one, odds.draw, odds.two];
  if (values.some((v) => v === null || v === undefined)) return "-";
  return values.reduce((acc, v) => acc + Number(v), 0).toFixed(2);
}

function matchMinute(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!match) return Number.POSITIVE_INFINITY;
  return Number(match[1]) * 60 + Number(match[2]);
}

function matchSortValue(target) {
  return matchMinute(target.time);
}

function compareByMatchTime(left, right) {
  const timeDiff = matchSortValue(left.target) - matchSortValue(right.target);
  if (timeDiff !== 0) return timeDiff;
  return `${left.target.home} ${left.target.away}`.localeCompare(
    `${right.target.home} ${right.target.away}`,
    "tr-TR"
  );
}

// --- Logic ---

function setStatus(text, mode = "online") {
  const pill = document.querySelector("#connectionStatus");
  pill.style.color = mode === "error" ? "var(--danger)" : "var(--primary)";
  els.connectionStatus.textContent = text;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("oran-radar-theme", theme);
  els.themeOptions.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

function setLoading(active) {
  state.loading = active;
  document.body.classList.toggle("loading", active);
  if (active) {
    els.loadingBar.style.width = "30%";
  } else {
    els.loadingBar.style.width = "100%";
    setTimeout(() => { els.loadingBar.style.width = "0"; }, 500);
  }
}

function setActiveView(view) {
  state.activeView = view;
  localStorage.setItem("oran-radar-view", view);
  els.viewTabs.forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  els.viewPanels.forEach(panel => panel.classList.toggle("hidden", panel.dataset.viewPanel !== view));
}

async function loadAnalysis(refresh = false) {
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  
  setLoading(true);
  setStatus("Güncelleniyor...");
  
  const params = new URLSearchParams({
    date: fromInputDate(els.dateInput.value),
    days: els.daysInput.value,
    tolerance: els.toleranceInput.value,
    sport: state.sport,
    sameLeague: els.sameLeagueInput.checked ? "1" : "0",
    refresh: refresh ? "1" : "0"
  });

  try {
    const res = await fetch(`/api/analyze?${params}`, { signal: state.controller.signal });
    const data = await res.json();
    
    if (!data.ok) throw new Error(data.error);
    
    state.lastResult = data;
    // Strictly chronological sort
    state.analyses = (data.analyses || []).slice().sort(compareByMatchTime);
    state.iddaaCodeGroups = data.iddaaCodeGroups || [];
    state.oddsTotalGroups = data.oddsTotalGroups || [];
    
    // Select first match if nothing selected
    if (!state.selectedId && state.analyses.length) {
      state.selectedId = state.analyses[0].target.id;
    }

    renderAll();
    setStatus("Canlı");
  } catch (err) {
    if (err.name !== 'AbortError') {
      setStatus(err.message, "error");
      console.error(err);
    }
  } finally {
    setLoading(false);
  }
}

// --- Renderers ---

function renderAll() {
  renderMetrics();
  renderCodeGroups();
  renderOddsTotalGroups();
  renderMatchList();
  renderSelected();
  if (window.lucide) window.lucide.createIcons();
}

function renderMetrics() {
  const cov = state.lastResult?.coverage || {};
  els.metricMatches.textContent = cov.targetMatches || "-";
  els.metricOdds.textContent = cov.targetOddsMatches || "-";
  els.metricHistory.textContent = cov.historyOddsFinished || "-";
  els.metricCodeGroups.textContent = cov.iddaaCodeGroups || "-";
  els.metricOddsTotalGroups.textContent = cov.oddsTotalGroups || "-";
  els.metricUpdated.textContent = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function renderMatchList() {
  const query = els.searchInput.value.toLowerCase();
  state.filtered = state.analyses.filter(a => {
    const hay = `${a.target.home} ${a.target.away} ${a.target.league.name}`.toLowerCase();
    return hay.includes(query);
  });

  els.matchCountLabel.textContent = `${state.filtered.length} Maç`;
  els.matchList.innerHTML = state.filtered.map(a => `
    <button class="match-item ${a.target.id === state.selectedId ? 'active' : ''}" data-id="${a.target.id}">
      <div class="match-item-top">
        <div class="match-item-teams">${a.target.home} - ${a.target.away}</div>
        <div class="match-item-meta">${a.target.time}</div>
      </div>
      <div class="match-item-bottom">
        <div class="mini-odds">
          <span class="mini-odd">${formatOdd(a.target.odds.one)}</span>
          <span class="mini-odd">${formatOdd(a.target.odds.draw)}</span>
          <span class="mini-odd">${formatOdd(a.target.odds.two)}</span>
        </div>
        <div class="match-item-meta">${a.summary.count} örnek</div>
      </div>
    </button>
  `).join("");

  els.matchList.querySelectorAll(".match-item").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedId = Number(btn.dataset.id);
      renderMatchList();
      renderSelected();
    });
  });
}

function renderSelected() {
  const selected = state.analyses.find(a => a.target.id === state.selectedId);
  els.emptyState.classList.toggle("hidden", !!selected);
  els.analysisContent.classList.toggle("hidden", !selected);
  
  if (!selected) return;

  const { target, summary, closest } = selected;
  els.selectedLeague.textContent = target.league.name;
  els.selectedTitle.textContent = `${target.home} - ${target.away}`;
  els.selectedMeta.textContent = `${target.date} ${target.time} · KT ${target.iddaaCodeSum || '-'} · OT ${formatOddsTotal(target)}`;
  
  const signalCard = document.querySelector(".signal-card");
  signalCard.classList.remove("high-conf", "mid-conf", "low-conf");
  if (summary.confidence === "Yuksek") signalCard.classList.add("high-conf");
  else if (summary.confidence === "Orta") signalCard.classList.add("mid-conf");
  else if (summary.confidence === "Dusuk") signalCard.classList.add("low-conf");

  els.signalConfidence.textContent = `${summary.confidence} Güven`;
  els.signalText.textContent = summary.signal;

  // Odds Strip
  const odds = [
    { label: "1", val: formatOdd(target.odds.one) },
    { label: "X", val: formatOdd(target.odds.draw) },
    { label: "2", val: formatOdd(target.odds.two) },
    { label: "Alt", val: formatOdd(target.odds.under25) },
    { label: "Üst", val: formatOdd(target.odds.over25) },
    { label: "Kod", val: target.iddaaCode || "-" }
  ];
  els.oddsStrip.innerHTML = odds.map(o => `
    <div class="odd-item">
      <span class="odd-label">${o.label}</span>
      <span class="odd-value">${o.val}</span>
    </div>
  `).join("");

  // Bars
  const outcomes = [
    { label: "1", val: summary.homeWin },
    { label: "X", val: summary.draw },
    { label: "2", val: summary.awayWin },
    { label: "Favori", val: summary.favoriteWin }
  ];
  els.outcomeBars.innerHTML = outcomes.map(o => `
    <div class="bar-row">
      <span class="bar-label">${o.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${o.val}%"></div></div>
      <span class="bar-value">${o.val}%</span>
    </div>
  `).join("");
  els.sampleBadge.textContent = `${summary.count} Örnek`;

  const goals = [
    { label: "Alt", val: summary.under25 },
    { label: "Üst", val: summary.over25 },
    { label: "KG Var", val: summary.btts }
  ];
  els.goalBars.innerHTML = goals.map(g => `
    <div class="bar-row">
      <span class="bar-label">${g.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${g.val}%"></div></div>
      <span class="bar-value">${g.val}%</span>
    </div>
  `).join("");
  els.goalBadge.textContent = `${summary.averageGoals} Ort.`;

  // Similar Table
  els.closestBadge.textContent = `${closest.length} Maç`;
  els.similarTable.innerHTML = `
    <div class="similar-row header">
      <span>Tarih</span>
      <span>Maç</span>
      <span>Oranlar</span>
      <span>İY</span>
      <span>MS</span>
      <span>%</span>
    </div>
    ${closest.map(m => `
      <div class="similar-row">
        <span class="match-item-meta">${m.date}</span>
        <span class="similar-teams">${m.home} - ${m.away}</span>
        <span class="similar-odds">${formatOdd(m.odds.one)} / ${formatOdd(m.odds.draw)} / ${formatOdd(m.odds.two)}</span>
        <span class="match-item-meta">${m.halftimeScoreText || '-'}</span>
        <span class="similar-score">${m.scoreText || '-'}</span>
        <span class="badge">${m.similarity}%</span>
      </div>
    `).join("")}
  `;
}

function renderCodeGroups() {
  const groups = state.iddaaCodeGroups;
  els.codeGroupsLabel.textContent = `${groups.length} Grup`;
  els.codeGroups.innerHTML = groups.map(g => `
    <div class="code-group-card glass-card">
      <div class="code-group-header">
        <span class="code-group-sum">${g.sum}</span>
        <span class="code-group-count">${g.count} Maç</span>
      </div>
      <div class="code-chips">${g.codes.map(c => `<span class="code-chip">${c}</span>`).join("")}</div>
      <div class="code-match-list">
        ${g.matches.map(m => `
          <button class="code-match-item" data-id="${m.id}">
            <span class="code-match-time">${m.time}</span>
            <span class="code-match-teams">${m.home} - ${m.away}</span>
            <span class="code-match-score">${m.scoreText || m.statusText}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `).join("");

  els.codeGroups.querySelectorAll(".code-match-item").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedId = Number(btn.dataset.id);
      setActiveView("analysis");
      renderMatchList();
      renderSelected();
    });
  });
}

function renderOddsTotalGroups() {
  const groups = state.oddsTotalGroups;
  els.oddsTotalGroupsLabel.textContent = `${groups.length} Grup`;
  els.oddsTotalGroups.innerHTML = groups.map(g => `
    <div class="code-group-card glass-card">
      <div class="code-group-header">
        <span class="code-group-sum">${g.totalText}</span>
        <span class="code-group-count">${g.count} Maç</span>
      </div>
      <div class="code-match-list">
        ${g.matches.map(m => `
          <button class="code-match-item" data-id="${m.id}">
            <span class="code-match-time">${m.time}</span>
            <span class="code-match-teams">${m.home} - ${m.away}</span>
            <span class="code-match-score">${m.scoreText || m.statusText}</span>
          </button>
        `).join("")}
      </div>
    </div>
  `).join("");
  
  els.oddsTotalGroups.querySelectorAll(".code-match-item").forEach(btn => {
    btn.addEventListener("click", () => {
      state.selectedId = Number(btn.dataset.id);
      setActiveView("analysis");
      renderMatchList();
      renderSelected();
    });
  });
}

// --- Init ---

function bindEvents() {
  els.themeOptions.forEach(opt => opt.addEventListener("click", () => setTheme(opt.dataset.theme)));
  els.viewTabs.forEach(tab => tab.addEventListener("click", () => setActiveView(tab.dataset.view)));
  els.refreshButton.addEventListener("click", () => loadAnalysis(true));
  els.searchInput.addEventListener("input", renderMatchList);
  els.toleranceInput.addEventListener("input", () => {
    els.toleranceLabel.textContent = `%${els.toleranceInput.value}`;
  });
  els.toleranceInput.addEventListener("change", () => loadAnalysis());
  els.daysInput.addEventListener("change", () => loadAnalysis());
  els.dateInput.addEventListener("change", () => loadAnalysis());
  els.sameLeagueInput.addEventListener("change", () => loadAnalysis());
  
  document.querySelectorAll(".segment").forEach(s => {
    s.addEventListener("click", () => {
      document.querySelectorAll(".segment").forEach(i => i.classList.remove("active"));
      s.classList.add("active");
      state.sport = s.dataset.sport;
      loadAnalysis();
    });
  });
}

async function init() {
  const now = new Date();
  els.dateInput.value = now.toISOString().split('T')[0];
  
  bindEvents();
  setTheme(localStorage.getItem("oran-radar-theme") || "dark");
  setActiveView(state.activeView);
  
  await loadAnalysis();
  
  setInterval(() => {
    if (els.autoRefreshInput.checked) loadAnalysis(false);
  }, 60000);
}

init();
