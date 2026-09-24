document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const secret = params.get('secret') || '';
    const status = document.getElementById('experimental-status');
    const liveModelsBody = document.getElementById('live-models-body');
    const probeBody = document.getElementById('probe-body');
    const pgpGrid = document.getElementById('pgp-grid');
    const parallelModels = document.getElementById('parallel-models');
    const rsmStage7c = document.getElementById('rsm-stage7c');

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

    async function loadInventory() {
        try {
            const response = await fetch(apiUrl('/api/nfl/experimental-models'));
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load experimental models');
            status.textContent = data.notes?.[0] || 'Protected model inventory loaded.';
            renderLiveModels(data.live_experimental_models || []);
            renderPgp(data.research_models?.pgp || []);
            renderParallel(data.research_models?.parallel);
            renderRsm(data.research_models?.rsm_stage7c);
        } catch (error) {
            status.textContent = error.message;
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
    loadInventory();
});
