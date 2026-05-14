const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs/promises');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Dosyalar ana dizinde olduğu için direkt buradan servis ediyoruz
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'matches.sqlite');
const db = new sqlite3.Database(DB_PATH);

app.get('/api/health', (req, res) => {
    res.json({ ok: true, message: "Oran Radar Cloud Active" });
});

app.get('/api/analyze', (req, res) => {
    const { tolerance = 5 } = req.query;
    const t = parseFloat(tolerance) / 100;

    db.all(`SELECT * FROM matches ORDER BY id DESC LIMIT 2000`, (err, history) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });

        const analyses = history.slice(0, 50).map(m => {
            const h = m.home_odds;
            const d = m.draw_odds;
            const a = m.away_odds;

            const closestMatches = history.filter(h2 => 
                h2.id !== m.id &&
                Math.abs(h2.home_odds - h) / h < t && 
                Math.abs(h2.draw_odds - d) / d < t && 
                Math.abs(h2.away_odds - a) / a < t
            );

            return {
                target: {
                    id: m.id,
                    home: m.home_team,
                    away: m.away_team,
                    time: '20:00',
                    date: m.date,
                    iddaaCode: m.iddaa_code,
                    iddaaCodeSum: m.iddaa_code_sum,
                    league: { name: m.league, country: '' },
                    odds: { one: m.home_odds, draw: m.draw_odds, two: m.away_odds, under25: 1.80, over25: 1.90 },
                    probabilities: { one: 0.4, draw: 0.3, two: 0.3, under25: 0.5, over25: 0.5 },
                    margin: { oneXTwo: 0.05 },
                    statusText: 'MS',
                    finished: true
                },
                summary: {
                    count: closestMatches.length,
                    homeWin: Math.round((closestMatches.filter(c => c.home_score > c.away_score).length / closestMatches.length) * 100) || 0,
                    draw: Math.round((closestMatches.filter(c => c.home_score === c.away_score).length / closestMatches.length) * 100) || 0,
                    awayWin: Math.round((closestMatches.filter(c => c.home_score < c.away_score).length / closestMatches.length) * 100) || 0,
                    averageGoals: 2.5,
                    signal: closestMatches.length > 0 ? 'Analiz tamamlandı' : 'Yetersiz veri',
                    confidence: closestMatches.length > 10 ? 'Yuksek' : 'Dusuk'
                },
                closest: closestMatches.slice(0, 15).map(c => ({
                    id: c.id,
                    home: c.home_team,
                    away: c.away_team,
                    date: c.date,
                    odds: { one: c.home_odds, draw: c.draw_odds, two: c.away_odds },
                    scoreText: `${c.home_score}-${c.away_score}`,
                    halftimeScoreText: c.ht_score,
                    league: { name: c.league, country: '' },
                    similarity: 100 - Math.round(Math.abs(c.home_odds - h) * 10)
                }))
            };
        });

        const codeSumMap = new Map();
        history.forEach(m => {
            if (!m.iddaa_code_sum) return;
            const sum = m.iddaa_code_sum;
            if (!codeSumMap.has(sum)) {
                codeSumMap.set(sum, { sum: sum, count: 0, codes: new Set(), matches: [] });
            }
            const group = codeSumMap.get(sum);
            group.count++;
            group.codes.add(m.iddaa_code);
            group.matches.push({
                id: m.id,
                home: m.home_team,
                away: m.away_team,
                time: '20:00',
                scoreText: `${m.home_score}-${m.away_score}`,
                league: { name: m.league, country: '' },
                iddaaCode: m.iddaa_code
            });
        });

        const iddaaCodeGroups = Array.from(codeSumMap.values())
            .filter(g => g.count > 1)
            .map(g => ({ ...g, codes: Array.from(g.codes).sort(), matches: g.matches.slice(0, 10) }))
            .sort((a, b) => b.count - a.count);

        const oddsTotalMap = new Map();
        history.slice(0, 500).forEach(m => {
            const sum = (m.home_odds + m.draw_odds + m.away_odds).toFixed(2);
            if (!oddsTotalMap.has(sum)) {
                oddsTotalMap.set(sum, { totalText: sum, count: 0, matches: [] });
            }
            const group = oddsTotalMap.get(sum);
            group.count++;
            group.matches.push({
                id: m.id,
                home: m.home_team,
                away: m.away_team,
                time: '20:00',
                scoreText: `${m.home_score}-${m.away_score}`,
                league: { name: m.league, country: '' },
                odds: { one: m.home_odds, draw: m.draw_odds, two: m.away_odds }
            });
        });

        const oddsTotalGroups = Array.from(oddsTotalMap.values())
            .filter(g => g.count > 1)
            .sort((a, b) => b.count - a.count);

        res.json({
            ok: true,
            analyses,
            iddaaCodeGroups,
            oddsTotalGroups,
            coverage: {
                targetMatches: analyses.length,
                targetOddsMatches: analyses.length,
                historyOddsFinished: history.length,
                iddaaCodeGroups: iddaaCodeGroups.length,
                iddaaCodeGroupedMatches: iddaaCodeGroups.reduce((acc, g) => acc + g.count, 0),
                oddsTotalGroups: oddsTotalGroups.length,
                oddsTotalGroupedMatches: oddsTotalGroups.reduce((acc, g) => acc + g.count, 0)
            }
        });
    });
});

app.listen(port, () => {
    console.log(`Oran Radar Cloud running on port ${port}`);
});
