document.addEventListener('DOMContentLoaded', () => {
    const apiBase = ['5178', '5179', '5180'].includes(window.location.port) ? 'http://127.0.0.1:5010' : '';
    const progressPanel = document.getElementById('upcoming-progress');
    const progressValue = document.getElementById('upcoming-progress-value');
    const progressElapsed = document.getElementById('upcoming-progress-elapsed');
    const progressFill = document.getElementById('upcoming-progress-fill');
    const message = document.getElementById('upcoming-message');
    const tableBody = document.getElementById('upcoming-table-body');
    const refreshButton = document.getElementById('load-upcoming');
    let pollTimer = null;
    let elapsedTimer = null;
    let startedAt = null;

    function updateElapsed() {
        if (!startedAt || !progressElapsed) return;
        progressElapsed.textContent = `Elapsed ${Math.floor((Date.now() - startedAt) / 1000)}s`;
    }

    function showProgress(percent, statusMessage) {
        if (!startedAt) {
            startedAt = Date.now();
            elapsedTimer = window.setInterval(updateElapsed, 1000);
        }
        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
        progressPanel.hidden = false;
        progressValue.textContent = `${safePercent}%`;
        progressFill.style.width = `${safePercent}%`;
        if (statusMessage) message.textContent = statusMessage;
    }

    function stopTimers() {
        if (pollTimer) window.clearTimeout(pollTimer);
        if (elapsedTimer) window.clearInterval(elapsedTimer);
        pollTimer = null;
        elapsedTimer = null;
    }

    function resetProgress() {
        stopTimers();
        startedAt = null;
        progressElapsed.textContent = 'Elapsed 0s';
        progressValue.textContent = '0%';
        progressFill.style.width = '0%';
    }

    function signed(value) {
        if (value === null || value === undefined) return '--';
        const number = Number(value);
        return number >= 0 ? `+${number.toFixed(1)}` : number.toFixed(1);
    }

    function modelCell(prediction) {
        if (!prediction) return '--';
        const total = prediction.pred_total === null || prediction.pred_total === undefined
            ? '--'
            : Number(prediction.pred_total).toFixed(1);
        const modelHomeSpread = prediction.pred_margin === null || prediction.pred_margin === undefined
            ? null
            : -Number(prediction.pred_margin);
        return `${signed(modelHomeSpread)} / ${total}`;
    }

    function marketCell(schedule) {
        const total = schedule.total_line === null || schedule.total_line === undefined
            ? '--'
            : Number(schedule.total_line).toFixed(1);
        if (schedule.spread_line === null || schedule.spread_line === undefined) {
            return total === '--' ? '--' : `-- / ${total}`;
        }
        const homeMarketMargin = Number(schedule.spread_line);
        if (Math.abs(homeMarketMargin) < 1e-9) {
            return `PK / ${total}`;
        }
        const favorite = homeMarketMargin > 0 ? schedule.home_team : schedule.away_team;
        return `${favorite} -${Math.abs(homeMarketMargin).toFixed(1)} / ${total}`;
    }

    function renderGames(data) {
        if (!data.games.length) {
            progressPanel.hidden = true;
            message.textContent = data.message || 'No upcoming games were found in the schedule feed.';
            tableBody.innerHTML = '<tr><td colspan="8">No upcoming games were found in the schedule feed.</td></tr>';
            return;
        }

        const invalid = data.games.some((game) => !game?.schedule?.away_team || !game?.schedule?.home_team);
        if (invalid) {
            message.textContent = 'The cached forecast is invalid and is being rebuilt.';
            tableBody.innerHTML = '<tr><td colspan="8">Forecast data is invalid. Refreshing the forecast...</td></tr>';
            return;
        }

        progressPanel.hidden = true;
        message.textContent = `Season ${data.season}, week ${data.week}. Each model cell shows predicted home spread / total.`;
        tableBody.innerHTML = data.games.map((game) => {
            const schedule = game.schedule;
            const market = marketCell(schedule);
            return `<tr><td>${schedule.away_team} at ${schedule.home_team}<br><small>${schedule.gameday || '--'} ${schedule.gametime || ''}</small></td><td>${market}</td>${['baseline', 'enhanced', 'market_blend', 'rothstein', 'rothstein_plus', 'rsm_stage7c'].map((model) => `<td>${modelCell(game.models[model])}</td>`).join('')}</tr>`;
        }).join('');
    }

    async function loadUpcoming() {
        resetProgress();
        message.textContent = 'Preparing the upcoming-week forecast...';
        tableBody.innerHTML = '<tr><td colspan="8">Forecast is still being computed...</td></tr>';
        refreshButton.disabled = true;

        const poll = async () => {
            try {
                const response = await fetch(`${apiBase}/api/nfl/upcoming?scope=upcoming`);
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load upcoming predictions');

                if (data.ready === false || data.status === 'computing') {
                    showProgress(Math.max(10, Math.min(95, Number(data.progress) || 15)), data.message || 'Forecast is still being computed.');
                    tableBody.innerHTML = '<tr><td colspan="8">Forecast is still being computed...</td></tr>';
                    pollTimer = window.setTimeout(() => {
                        pollTimer = null;
                        poll();
                    }, 2500);
                    return;
                }

                stopTimers();
                renderGames(data);
            } catch (error) {
                stopTimers();
                progressPanel.hidden = true;
                message.textContent = `Unable to load upcoming predictions: ${error.message}`;
                tableBody.innerHTML = '<tr><td colspan="8">Unavailable</td></tr>';
            } finally {
                refreshButton.disabled = false;
            }
        };

        await poll();
    }

    refreshButton.addEventListener('click', loadUpcoming);
    loadUpcoming();
});
