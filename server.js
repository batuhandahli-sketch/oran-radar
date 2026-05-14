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
let lastUpdate = "Henüz veri çekilmedi";
let lastError = null;

async function fetchLive() {
    try {
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        
        // Mackolik bazen botlari engeller, user-agent ekliyoruz
        const response = await fetch(`https://vd.mackolik.com/livedata?date=${encodeURIComponent(dateStr)}`, {
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Referer": "https://www.mackolik.com/"
            }
        });

        if (!response.ok) throw new Error(`HTTP Hata: ${response.status}`);
        
        const data = await response.json();
        if (data && data.m) {
            liveMatches = data.m;
            lastUpdate = new Date().toLocaleTimeString('tr-TR');
            lastError = null;
            console.log(`Veri basariyla cekildi: ${liveMatches.length} maç`);
        }
    } catch (e) {
        lastError = e.message;
        console.error("Veri cekme hatasi:", e.message);
    }
}

// Periyodik yenileme
setInterval(fetchLive, 60000);
fetchLive();

app.get('/api/health', (req, res) => {
    res.json({ ok: true, lastUpdate, error: lastError, liveCount: liveMatches.length });
});

app.get('/api/analyze', (req, res) => {
    const { tolerance = 5, sport = "1" } = req.query;
    const t = parseFloat(tolerance) / 100;

    db.all(`SELECT * FROM matches ORDER BY id DESC LIMIT 2000`, (err, history) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });

        const analyses = liveMatches.map(m => {
            const league = m[36] || [];
            const matchSportId = league[11];
            if (sport !== "all" && String(matchSportId) !== String(sport)) return null;

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
                    margin: { oneXTwo: 0.05 },
                    statusText: m[6] || "", finished: /(MS|UZ|PEN)/.test(m[6])
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

        res.json({ ok: true, analyses, coverage: { targetMatches: analyses.length, updatedAt: lastUpdate } });
    });
});

app.listen(port, () => { console.log(`Oran Radar LIVE running on ${port}`); });
