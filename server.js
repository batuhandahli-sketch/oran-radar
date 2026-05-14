const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'matches.sqlite');
const db = new sqlite3.Database(DB_PATH);

let liveMatches = [];
let lastUpdate = "-";

async function fetchLive() {
    try {
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        const response = await fetch(`https://vd.mackolik.com/livedata?date=${encodeURIComponent(dateStr)}`, {
            headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.mackolik.com/" }
        });
        const data = await response.json();
        if (data && data.m) {
            liveMatches = data.m;
            lastUpdate = new Date().toLocaleTimeString('tr-TR');
        }
    } catch (e) { console.error("Hata:", e.message); }
}

setInterval(fetchLive, 60000);
fetchLive();

app.get('/api/analyze', (req, res) => {
    const { tolerance = 5, sport = "1" } = req.query;
    const t = parseFloat(tolerance) / 100;

    db.all(`SELECT * FROM matches ORDER BY id DESC LIMIT 2000`, (err, history) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });

        const analyses = liveMatches.map(m => {
            const league = m[36] || [];
            if (sport !== "all" && String(league[11]) !== String(sport)) return null;

            const h = parseFloat(String(m[18] || "").replace(',', '.'));
            const d = parseFloat(String(m[19] || "").replace(',', '.'));
            const a = parseFloat(String(m[20] || "").replace(',', '.'));
            if (!h || !d || !a) return null;

            const closestMatches = history.filter(h2 => 
                Math.abs(h2.home_odds - h) / h < t && 
                Math.abs(h2.draw_odds - d) / d < t && 
                Math.abs(h2.away_odds - a) / a < t
            );

            return {
                target: {
                    id: m[0], home: m[2], away: m[4], time: m[16] || "00:00", date: m[35] || "",
                    league: { name: league[3] || "", country: league[1] || "" },
                    odds: { one: h, draw: d, two: a, under25: 1.80, over25: 1.90 },
                    probabilities: { one: 0.4, draw: 0.3, two: 0.3, under25: 0.5, over25: 0.5 },
                    margin: { oneXTwo: 0.05 }, statusText: m[6] || "", finished: /(MS|UZ|PEN)/.test(m[6])
                },
                summary: {
                    count: closestMatches.length,
                    homeWin: Math.round((closestMatches.filter(c => c.home_score > c.away_score).length / closestMatches.length) * 100) || 0,
                    draw: Math.round((closestMatches.filter(c => c.home_score === c.away_score).length / closestMatches.length) * 100) || 0,
                    awayWin: Math.round((closestMatches.filter(c => c.home_score < c.away_score).length / closestMatches.length) * 100) || 0,
                    averageGoals: 2.5, signal: closestMatches.length > 0 ? 'Analiz tamamlandı' : 'Yetersiz veri',
                    confidence: closestMatches.length > 15 ? 'Yuksek' : 'Dusuk'
                },
                closest: closestMatches.slice(0, 15).map(c => ({
                    id: c.id, home: c.home_team, away: c.away_team, date: c.date,
                    odds: { one: c.home_odds, draw: c.draw_odds, two: c.away_odds },
                    scoreText: `${c.home_score}-${c.away_score}`, halftimeScoreText: c.ht_score,
                    league: { name: c.league, country: '' }, similarity: 100 - Math.round(Math.abs(c.home_odds - h) * 10)
                }))
            };
        }).filter(x => x !== null);

        // Kod Toplamları
        const codeSumMap = new Map();
        history.forEach(m => {
            if (!m.iddaa_code_sum) return;
            const sum = m.iddaa_code_sum;
            if (!codeSumMap.has(sum)) codeSumMap.set(sum, { sum: sum, count: 0, codes: new Set(), matches: [] });
            const group = codeSumMap.get(sum);
            group.count++; group.codes.add(m.iddaa_code);
            group.matches.push({ id: m.id, home: m.home_team, away: m.away_team, time: '20:00', scoreText: `${m.home_score}-${m.away_score}`, iddaaCode: m.iddaa_code });
        });
        const iddaaCodeGroups = Array.from(codeSumMap.values()).filter(g => g.count > 1).map(g => ({ ...g, codes: Array.from(g.codes).sort(), matches: g.matches.slice(0, 10) })).sort((a, b) => b.count - a.count);

        // Oran Toplamları
        const oddsTotalMap = new Map();
        history.forEach(m => {
            const h = parseFloat(m.home_odds);
            const d = parseFloat(m.draw_odds);
            const a = parseFloat(m.away_odds);
            if (!h || !d || !a) return; // 0 oranlı maçları atla

            const sum = (h + d + a).toFixed(2);
            if (!oddsTotalMap.has(sum)) oddsTotalMap.set(sum, { totalText: sum, count: 0, matches: [] });
            const group = oddsTotalMap.get(sum);
            group.count++; 
            group.matches.push({ 
                id: m.id, home: m.home_team, away: m.away_team, 
                time: '20:00', // Gecmis maclar icin sabit saat
                scoreText: `${m.home_score}-${m.away_score}`, 
                odds: { one: h, draw: d, two: a } 
            });
        });
        const oddsTotalGroups = Array.from(oddsTotalMap.values()).filter(g => g.count > 1).sort((a, b) => b.count - a.count).slice(0, 50);

        res.json({ ok: true, analyses, iddaaCodeGroups, oddsTotalGroups, coverage: { targetMatches: analyses.length, updatedAt: lastUpdate } });
    });
});

app.listen(port, () => { console.log(`Oran Radar Cloud running on ${port}`); });
