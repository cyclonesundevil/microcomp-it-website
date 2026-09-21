document.addEventListener('DOMContentLoaded', () => {
    const apiBase = ['5178', '5179', '5180'].includes(window.location.port) ? 'http://127.0.0.1:5010' : '';
    const params = new URLSearchParams(window.location.search);
    const model = params.get('model') || 'baseline';
    const requestedSeason = params.get('season') || new Date().getFullYear();
    const title = document.getElementById('performance-title');
    const seasonInput = document.getElementById('performance-season');
    const loadButton = document.getElementById('load-performance-trend');
    const message = document.getElementById('performance-trend-message');
    const cacheStatus = document.getElementById('performance-cache-status');
    const atsChart = document.getElementById('ats-performance-chart');
    const ouChart = document.getElementById('ou-performance-chart');
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

    function renderChart(container, titleText, weeks, metric, color) {
        const points = pointsForMetric(weeks, metric);
        if (!points.length) {
            container.innerHTML = `<h2>${titleText}</h2><p class="nfl-table-note">No graded picks are available for this metric yet.</p>`;
            return;
        }
        const width = 760;
        const height = 300;
        const padLeft = 52;
        const padRight = 20;
        const padTop = 28;
        const padBottom = 44;
        const minWeek = Math.min(...points.map((point) => point.week));
        const maxWeek = Math.max(...points.map((point) => point.week));
        const span = Math.max(1, maxWeek - minWeek);
        const x = (week) => padLeft + ((week - minWeek) / span) * (width - padLeft - padRight);
        const y = (value) => padTop + (1 - value) * (height - padTop - padBottom);
        const polyline = points.map((point) => `${x(point.week).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
        const weekLabels = points.map((point) => `<text x="${x(point.week).toFixed(1)}" y="${height - 16}" text-anchor="middle" fill="currentColor" font-size="11">${point.week}</text>`).join('');
        const dots = points.map((point) => `<circle cx="${x(point.week).toFixed(1)}" cy="${y(point.value).toFixed(1)}" r="4" fill="${color}"><title>Week ${point.week}: ${formatPercent(point.value)}</title></circle>`).join('');
        const grid = [0, 0.25, 0.5, 0.75, 1].map((value) => {
            const yy = y(value).toFixed(1);
            return `<line x1="${padLeft}" x2="${width - padRight}" y1="${yy}" y2="${yy}" stroke="currentColor" opacity="0.16"></line><text x="${padLeft - 10}" y="${Number(yy) + 4}" text-anchor="end" fill="currentColor" font-size="11">${Math.round(value * 100)}%</text>`;
        }).join('');
        container.innerHTML = `
            <h2>${titleText}</h2>
            <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${titleText}" style="width:100%;max-width:${width}px;height:auto;">
                ${grid}
                <line x1="${padLeft}" x2="${width - padRight}" y1="${height - padBottom}" y2="${height - padBottom}" stroke="currentColor" opacity="0.4"></line>
                <line x1="${padLeft}" x2="${padLeft}" y1="${padTop}" y2="${height - padBottom}" stroke="currentColor" opacity="0.4"></line>
                <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
                ${dots}
                ${weekLabels}
                <text x="${width / 2}" y="${height - 2}" text-anchor="middle" fill="currentColor" font-size="12">Week</text>
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
        renderChart(atsChart, 'ATS Win % by Week', weeks, 'spread_win_rate', '#65d9ff');
        renderChart(ouChart, 'O/U Win % by Week', weeks, 'total_win_rate', '#a78bfa');
        renderTable(weeks);
    }

    async function loadTrend() {
        const season = seasonInput.value || requestedSeason;
        message.textContent = 'Loading algorithm performance trend...';
        cacheStatus.textContent = 'Trend cache status loading...';
        tableBody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
        atsChart.innerHTML = '';
        ouChart.innerHTML = '';
        loadButton.disabled = true;
        try {
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
