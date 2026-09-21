document.addEventListener('DOMContentLoaded', () => {
    const apiBase = ['5178', '5179', '5180'].includes(window.location.port) ? 'http://127.0.0.1:5010' : '';
    const params = new URLSearchParams(window.location.search);
    const model = params.get('model') || 'baseline';
    const requestedSeason = params.get('season') || new Date().getFullYear();
    const demoMode = params.get('demo') === '1';
    const title = document.getElementById('performance-title');
    const seasonInput = document.getElementById('performance-season');
    const loadButton = document.getElementById('load-performance-trend');
    const message = document.getElementById('performance-trend-message');
    const cacheStatus = document.getElementById('performance-cache-status');
    const combinedChart = document.getElementById('combined-performance-chart');
    const tableBody = document.getElementById('performance-trend-body');

    title.textContent = `${model} Weekly Performance`;
    seasonInput.value = requestedSeason;

    function formatPercent(value) {
        return value === null || value === undefined ? '--' : `${(Number(value) * 100).toFixed(1)}%`;
    }

    function formatNumber(value) {
        return value === null || value === undefined ? '--' : Number(value).toFixed(2);
    }

    function formatDateTime(value) {
        if (!value) return '--';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
        });
    }

    function recordString(wins, losses, pushes, bets) {
        if (!bets) return 'No picks';
        const pushPart = pushes ? `-${pushes}` : '';
        return `${wins}-${losses}${pushPart}`;
    }

    function pointsForMetric(weeks, metric) {
        return weeks
            .filter((week) => week[metric] !== null && week[metric] !== undefined)
            .map((week) => ({ week: Number(week.week), value: Number(week[metric]) }));
    }

    function renderCombinedChart(container, weeks) {
        const series = [
            { label: 'ATS Win %', metric: 'spread_win_rate', color: '#65d9ff' },
            { label: 'O/U Win %', metric: 'total_win_rate', color: '#a78bfa' },
        ].map((item) => ({ ...item, points: pointsForMetric(weeks, item.metric) }));
        const allPoints = series.flatMap((item) => item.points);
        if (!allPoints.length) {
            container.innerHTML = '<h2>ATS and O/U Win % by Week</h2><p class="nfl-table-note">No graded picks are available yet.</p>';
            return;
        }
        const width = 760;
        const height = 330;
        const padLeft = 52;
        const padRight = 20;
        const padTop = 28;
        const padBottom = 62;
        const minWeek = Math.min(...allPoints.map((point) => point.week));
        const maxWeek = Math.max(...allPoints.map((point) => point.week));
        const span = Math.max(1, maxWeek - minWeek);
        const x = (week) => padLeft + ((week - minWeek) / span) * (width - padLeft - padRight);
        const y = (value) => padTop + (1 - value) * (height - padTop - padBottom);
        const weeksWithPoints = [...new Set(allPoints.map((point) => point.week))].sort((a, b) => a - b);
        const weekLabels = weeksWithPoints.map((week) => `<text x="${x(week).toFixed(1)}" y="${height - 34}" text-anchor="middle" fill="currentColor" font-size="11">${week}</text>`).join('');
        const grid = [0, 0.25, 0.5, 0.75, 1].map((value) => {
            const yy = y(value).toFixed(1);
            return `<line x1="${padLeft}" x2="${width - padRight}" y1="${yy}" y2="${yy}" stroke="currentColor" opacity="0.16"></line><text x="${padLeft - 10}" y="${Number(yy) + 4}" text-anchor="end" fill="currentColor" font-size="11">${Math.round(value * 100)}%</text>`;
        }).join('');
        const fiftyLineY = y(0.5).toFixed(1);
        const lines = series.map((item) => {
            if (!item.points.length) return '';
            const polyline = item.points.map((point) => `${x(point.week).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
            const dots = item.points.map((point) => `<circle cx="${x(point.week).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="4" fill="${item.color}"><title>${item.label} Week ${point.week}: ${formatPercent(point.value)}</title></circle>`).join('');
            return `<polyline points="${polyline}" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>${dots}`;
        }).join('');
        const legendItems = [
            ...series,
            { label: '50% reference', color: '#ef4444', strokeWidth: 1.25 },
        ];
        const legend = legendItems.map((item, index) => {
            const offset = index * 125;
            return `<g transform="translate(${padLeft + offset},${height - 16})"><line x1="0" x2="24" y1="0" y2="0" stroke="${item.color}" stroke-width="${item.strokeWidth || 3}"></line><text x="32" y="4" fill="currentColor" font-size="12">${item.label}</text></g>`;
        }).join('');
        container.innerHTML = `
            <h2>ATS and O/U Win % by Week</h2>
            <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="ATS and over under win percentages by week" style="width:100%;max-width:${width}px;height:auto;">
                ${grid}
                <line x1="${padLeft}" x2="${width - padRight}" y1="${fiftyLineY}" y2="${fiftyLineY}" stroke="#ef4444" stroke-width="1.25"></line>
                <text x="${width - padRight}" y="${Number(fiftyLineY) - 7}" text-anchor="end" fill="#ef4444" font-size="12">50%</text>
                <line x1="${padLeft}" x2="${width - padRight}" y1="${height - padBottom}" y2="${height - padBottom}" stroke="currentColor" opacity="0.4"></line>
                <line x1="${padLeft}" x2="${padLeft}" y1="${padTop}" y2="${height - padBottom}" stroke="currentColor" opacity="0.4"></line>
                ${lines}
                ${weekLabels}
                <text x="${width / 2}" y="${height - 20}" text-anchor="middle" fill="currentColor" font-size="12">Week</text>
                ${legend}
            </svg>
        `;
    }

    function renderTable(weeks) {
        if (!weeks.length) {
            tableBody.innerHTML = '<tr><td colspan="8">No completed games are available for this season.</td></tr>';
            return;
        }
        tableBody.innerHTML = weeks.map((week) => {
            const spreadRecord = recordString(week.spread_wins, week.spread_losses, week.spread_pushes, week.spread_bets);
            const totalRecord = recordString(week.total_wins, week.total_losses, week.total_pushes, week.total_bets);
            return `<tr><td>${week.week}</td><td>${week.completed_games}</td><td>${spreadRecord}</td><td>${formatPercent(week.spread_win_rate)}</td><td>${totalRecord}</td><td>${formatPercent(week.total_win_rate)}</td><td>${formatNumber(week.margin_mae)}</td><td>${formatNumber(week.total_mae)}</td></tr>`;
        }).join('');
    }

    function renderTrend(payload) {
        const trend = payload.trend;
        const weeks = trend.weeks || [];
        title.textContent = `${trend.model} Weekly Performance`;
        message.textContent = `Season ${trend.season}: ${weeks.length} week${weeks.length === 1 ? '' : 's'} with completed games.`;
        cacheStatus.textContent = `Trend data ${payload.cache_hit ? 'served from cache' : 'rebuilt'}${trend.generated_at ? `; generated ${formatDateTime(trend.generated_at)}` : ''}.`;
        renderCombinedChart(combinedChart, weeks);
        renderTable(weeks);
    }

    function syntheticTrendPayload(season) {
        const atsRates = [0.44, 0.56, 0.50, 0.63, 0.47, 0.58, 0.54, 0.69, 0.52, 0.48, 0.61, 0.57];
        const ouRates = [0.50, 0.43, 0.57, 0.46, 0.62, 0.55, 0.49, 0.53, 0.65, 0.59, 0.45, 0.51];
        const weeks = atsRates.map((spreadRate, index) => {
            const week = index + 1;
            const spreadBets = 16;
            const totalBets = 16;
            const spreadWins = Math.round(spreadRate * spreadBets);
            const totalWins = Math.round(ouRates[index] * totalBets);
            return {
                week,
                completed_games: 16,
                spread_wins: spreadWins,
                spread_losses: spreadBets - spreadWins,
                spread_pushes: week % 5 === 0 ? 1 : 0,
                spread_bets: spreadBets + (week % 5 === 0 ? 1 : 0),
                spread_win_rate: spreadWins / spreadBets,
                total_wins: totalWins,
                total_losses: totalBets - totalWins,
                total_pushes: week % 6 === 0 ? 1 : 0,
                total_bets: totalBets + (week % 6 === 0 ? 1 : 0),
                total_win_rate: totalWins / totalBets,
                margin_mae: 7.5 + ((week % 4) * 0.7),
                total_mae: 8.2 + ((week % 5) * 0.6),
            };
        });
        return {
            success: true,
            cache_hit: false,
            trend: {
                season: Number(season),
                model: `${model} synthetic demo`,
                generated_at: new Date().toISOString(),
                weeks,
            },
        };
    }

    async function loadTrend() {
        const season = seasonInput.value || requestedSeason;
        message.textContent = demoMode ? 'Loading synthetic demo performance trend...' : 'Loading algorithm performance trend...';
        cacheStatus.textContent = demoMode ? 'Synthetic demo data; not from cache or model results.' : 'Trend cache status loading...';
        tableBody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
        combinedChart.innerHTML = '';
        loadButton.disabled = true;
        try {
            if (demoMode) {
                renderTrend(syntheticTrendPayload(season));
                cacheStatus.textContent = 'Synthetic 12-week demo data only; no backend data, model results, or cache were used.';
                return;
            }
            const response = await fetch(`${apiBase}/api/v1/nfl/week-performance-trend?model=${encodeURIComponent(model)}&season=${encodeURIComponent(season)}`);
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load algorithm trend');
            renderTrend(data);
        } catch (error) {
            message.textContent = `Unable to load algorithm trend: ${error.message}`;
            cacheStatus.textContent = 'Trend cache unavailable.';
            tableBody.innerHTML = '<tr><td colspan="8">Unavailable</td></tr>';
        } finally {
            loadButton.disabled = false;
        }
    }

    loadButton.addEventListener('click', loadTrend);
    loadTrend();
});
