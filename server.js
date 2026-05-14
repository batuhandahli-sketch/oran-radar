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

const dataCache = new Map();

async function fetchForDate(dateStr) {
    if (dataCache.has(dateStr)) return dataCache.get(dateStr);
    try {
        const ts = Date.now();
        const response = await fetch(`https://vd.mackolik.com/livedata?date=${encodeURIComponent(dateStr)}&_=${ts}`, {
            headers: { "User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache" }
        });
        const data = await response.json();
        if (data && data.m) {
            dataCache.set(dateStr, data.m);
            if (dataCache.size > 10) dataCache.delete(dataCache.keys().next().value);
            return data.m;
        }
    } catch (e) { console.error("Veri hatası:", e.message); }
    return [];
}

app.get('/api/analyze', async (req, res) => {
    const { tolerance = 5, sport = "1", date } = req.query;
    const t = parseFloat(tolerance) / 100;
    
    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const targetDate = date || todayStr;

    const targetMatches = await fetchForDate(targetDate);

    db.all(`SELECT * FROM matches WHERE home_odds > 0 ORDER BY id DESC LIMIT 5000`, (err, history) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });

        const analyses = targetMatches.map(m => {
            const league = m[36] || [];
            if (sport !== "all" && String(league[11]) !== String(sport)) return null;
            const h = parseFloat(String(m[18] || "").replace(',', '.'));
            const d = parseFloat(String(m[19] || "").replace(',', '.'));
            const a = parseFloat(String(m[20] || "").replace(',', '.'));
            if (!h || !d || !a || h < 1.01) return null;

            const closestMatches = history.filter(h2 => 
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
                    id: c.id, home: c.home_team, away: c.away_team, date: c.date, scoreText: `${c.home_score}-${c.away_score}`, similarity: 100
                }))
            };
        }).filter(x => x !== null);

        const oddsTotalMap = new Map();
        const codeSumMap = new Map();

        targetMatches.forEach(m => {
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

            const dbMatch = history.find(hMatch => String(hMatch.home_team) === String(m[2]) && String(hMatch.away_team) === String(m[4]));
            if (dbMatch && dbMatch.iddaa_code_sum) {
                const s = dbMatch.iddaa_code_sum;
                if (!codeSumMap.has(s)) codeSumMap.set(s, { sum: s, count: 0, codes: new Set(), matches: [] });
                const cg = codeSumMap.get(s);
                cg.count++; cg.codes.add(dbMatch.iddaa_code);
                cg.matches.push({ id: m[0], home: m[2], away: m[4], time: m[16] || "00:00", scoreText: `${m[12] || 0}-${m[13] || 0}`, iddaaCode: dbMatch.iddaa_code });
            }
        });

        const oddsTotalGroups = Array.from(oddsTotalMap.values()).filter(g => g.count > 1).sort((a, b) => b.count - a.count);
        const iddaaCodeGroups = Array.from(codeSumMap.values()).filter(g => g.count > 1).sort((a, b) => b.count - a.count);

        res.json({ ok: true, analyses, iddaaCodeGroups, oddsTotalGroups, coverage: { targetMatches: analyses.length, updatedAt: targetDate } });
    });
});

app.listen(port, () => { console.log(`Oran Radar Cloud Active on ${port}`); });
