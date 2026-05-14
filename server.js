const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 5173;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'matches.sqlite');
const db = new sqlite3.Database(DB_PATH);

let currentLiveMatches = [];
const historicalCache = new Map();

const getTodayStr = () => {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
};

async function updateLiveFeed() {
    const today = getTodayStr();
    try {
        const ts = Date.now();
        const response = await fetch(`https://vd.mackolik.com/livedata?date=${encodeURIComponent(today)}&_=${ts}`, {
            headers: { "User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache" }
        });
        const data = await response.json();
        if (data && data.m) {
            currentLiveMatches = data.m;
            console.log(`[CANLI] Veriler tazelendi: ${currentLiveMatches.length} maç (${new Date().toLocaleTimeString('tr-TR')})`);
        }
    } catch (e) { console.error("Veri hatası:", e.message); }
}

async function fetchHistorical(dateStr) {
    if (historicalCache.has(dateStr)) return historicalCache.get(dateStr);
    try {
        const ts = Date.now();
        const response = await fetch(`https://vd.mackolik.com/livedata?date=${encodeURIComponent(dateStr)}&_=${ts}`, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        const data = await response.json();
        if (data && data.m) {
            historicalCache.set(dateStr, data.m);
            return data.m;
        }
    } catch (e) { console.error("Geçmiş veri hatası:", e.message); }
    return [];
}

setInterval(updateLiveFeed, 30000);
updateLiveFeed();

app.get('/api/analyze', async (req, res) => {
    try {
        const { tolerance = 5, sport = "1", date } = req.query;
        const t = parseFloat(tolerance) / 100;
        const todayStr = getTodayStr();
        const targetDate = date || todayStr;

        const targetMatches = (targetDate === todayStr) ? currentLiveMatches : await fetchHistorical(targetDate);

        db.all(`SELECT * FROM matches WHERE home_odds > 0 ORDER BY id DESC LIMIT 5000`, (err, history) => {
            if (err) {
                console.error("DB Hatası:", err.message);
                return res.status(500).json({ ok: false, error: "Veritabanı hatası" });
            }

            const analyses = (targetMatches || []).map(m => {
                if (!m || !m[36]) return null;
                const league = m[36] || [];
                if (sport !== "all" && String(league[11]) !== String(sport)) return null;
                
                const h = parseFloat(String(m[18] || "").replace(',', '.'));
                const d = parseFloat(String(m[19] || "").replace(',', '.'));
                const a = parseFloat(String(m[20] || "").replace(',', '.'));
                if (!h || !d || !a || h < 1.01) return null;

                const closestMatches = (history || []).filter(h2 => 
                    Math.abs(h2.home_odds - h) / h < t && Math.abs(h2.draw_odds - d) / d < t && Math.abs(h2.away_odds - a) / a < t
                );

                return {
                    target: {
                        id: m[0], home: m[2], away: m[4], time: m[16] || "00:00", date: m[35] || "",
                        league: { name: league[3] || "", country: league[1] || "" },
                        odds: { one: h, draw: d, two: a, under25: 1.80, over25: 1.90 },
                        statusText: m[6] || "", finished: /(MS|UZ|PEN)/.test(m[6])
                    },
                    summary: {
                        count: closestMatches.length,
                        homeWin: Math.round((closestMatches.filter(c => c.home_score > c.away_score).length / closestMatches.length) * 100) || 0,
                        draw: Math.round((closestMatches.filter(c => c.home_score === c.away_score).length / closestMatches.length) * 100) || 0,
                        awayWin: Math.round((closestMatches.filter(c => c.home_score < c.away_score).length / closestMatches.length) * 100) || 0,
                        signal: closestMatches.length > 0 ? 'Tamam' : 'Yok', confidence: 'Orta'
                    },
                    closest: closestMatches.slice(0, 10).map(c => ({
                        id: c.id, home: c.home_team, away: c.away_team, date: c.date, scoreText: `${c.home_score}-${c.away_score}`, similarity: 100,
                        odds: { one: c.home_odds, draw: c.draw_odds, two: c.away_odds }
                    }))
                };
            }).filter(x => x !== null);

            const oddsTotalMap = new Map();
            const codeSumMap = new Map();
            (targetMatches || []).forEach(m => {
                if (!m) return;
                const h = parseFloat(String(m[18] || "").replace(',', '.'));
                const d = parseFloat(String(m[19] || "").replace(',', '.'));
                const a = parseFloat(String(m[20] || "").replace(',', '.'));
                if (h > 1.01) {
                    const sum = (h + d + a).toFixed(2);
                    if (!oddsTotalMap.has(sum)) oddsTotalMap.set(sum, { totalText: sum, count: 0, matches: [] });
                    const og = oddsTotalMap.get(sum);
                    og.count++;
                    og.matches.push({ id: m[0], home: m[2], away: m[4], time: m[16] || "00:00", scoreText: `${m[12] || 0}-${m[13] || 0}`, odds: { one: h, draw: d, two: a } });
                }
                const dbMatch = (history || []).find(hM => String(hM.home_team) === String(m[2]) && String(hM.away_team) === String(m[4]));
                if (dbMatch && dbMatch.iddaa_code_sum) {
                    const s = dbMatch.iddaa_code_sum;
                    if (!codeSumMap.has(s)) codeSumMap.set(s, { sum: s, count: 0, codes: new Set(), matches: [] });
                    const cg = codeSumMap.get(s);
                    cg.count++; cg.codes.add(dbMatch.iddaa_code);
                    cg.matches.push({ id: m[0], home: m[2], away: m[4], time: m[16] || "00:00", scoreText: `${m[12] || 0}-${m[13] || 0}`, iddaaCode: dbMatch.iddaa_code });
                }
            });

            res.json({ 
                ok: true, 
                analyses, 
                iddaaCodeGroups: Array.from(codeSumMap.values()).filter(g => g.count > 1).sort((a,b) => b.count - a.count).slice(0, 20), 
                oddsTotalGroups: Array.from(oddsTotalMap.values()).filter(g => g.count > 1).sort((a,b) => b.count - a.count), 
                coverage: { targetMatches: analyses.length, updatedAt: new Date().toLocaleTimeString('tr-TR') } 
            });
        });
    } catch (globalErr) {
        console.error("KRİTİK HATA:", globalErr.message);
        res.status(500).json({ ok: false, error: "Sunucu hatası oluştu" });
    }
});

app.listen(port, () => { console.log(`Oran Radar Safe-Mode Active on ${port}`); });
