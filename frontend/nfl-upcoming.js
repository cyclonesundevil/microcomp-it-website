document.addEventListener('DOMContentLoaded', () => {
    const apiBase = ['5178', '5179', '5180'].includes(window.location.port) ? 'http://127.0.0.1:5010' : '';
    const progressPanel = document.getElementById('upcoming-progress');
    const progressValue = document.getElementById('upcoming-progress-value');
    const progressElapsed = document.getElementById('upcoming-progress-elapsed');
    const progressFill = document.getElementById('upcoming-progress-fill');
    const message = document.getElementById('upcoming-message');
    const cacheStatus = document.getElementById('upcoming-cache-status');
    const tableBody = document.getElementById('upcoming-table-body');
    const signalsGrid = document.getElementById('model-signals-grid');
    const performanceMessage = document.getElementById('weekly-performance-message');
    const performanceBody = document.getElementById('weekly-performance-body');
    const performanceWeekSelect = document.getElementById('weekly-performance-week');
    const refreshButton = document.getElementById('load-upcoming');
    let pollTimer = null;
    let elapsedTimer = null;
    let startedAt = null;
    let displayedSeason = null;

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

    function formatCacheAge(seconds) {
        const age = Number(seconds);
        if (!Number.isFinite(age) || age < 0) return '';
        if (age < 60) return `${Math.round(age)}s old`;
        if (age < 3600) return `${Math.round(age / 60)}m old`;
        if (age < 86400) return `${Math.round(age / 3600)}h old`;
        return `${Math.round(age / 86400)}d old`;
    }

    function formatPercent(value) {
        return value === null || value === undefined ? '--' : `${(Number(value) * 100).toFixed(1)}%`;
    }

    function formatNumber(value) {
        return value === null || value === undefined ? '--' : Number(value).toFixed(2);
    }

    function recordString(wins, losses, pushes, bets) {
        if (!bets) return 'No picks';
        const pushPart = pushes ? `-${pushes}` : '';
        return `${wins}-${losses}${pushPart}`;
    }

    function algorithmLink(model, season) {
        const href = `nfl-algorithm-performance.html?model=${encodeURIComponent(model)}&season=${encodeURIComponent(season)}`;
        return `<a href="${href}">${model}</a>`;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function signalClass(label) {
        const text = String(label || '').toLowerCase();
        if (text.includes('strong') || text.includes('align')) return 'signal-good';
        if (text.includes('moderate') || text.includes('mixed')) return 'signal-neutral';
        if (text.includes('high') || text.includes('split') || text.includes('underdog')) return 'signal-watch';
        return 'signal-muted';
    }

    function formatRange(value) {
        return value === null || value === undefined ? '--' : Number(value).toFixed(1);
    }

    function renderStatusPills(statuses) {
        const entries = Object.entries(statuses || {}).filter(([model]) => model !== 'market');
        if (!entries.length) return '';
        return `<div class="model-status-pills">${entries.map(([model, status]) => `<span class="model-status-pill">${escapeHtml(model)}: ${escapeHtml(status)}</span>`).join('')}</div>`;
    }

    function renderModelSignals(games) {
        if (!signalsGrid) return;
        const rows = (games || []).filter((game) => game && game.schedule && game.model_signals);
        if (!rows.length) {
            signalsGrid.innerHTML = '<article class="model-signal-card"><h3>No model signals available</h3><p>Signals appear when the cached upcoming forecast has model comparison metadata.</p></article>';
            return;
        }
        signalsGrid.innerHTML = rows.map((game) => {
            const schedule = game.schedule;
            const signals = game.model_signals;
            const agreement = escapeHtml(signals.agreement_label);
            const alignment = escapeHtml(signals.market_alignment_label);
            const total = escapeHtml(signals.total_outlook_label);
            return `
                <article class="model-signal-card">
                    <div class="model-signal-card-header">
                        <h3>${escapeHtml(schedule.away_team)} at ${escapeHtml(schedule.home_team)}</h3>
                        <span class="signal-badge ${signalClass(signals.agreement_label)}">${agreement}</span>
                    </div>
                    <p class="model-signal-story">${escapeHtml(signals.story)}</p>
                    <div class="model-signal-badges">
                        <span class="signal-badge ${signalClass(signals.market_alignment_label)}">${alignment}</span>
                        <span class="signal-badge ${signalClass(signals.total_outlook_label)}">${total}</span>
                    </div>
                    <dl class="model-signal-metrics">
                        <div><dt>Spread range</dt><dd>${formatRange(signals.model_spread_range)}</dd></div>
                        <div><dt>Total range</dt><dd>${formatRange(signals.model_total_range)}</dd></div>
                        <div><dt>Favorite view</dt><dd>${Number(signals.models_favoring_market_favorite || 0)}</dd></div>
                        <div><dt>Opposite view</dt><dd>${Number(signals.models_favoring_market_underdog || 0)}</dd></div>
                        <div><dt>No output</dt><dd>${Number(signals.models_without_output || 0)}</dd></div>
                    </dl>
                    ${renderStatusPills(signals.model_statuses)}
                </article>
            `;
        }).join('');
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
            renderModelSignals([]);
            return;
        }

        const invalid = data.games.some((game) => !game?.schedule?.away_team || !game?.schedule?.home_team);
        if (invalid) {
            message.textContent = 'The cached forecast is invalid and is being rebuilt.';
            tableBody.innerHTML = '<tr><td colspan="9">Forecast data is invalid. Refreshing the forecast...</td></tr>';
            renderModelSignals([]);
            return;
        }

        progressPanel.hidden = true;
        const ageLabel = formatCacheAge(data.cache_age_seconds);
        cacheStatus.textContent = data.generated_at
            ? `Forecast board last rebuilt ${formatDateTime(data.generated_at)}${ageLabel ? ` (${ageLabel})` : ''}.`
            : 'Forecast board rebuild timestamp unavailable.';
        message.textContent = data.cache_target_mismatch
            ? `${data.message} Each cell shows the market favorite's spread / total.`
            : `Season ${data.season}, week ${data.week}. Each cell shows the market favorite's spread / total. Rothstein values may be stabilized early in the season and Rothstein+ is hidden when ineligible.`;
        tableBody.innerHTML = data.games.map((game) => {
            const schedule = game.schedule;
            const market = marketCell(schedule);
            return `<tr><td>${schedule.away_team} at ${schedule.home_team}<br><small>${schedule.gameday || '--'} ${schedule.gametime || ''}</small></td><td>${market}</td>${['baseline', 'enhanced', 'market_blend', 'mean_reversion', 'rothstein', 'rothstein_plus', 'rsm_stage7c'].map((model) => `<td>${modelCell(game.models[model], schedule)}</td>`).join('')}</tr>`;
        }).join('');
        renderModelSignals(data.games);
    }

    function renderWeeklyPerformance(performance) {
        const rows = performance?.models || [];
        performanceMessage.textContent = `Season ${performance.season}, week ${performance.week}: ${performance.completed_games} completed game${performance.completed_games === 1 ? '' : 's'} graded so far.`;
        if (!rows.length) {
            performanceBody.innerHTML = '<tr><td colspan="8">No model performance is available yet.</td></tr>';
            return;
        }
        performanceBody.innerHTML = rows.map((row) => {
            const spreadRecord = recordString(row.spread_wins, row.spread_losses, row.spread_pushes, row.spread_bets);
            const totalRecord = recordString(row.total_wins, row.total_losses, row.total_pushes, row.total_bets);
            return `<tr><td>${algorithmLink(row.model, performance.season)}</td><td>${row.completed_games}</td><td>${spreadRecord}</td><td>${formatPercent(row.spread_win_rate)}</td><td>${totalRecord}</td><td>${formatPercent(row.total_win_rate)}</td><td>${formatNumber(row.margin_mae)}</td><td>${formatNumber(row.total_mae)}</td></tr>`;
        }).join('');
    }

    function populatePerformanceWeekSelector(season, displayedWeek) {
        displayedSeason = season;
        const maxWeek = Math.max(1, Number(displayedWeek) || 1);
        const previousSelection = Number(performanceWeekSelect.value);
        const selectedWeek = previousSelection >= 1 && previousSelection <= maxWeek ? previousSelection : maxWeek;
        performanceWeekSelect.innerHTML = Array.from({ length: maxWeek }, (_, index) => {
            const week = index + 1;
            return `<option value="${week}">Week ${week}</option>`;
        }).join('');
        performanceWeekSelect.value = String(selectedWeek);
    }

    async function loadWeeklyPerformance(season, week) {
        if (!season || !week) {
            performanceMessage.textContent = 'Weekly performance unavailable until a season and week are loaded.';
            performanceBody.innerHTML = '<tr><td colspan="8">Unavailable</td></tr>';
            return;
        }
        performanceMessage.textContent = 'Loading weekly performance...';
        performanceBody.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
        try {
            const response = await fetch(`${apiBase}/api/v1/nfl/week-performance?season=${encodeURIComponent(season)}&week=${encodeURIComponent(week)}`);
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load weekly performance');
            renderWeeklyPerformance(data.performance);
        } catch (error) {
            performanceMessage.textContent = `Unable to load weekly performance: ${error.message}`;
            performanceBody.innerHTML = '<tr><td colspan="8">Unavailable</td></tr>';
        }
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

                if (data.ready === false || (data.status === 'computing' && !data.cache_hit)) {
                    showProgress(Math.max(10, Math.min(95, Number(data.progress) || 15)), data.message || 'Forecast is still being computed.');
                    tableBody.innerHTML = '<tr><td colspan="9">Forecast is still being computed...</td></tr>';
                    renderModelSignals([]);
                    pollTimer = window.setTimeout(() => {
                        pollTimer = null;
                        poll();
                    }, 2500);
                    return;
                }

                stopTimers();
                renderGames(data);
                populatePerformanceWeekSelector(data.season, data.week);
                loadWeeklyPerformance(data.season, performanceWeekSelect.value || data.week);
            } catch (error) {
                stopTimers();
                progressPanel.hidden = true;
                message.textContent = `Unable to load upcoming predictions: ${error.message}`;
                tableBody.innerHTML = '<tr><td colspan="9">Unavailable</td></tr>';
                renderModelSignals([]);
            } finally {
                refreshButton.disabled = false;
            }
        };

        await poll();
    }

    performanceWeekSelect.addEventListener('change', () => {
        if (!displayedSeason) return;
        loadWeeklyPerformance(displayedSeason, performanceWeekSelect.value);
    });
    refreshButton.addEventListener('click', () => loadUpcoming(true));
    loadUpcoming(false);
});
