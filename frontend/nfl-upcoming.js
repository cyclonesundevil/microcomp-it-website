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

    function marketFavoriteSpreadCell(homeMargin, marketHomeMargin, homeTeam, awayTeam, totalValue) {
        const total = totalValue === null || totalValue === undefined
            ? '--'
            : Number(totalValue).toFixed(1);
        if (homeMargin === null || homeMargin === undefined || marketHomeMargin === null || marketHomeMargin === undefined) {
            return total === '--' ? '--' : `-- / ${total}`;
        }
        const margin = Number(homeMargin);
        const marketMargin = Number(marketHomeMargin);
        if (Math.abs(marketMargin) < 1e-9) {
            return `PK / ${total}`;
        }
        const marketFavorite = marketMargin > 0 ? homeTeam : awayTeam;
        const marketFavoriteSpread = marketMargin > 0 ? -margin : margin;
        const signedSpread = marketFavoriteSpread > 0
            ? `+${marketFavoriteSpread.toFixed(1)}`
            : marketFavoriteSpread.toFixed(1);
        return `${marketFavorite} ${signedSpread} / ${total}`;
    }

    function modelCell(prediction, schedule) {
        if (!prediction) return '--';
        if (prediction.display_suppressed) {
            return 'Ineligible';
        }
        const cell = marketFavoriteSpreadCell(
            prediction.pred_margin,
            schedule.spread_line,
            prediction.home_team,
            prediction.away_team,
            prediction.pred_total,
        );
        return prediction.availability_adjusted ? `${cell} *` : cell;
    }

    function marketCell(schedule) {
        return marketFavoriteSpreadCell(
            schedule.spread_line,
            schedule.spread_line,
            schedule.home_team,
            schedule.away_team,
            schedule.total_line,
        );
    }

    function renderGames(data) {
        if (!data.games.length) {
            progressPanel.hidden = true;
            message.textContent = data.message || 'No upcoming games were found in the schedule feed.';
            tableBody.innerHTML = '<tr><td colspan="9">No upcoming games were found in the schedule feed.</td></tr>';
            return;
        }

        const invalid = data.games.some((game) => !game?.schedule?.away_team || !game?.schedule?.home_team);
        if (invalid) {
            message.textContent = 'The cached forecast is invalid and is being rebuilt.';
            tableBody.innerHTML = '<tr><td colspan="9">Forecast data is invalid. Refreshing the forecast...</td></tr>';
            return;
        }

        progressPanel.hidden = true;
        message.textContent = `Season ${data.season}, week ${data.week}. Each cell shows the market favorite's spread / total. Rothstein values may be stabilized early in the season and Rothstein+ is hidden when ineligible.`;
        tableBody.innerHTML = data.games.map((game) => {
            const schedule = game.schedule;
            const market = marketCell(schedule);
            return `<tr><td>${schedule.away_team} at ${schedule.home_team}<br><small>${schedule.gameday || '--'} ${schedule.gametime || ''}</small></td><td>${market}</td>${['baseline', 'enhanced', 'market_blend', 'mean_reversion', 'rothstein', 'rothstein_plus', 'rsm_stage7c'].map((model) => `<td>${modelCell(game.models[model], schedule)}</td>`).join('')}</tr>`;
        }).join('');
    }

    function adminRefreshToken() {
        const saved = window.sessionStorage.getItem('nflAdminRefreshToken') || '';
        const token = window.prompt('Admin token required to rebuild upcoming predictions. Leave blank to cancel.', saved);
        if (!token) return null;
        window.sessionStorage.setItem('nflAdminRefreshToken', token);
        return token;
    }

    async function loadUpcoming(forceRefresh = false) {
        resetProgress();
        const token = forceRefresh ? adminRefreshToken() : null;
        if (forceRefresh && !token) {
            message.textContent = 'Admin refresh cancelled. Showing the last cached upcoming predictions.';
            return loadUpcoming(false);
        }
        message.textContent = forceRefresh ? 'Admin refresh requested; rebuilding upcoming predictions...' : 'Loading cached upcoming-week forecast...';
        tableBody.innerHTML = '<tr><td colspan="9">Forecast is still being computed...</td></tr>';
        refreshButton.disabled = true;

        const poll = async () => {
            try {
                const url = `${apiBase}/api/nfl/upcoming?scope=upcoming${forceRefresh ? '&refresh=1' : ''}`;
                const response = await fetch(url, forceRefresh ? { headers: { 'X-NFL-Refresh-Token': token } } : undefined);
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load upcoming predictions');

                if (data.ready === false || data.status === 'computing') {
                    showProgress(Math.max(10, Math.min(95, Number(data.progress) || 15)), data.message || 'Forecast is still being computed.');
                    tableBody.innerHTML = '<tr><td colspan="9">Forecast is still being computed...</td></tr>';
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
                tableBody.innerHTML = '<tr><td colspan="9">Unavailable</td></tr>';
            } finally {
                refreshButton.disabled = false;
            }
        };

        await poll();
    }

    refreshButton.addEventListener('click', () => loadUpcoming(true));
    loadUpcoming(false);
});
