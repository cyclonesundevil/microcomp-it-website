document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const secret = params.get('secret') || '';
    const status = document.getElementById('experimental-status');
    const probabilityStatus = document.getElementById('probability-status');
    const probabilityBody = document.getElementById('probability-body');
    const liveModelsBody = document.getElementById('live-models-body');
    const probeBody = document.getElementById('probe-body');
    const pgpGrid = document.getElementById('pgp-grid');
    const parallelModels = document.getElementById('parallel-models');
    const rsmStage7c = document.getElementById('rsm-stage7c');
    const kalshiStatus = document.getElementById('kalshi-status');
    const kalshiSummary = document.getElementById('kalshi-summary');
    const kalshiEdgeBody = document.getElementById('kalshi-edge-body');
    const kalshiModelFilter = document.getElementById('kalshi-model-filter');
    const kalshiThresholdFilter = document.getElementById('kalshi-threshold-filter');
    const kalshiImportJson = document.getElementById('kalshi-import-json');
    const kalshiImportStatus = document.getElementById('kalshi-import-status');
    let kalshiReport = null;

    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
    const num = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '--';
    const pct = (value) => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '--';
    const signed = (value) => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}` : '--';
    const spread = (team, line) => {
        if (!team && Number(line) === 0) return "Pick'em";
        if (!team || !Number.isFinite(Number(line))) return '--';
        return `${team} ${Number(line).toFixed(1)}`;
    };
    const modelLabel = (model) => ({
        rothstein_plus: 'Rothstein+',
        rsm_stage7c: 'RSM',
        rsm_plus: 'RSM+'
    }[model] || model);
    const probabilityModels = ['rothstein_plus', 'rsm_stage7c', 'rsm_plus'];
    const kalshiModelLabels = {
        current_season_matrix: 'CS Matrix',
        market_blend: 'Market Blend',
        rsm_stage7c: 'RSM',
        rsm_plus: 'RSM+'
    };

    function probabilityGameKey(row) {
        return row.game_id || `${row.away_team}-${row.home_team}-${row.gameday || ''}`;
    }

    function totalProbabilityLabel(row) {
        if (!Number.isFinite(Number(row.over_probability))) return '--';
        const over = Number(row.over_probability);
        const under = Number(row.under_probability);
        return over >= under ? `Over ${pct(over)}` : `Under ${pct(under)}`;
    }

    function modelProjectionCell(row) {
        if (!row) return '--';
        const favorite = row.favorite_side === 'home' ? row.home_team : row.favorite_side === 'away' ? row.away_team : null;
        if (!favorite || !Number.isFinite(Number(row.predicted_home_margin))) {
            return row.predicted_total === null || row.predicted_total === undefined ? '--' : `-- / ${num(row.predicted_total, 1)}`;
        }
        const projectedFavoriteSpread = row.favorite_side === 'home'
            ? -Number(row.predicted_home_margin)
            : Number(row.predicted_home_margin);
        return `${esc(spread(favorite, projectedFavoriteSpread))} / ${num(row.predicted_total, 1)}`;
    }

    function probabilityModelCell(row) {
        if (!row) return '--';
        if (row.display_suppressed) return 'Ineligible';
        const adjusted = row.availability_adjusted ? ' *' : '';
        const favoriteProbability = Number.isFinite(Number(row.favorite_cover_probability))
            ? `${pct(row.favorite_cover_probability)}${adjusted}`
            : `--${adjusted}`;
        return `
            <strong>${modelProjectionCell(row)}</strong><br>
            <small>Fav ATS ${favoriteProbability}; ${esc(totalProbabilityLabel(row))}</small>
        `;
    }

    function marketProbabilityCell(row) {
        if (!row) return '--';
        return `${esc(spread(row.favorite_team, row.favorite_spread))} / ${num(row.market_total, 1)}`;
    }

    function groupProbabilityRows(rows) {
        const grouped = new Map();
        rows.forEach((row) => {
            const key = probabilityGameKey(row);
            if (!grouped.has(key)) {
                grouped.set(key, {
                    game_id: row.game_id,
                    away_team: row.away_team,
                    home_team: row.home_team,
                    gameday: row.gameday,
                    gametime: row.gametime,
                    market_row: row,
                    models: {}
                });
            }
            grouped.get(key).models[row.model] = row;
        });
        return Array.from(grouped.values());
    };

    function apiUrl(path) {
        const url = new URL(path, window.location.origin);
        if (secret) url.searchParams.set('secret', secret);
        return url.toString();
    }

    function metricTable(rows, columns) {
        if (!Array.isArray(rows) || !rows.length) return '<p class="nfl-message">No metrics available.</p>';
        return `
            <div class="experimental-table-wrap">
                <table class="nfl-table experimental-table">
                    <thead>
                        <tr>${columns.map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr>
                    </thead>
                    <tbody>
                        ${rows.map((row) => `
                            <tr>
                                ${columns.map((column) => `<td>${esc(column.format ? column.format(row[column.key]) : row[column.key])}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderLiveModels(models) {
        liveModelsBody.innerHTML = models.map((model) => `
            <tr>
                <td><strong>${esc(model.label)}</strong><br><small>${esc(model.id)}</small></td>
                <td>${esc(model.family)}</td>
                <td>${esc(model.surface)}</td>
                <td>${num(model.spread_threshold, 1)}</td>
                <td>${num(model.total_threshold, 1)}</td>
                <td>${esc(model.notes)}</td>
            </tr>
        `).join('');
    }

    function renderCurrentWeekProbabilities(section) {
        const rows = Array.isArray(section?.rows) ? section.rows : [];
        if (!rows.length) {
            probabilityStatus.textContent = 'No current-week probability rows are available yet.';
            probabilityBody.innerHTML = '<tr><td colspan="5">No current-week probabilities available.</td></tr>';
            return;
        }
        probabilityStatus.textContent = `Season ${esc(section.season)}, week ${esc(section.week)}. Top line matches Upcoming Week projection format; small text adds model-implied favorite ATS and total probabilities.`;
        probabilityBody.innerHTML = groupProbabilityRows(rows).map((game) => {
            return `
                <tr>
                    <td>
                        ${esc(game.away_team)} at ${esc(game.home_team)}<br>
                        <small>${esc(game.gameday || '--')} ${esc(game.gametime || '')}</small>
                    </td>
                    <td>${marketProbabilityCell(game.market_row)}</td>
                    ${probabilityModels.map((model) => `<td title="${esc(modelLabel(model))}">${probabilityModelCell(game.models[model])}</td>`).join('')}
                </tr>
            `;
        }).join('');
    }

    function renderPgp(items) {
        pgpGrid.innerHTML = items.map((item) => `
            <article class="experimental-card">
                <div>
                    <span class="paper-label">${esc(item.family)}</span>
                    <h3>${esc(item.label)}</h3>
                    <p>${esc(item.surface)} - ${esc(item.games_evaluated)} games - ${esc(item.configuration?.simulations)} sims</p>
                </div>
                ${metricTable(item.metrics, [
                    { key: 'tier', label: 'Tier' },
                    { key: 'score_mae', label: 'Score MAE', format: num },
                    { key: 'margin_mae', label: 'Margin MAE', format: num },
                    { key: 'total_mae', label: 'Total MAE', format: num },
                    { key: 'home_win_brier', label: 'Brier', format: num },
                    { key: 'total_interval_80_coverage', label: 'Total 80%', format: pct },
                    { key: 'margin_interval_80_coverage', label: 'Margin 80%', format: pct }
                ])}
            </article>
        `).join('');
    }

    function renderParallel(section) {
        if (!section) {
            parallelModels.innerHTML = '<p class="nfl-message">No parallel-model artifact found.</p>';
            return;
        }
        parallelModels.innerHTML = `
            <div class="experimental-summary-row">
                <div><span>Period</span><strong>${esc(section.period)}</strong></div>
                <div><span>Games</span><strong>${esc(section.games_evaluated)}</strong></div>
                <div><span>Rows</span><strong>${esc(section.prediction_rows)}</strong></div>
            </div>
            ${metricTable(section.metrics, [
                { key: 'model_name', label: 'Model' },
                { key: 'margin_mae', label: 'Margin MAE', format: num },
                { key: 'total_score_mae', label: 'Total MAE', format: num },
                { key: 'margin_rmse', label: 'Margin RMSE', format: num },
                { key: 'total_score_rmse', label: 'Total RMSE', format: num },
                { key: 'avg_sample_drives', label: 'Sample Drives', format: num }
            ])}
        `;
    }

    function renderRsm(section) {
        if (!section) {
            rsmStage7c.innerHTML = '<p class="nfl-message">No RSM Stage 7C artifact found.</p>';
            return;
        }
        rsmStage7c.innerHTML = `
            <div class="experimental-summary-row">
                <div><span>Version</span><strong>${esc(section.model_version)}</strong></div>
                <div><span>Validation Games</span><strong>${esc(section.scope?.validation_games)}</strong></div>
                <div><span>All ATS</span><strong>${pct(section.all_games?.ats_accuracy)}</strong></div>
                <div><span>Production Ready</span><strong>${section.production_ready ? 'Yes' : 'No'}</strong></div>
            </div>
            ${metricTable(section.rules, [
                { key: 'rule', label: 'Rule' },
                { key: 'games', label: 'Games' },
                { key: 'wins', label: 'Wins' },
                { key: 'losses', label: 'Losses' },
                { key: 'pushes', label: 'Pushes' },
                { key: 'ats_accuracy', label: 'ATS', format: pct },
                { key: 'validation_coverage', label: 'Coverage', format: pct },
                { key: 'threshold', label: 'Threshold', format: num }
            ])}
        `;
    }

    function renderKalshiSummary(report) {
        const backtest = report?.backtest || {};
        const calibrations = Object.values(report?.calibrations || {});
        const lowConfidence = calibrations.filter((item) => item.fallback_used).length;
        kalshiSummary.innerHTML = `
            <div><span>Snapshots</span><strong>${esc(report?.snapshot_count ?? 0)}</strong></div>
            <div><span>Latest Import</span><strong>${esc(report?.latest_import_observed_at || 'None')}</strong></div>
            <div><span>Trades</span><strong>${esc(backtest.trades_triggered ?? 0)}</strong></div>
            <div><span>ROI</span><strong>${pct(backtest.roi)}</strong></div>
            <div><span>Low-Cal Models</span><strong>${esc(lowConfidence)}</strong></div>
        `;
    }

    function kalshiSideLabel(row, prefix) {
        const home = row[`${prefix}_home_win_probability`];
        const away = row[`${prefix}_away_win_probability`];
        if (!Number.isFinite(Number(home)) || !Number.isFinite(Number(away))) return '--';
        return Number(home) >= Number(away)
            ? `${esc(row.home_team)} ${pct(home)}`
            : `${esc(row.away_team)} ${pct(away)}`;
    }

    function renderKalshiEdgeRows() {
        const threshold = Number(kalshiThresholdFilter?.value || 0.03);
        const model = kalshiModelFilter?.value || '';
        const rows = (kalshiReport?.rows || [])
            .filter((row) => Number(row.threshold) === threshold)
            .filter((row) => !model || row.model === model);
        if (!rows.length) {
            kalshiEdgeBody.innerHTML = '<tr><td colspan="6">No Kalshi edge rows at this filter. Import snapshots or change filters.</td></tr>';
            return;
        }
        kalshiEdgeBody.innerHTML = rows.map((row) => {
            const edge = row.recommended_side === 'home_win' ? row.home_edge : row.recommended_side === 'away_win' ? row.away_edge : Math.max(row.home_edge || 0, row.away_edge || 0);
            const signal = row.recommended_side
                ? `${esc(row.recommended_team)} at ${pct(edge)} edge`
                : 'No trade';
            const pl = Number.isFinite(Number(row.simulated_profit)) ? `; P/L ${signed(row.simulated_profit)}` : '';
            return `
                <tr>
                    <td>${esc(row.away_team)} at ${esc(row.home_team)}<br><small>${esc(row.gameday || '--')} ${esc(row.gametime || '')}</small></td>
                    <td>${esc(kalshiModelLabels[row.model] || row.model)}<br><small>cal n=${esc(row.calibration_sample_size ?? 0)} ${esc(row.calibration_confidence || 'low')}</small></td>
                    <td>${kalshiSideLabel(row, 'kalshi')}</td>
                    <td>${kalshiSideLabel(row, 'model')}</td>
                    <td>${signed(row.home_edge)} home<br><small>${signed(row.away_edge)} away</small></td>
                    <td><strong>${signal}</strong><br><small>${esc(row.roster_overlay_applied ? 'Roster overlay applied' : 'No roster overlay')}${esc(pl)}</small></td>
                </tr>
            `;
        }).join('');
    }

    async function loadKalshiEdge() {
        if (!kalshiStatus || !kalshiEdgeBody) return;
        kalshiStatus.textContent = 'Loading Kalshi Edge Lab...';
        try {
            const response = await fetch(apiUrl('/api/nfl/experimental/kalshi-edge'));
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load Kalshi edge analysis');
            kalshiReport = data;
            kalshiStatus.textContent = `Season ${data.season}, week ${data.week}. ${data.warning}`;
            renderKalshiSummary(data);
            renderKalshiEdgeRows();
        } catch (error) {
            kalshiStatus.textContent = error.message;
            kalshiSummary.innerHTML = '';
            kalshiEdgeBody.innerHTML = '<tr><td colspan="6">Kalshi Edge Lab unavailable.</td></tr>';
        }
    }

    async function importKalshiSnapshot() {
        kalshiImportStatus.textContent = 'Importing...';
        try {
            const payload = JSON.parse(kalshiImportJson.value || '{}');
            const response = await fetch(apiUrl('/api/nfl/experimental/kalshi-edge/import'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Import failed');
            kalshiImportStatus.textContent = `Imported ${data.imported}; ${data.total_snapshots} stored.`;
            await loadKalshiEdge();
        } catch (error) {
            kalshiImportStatus.textContent = error.message;
        }
    }

    async function loadInventory() {
        try {
            const response = await fetch(apiUrl('/api/nfl/experimental-models'));
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load experimental models');
            status.textContent = data.notes?.[0] || 'Protected model inventory loaded.';
            renderCurrentWeekProbabilities(data.current_week_probabilities);
            renderLiveModels(data.live_experimental_models || []);
            renderPgp(data.research_models?.pgp || []);
            renderParallel(data.research_models?.parallel);
            renderRsm(data.research_models?.rsm_stage7c);
            loadKalshiEdge();
        } catch (error) {
            status.textContent = error.message;
            probabilityStatus.textContent = 'Unable to load current-week probabilities.';
            probabilityBody.innerHTML = '<tr><td colspan="5">Unavailable</td></tr>';
            liveModelsBody.innerHTML = '<tr><td colspan="6">Unable to load protected model inventory.</td></tr>';
        }
    }

    async function runProbe() {
        const away = document.getElementById('exp-away').value.trim().toUpperCase();
        const home = document.getElementById('exp-home').value.trim().toUpperCase();
        const spread = document.getElementById('exp-spread').value;
        const total = document.getElementById('exp-total').value;
        const url = new URL(apiUrl('/api/nfl/experimental-models/predict'));
        url.searchParams.set('away_team', away);
        url.searchParams.set('home_team', home);
        if (spread !== '') url.searchParams.set('spread_line', spread);
        if (total !== '') url.searchParams.set('total_line', total);
        probeBody.innerHTML = '<tr><td colspan="6">Running...</td></tr>';
        try {
            const response = await fetch(url.toString());
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Unable to run matchup probe');
            const rows = data.models || [];
            probeBody.innerHTML = rows.length ? rows.map((model) => `
                <tr>
                    <td><strong>${esc(model.model)}</strong></td>
                    <td>${signed(model.pred_margin)}</td>
                    <td>${num(model.pred_total, 1)}</td>
                    <td>${signed(model.spread_edge)}</td>
                    <td>${signed(model.total_edge)}</td>
                    <td>${esc(model.spread_pick || 'none')} / ${esc(model.total_pick || 'none')}</td>
                </tr>
            `).join('') : '<tr><td colspan="6">No experimental predictions returned.</td></tr>';
        } catch (error) {
            probeBody.innerHTML = `<tr><td colspan="6">${esc(error.message)}</td></tr>`;
        }
    }

    document.getElementById('exp-run').addEventListener('click', runProbe);
    document.getElementById('kalshi-refresh')?.addEventListener('click', loadKalshiEdge);
    document.getElementById('kalshi-import')?.addEventListener('click', importKalshiSnapshot);
    kalshiModelFilter?.addEventListener('change', renderKalshiEdgeRows);
    kalshiThresholdFilter?.addEventListener('change', renderKalshiEdgeRows);
    loadInventory();
});
