document.addEventListener('DOMContentLoaded', () => {
    const apiBase = ['5178', '5179', '5180'].includes(window.location.port) ? 'http://127.0.0.1:5010' : '';
    const seasonInput = document.getElementById('postgame-season');
    const weekSelect = document.getElementById('postgame-week');
    const refreshButton = document.getElementById('postgame-refresh');
    const message = document.getElementById('postgame-message');
    const partialMessage = document.getElementById('postgame-partial-message');
    const summaryBody = document.getElementById('postgame-summary-body');
    const detailBody = document.getElementById('postgame-detail-body');
    const modelOrder = ['baseline', 'enhanced', 'market_blend', 'mean_reversion', 'rothstein', 'rothstein_plus', 'rsm_stage7c', 'rsm_plus'];
    const modelLabels = {
        baseline: 'Baseline',
        enhanced: 'Enhanced',
        market_blend: 'Market Blend',
        mean_reversion: 'Mean Reversion',
        rothstein: 'Rothstein',
        rothstein_plus: 'Rothstein+',
        rsm_stage7c: 'RSM',
        rsm_plus: 'RSM+',
    };

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function formatPercent(value) {
        return value === null || value === undefined || !Number.isFinite(Number(value))
            ? '--'
            : `${(Number(value) * 100).toFixed(1)}%`;
    }

    function formatRecord(record) {
        if (!record || !record.bets) return 'No picks';
        const pushPart = record.pushes ? `-${record.pushes}` : '';
        return `${record.wins}-${record.losses}${pushPart}`;
    }

    function resultLabel(result) {
        if (!result) return '--';
        if (result === 'win') return 'W';
        if (result === 'loss') return 'L';
        if (result === 'push') return 'P';
        return result;
    }

    function resultClass(result) {
        if (result === 'win') return 'postgame-result-win';
        if (result === 'loss') return 'postgame-result-loss';
        if (result === 'push') return 'postgame-result-push';
        return 'postgame-result-none';
    }

    function signalClass(signal) {
        const value = String(signal || '').toLowerCase();
        if (value === 'positive') return 'postgame-signal-follow';
        if (value.includes('contrary')) return 'postgame-signal-contrary';
        return 'postgame-signal-neutral';
    }

    function renderWeekOptions(selectedWeek) {
        const maxWeek = Math.max(1, Number(selectedWeek) || 1);
        const current = Number(weekSelect.value) || maxWeek;
        weekSelect.innerHTML = Array.from({ length: maxWeek }, (_, index) => {
            const week = index + 1;
            return `<option value="${week}">Week ${week}</option>`;
        }).join('');
        weekSelect.value = String(Math.min(maxWeek, current));
    }

    function renderSummary(grading) {
        const rows = Array.isArray(grading?.algorithms) ? grading.algorithms : [];
        if (!rows.length) {
            const legacyRows = Array.isArray(grading?.rows) ? grading.rows : [];
            if (legacyRows.length) {
                renderLegacySummary(legacyRows);
                return;
            }
            summaryBody.innerHTML = '<tr><td colspan="11">No postgame grading rows are available.</td></tr>';
            return;
        }
        summaryBody.innerHTML = rows.map((row) => `
            <tr>
                <td>${escapeHtml(modelLabels[row.model] || row.model)}</td>
                ${indicatorCells(row.indicators?.ats)}
                ${indicatorCells(row.indicators?.over_under)}
            </tr>
        `).join('');
    }

    function indicatorCells(indicator) {
        if (!indicator) {
            return '<td>--</td><td>--</td><td>--</td><td>--</td><td>--</td>';
        }
        return `
            <td>${escapeHtml(formatRecord(indicator.week))}<br><small>${formatPercent(indicator.week?.win_rate)}</small></td>
            <td>${escapeHtml(formatRecord(indicator.season))}<br><small>${formatPercent(indicator.season?.win_rate)}</small></td>
            <td>${escapeHtml(formatRecord(indicator.last_3_weeks))}<br><small>${formatPercent(indicator.last_3_weeks?.win_rate)}</small></td>
            <td>${formatPercent(indicator.season?.roi_at_minus_110)}</td>
            <td><span class="postgame-signal ${signalClass(indicator.signal)}">${escapeHtml(indicator.signal)}</span><br><small>${Number(indicator.completed_picks || 0)} picks</small></td>
        `;
    }

    function renderLegacySummary(rows) {
        summaryBody.innerHTML = rows.map((row) => `
            <tr>
                <td>${escapeHtml(modelLabels[row.model] || row.model)} ${escapeHtml(row.market)}</td>
                ${indicatorCells(row)}
                <td colspan="5">--</td>
            </tr>
        `).join('');
    }

    function marketCell(game) {
        const spread = Number.isFinite(Number(game.spread_line))
            ? `${Number(game.spread_line) > 0 ? game.home_team : game.away_team} -${Math.abs(Number(game.spread_line)).toFixed(1)}`
            : '--';
        const total = Number.isFinite(Number(game.total_line)) ? Number(game.total_line).toFixed(1) : '--';
        return `${escapeHtml(spread)} / ${total}`;
    }

    function modelResultCell(modelResult) {
        if (!modelResult) return '--';
        const atsResult = modelResult.spread_pick ? modelResult.spread_result : null;
        const totalResult = modelResult.total_pick ? modelResult.total_result : null;
        return `
            <div class="postgame-result-stack">
                <span class="postgame-result ${resultClass(atsResult)}"><b>ATS</b> ${escapeHtml(resultLabel(atsResult))}</span>
                <span class="postgame-result ${resultClass(totalResult)}"><b>O/U</b> ${escapeHtml(resultLabel(totalResult))}</span>
            </div>
        `;
    }

    function renderDetails(games) {
        const rows = Array.isArray(games) ? games : [];
        if (!rows.length) {
            detailBody.innerHTML = '<tr><td colspan="11">No completed games are available for this week yet.</td></tr>';
            return;
        }
        detailBody.innerHTML = rows.map((game) => `
            <tr>
                <td>${escapeHtml(game.away_team)} at ${escapeHtml(game.home_team)}<br><small>${escapeHtml(game.gameday || '--')}</small></td>
                <td>${Number(game.away_score).toFixed(0)}-${Number(game.home_score).toFixed(0)}</td>
                <td>${marketCell(game)}</td>
                ${modelOrder.map((model) => `<td>${modelResultCell(game.models?.[model])}</td>`).join('')}
            </tr>
        `).join('');
    }

    async function loadPostgameGrading() {
        const params = new URLSearchParams();
        if (seasonInput.value) params.set('season', seasonInput.value);
        if (weekSelect.value) params.set('week', weekSelect.value);
        message.textContent = 'Loading postgame grading...';
        partialMessage.textContent = '';
        summaryBody.innerHTML = '<tr><td colspan="11">Loading...</td></tr>';
        detailBody.innerHTML = '<tr><td colspan="11">Loading...</td></tr>';
        refreshButton.disabled = true;
        try {
            const response = await fetch(`${apiBase}/api/v1/nfl/postgame-grading?${params.toString()}`);
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load postgame grading');
            const grading = data.grading || {};
            seasonInput.value = grading.season || seasonInput.value;
            renderWeekOptions(grading.week || weekSelect.value || 1);
            weekSelect.value = String(grading.week || weekSelect.value || 1);
            message.textContent = `Season ${grading.season}, week ${grading.week}: ${grading.completed_games || 0} completed game${grading.completed_games === 1 ? '' : 's'} graded.`;
            partialMessage.textContent = grading.partial_week
                ? 'Week is partially graded. Pending games are excluded until final.'
                : 'Week is fully graded based on available final scores.';
            renderSummary(grading);
            renderDetails(data.game_results || []);
        } catch (error) {
            message.textContent = `Unable to load postgame grading: ${error.message}`;
            summaryBody.innerHTML = '<tr><td colspan="11">Unavailable</td></tr>';
            detailBody.innerHTML = '<tr><td colspan="11">Unavailable</td></tr>';
        } finally {
            refreshButton.disabled = false;
        }
    }

    refreshButton.addEventListener('click', loadPostgameGrading);
    weekSelect.addEventListener('change', loadPostgameGrading);
    seasonInput.addEventListener('change', () => {
        weekSelect.value = '';
        loadPostgameGrading();
    });
    loadPostgameGrading();
});
