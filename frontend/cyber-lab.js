document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const E = window.CyberLabEngine;
    const $ = selector => document.querySelector(selector);
    const stages = ['Baseline', 'Initial activity', 'Escalation', 'Detection & response', 'Outcome'];
    let selectedScenario = 'dos';
    let state;
    let timer = null;
    let priorReport = null;

    const nodePositions = {
        internet: [10, 23], actor: [10, 75], edge: [31, 48], web: [51, 25], email: [51, 48],
        identity: [51, 73], workstation: [72, 73], database: [72, 24], files: [90, 32], soc: [90, 72]
    };
    const icon = { cloud: '☁', actor: '◉', gateway: '◆', server: '▰', identity: '◇', email: '✉', endpoint: '▱', database: '▤', monitor: '◎' };

    function readConfig() {
        return {
            scenarioId: selectedScenario,
            difficulty: $('#difficulty')?.value || 'Beginner',
            mode: $('#mode')?.value || 'guided',
            seed: Number($('#seed')?.value) || 4242,
            defenses: state ? state.defenses : {}
        };
    }

    function buildScenarioList(query = '') {
        const normalized = query.toLowerCase().trim();
        const items = E.SCENARIOS.filter(s => `${s.title} ${s.category} ${s.objective}`.toLowerCase().includes(normalized));
        $('#scenario-list').innerHTML = items.map(s => `
            <button class="scenario-card ${s.id === selectedScenario ? 'selected' : ''}" role="option" aria-selected="${s.id === selectedScenario}" data-scenario="${s.id}">
                <span>${escapeHtml(s.category)}</span><strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.duration)}</small>
            </button>`).join('') || '<p class="empty-state">No scenarios match that filter.</p>';
        document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
            selectedScenario = button.dataset.scenario;
            stopTimer();
            state = E.initialState(readConfig());
            buildScenarioList($('#scenario-search').value);
            buildDefenses();
            render();
        }));
    }

    function buildDefenses() {
        $('#defense-list').innerHTML = Object.entries(E.DEFENSES).map(([id, details]) => `
            <label class="defense-control ${state.scenario.defenses.includes(id) ? 'recommended' : ''}">
                <input type="checkbox" data-defense="${id}" ${state.defenses[id] ? 'checked' : ''}>
                <span><strong>${escapeHtml(details[0])}${state.scenario.defenses.includes(id) ? '<em>Relevant</em>' : ''}</strong><small>${escapeHtml(details[1])}</small><small class="tradeoff">${escapeHtml(details[2])}</small></span>
            </label>`).join('');
        document.querySelectorAll('[data-defense]').forEach(input => input.addEventListener('change', () => {
            state = E.reducer(state, { type: 'DEFENSE', id: input.dataset.defense, enabled: input.checked });
            announce(`${E.DEFENSES[input.dataset.defense][0]} ${input.checked ? 'enabled' : 'disabled'}.`);
            render();
        }));
    }

    function buildTopology() {
        const lines = [
            ['internet', 'edge'], ['actor', 'edge'], ['edge', 'web'], ['edge', 'email'], ['edge', 'identity'],
            ['web', 'database'], ['email', 'workstation'], ['identity', 'workstation'], ['workstation', 'files'],
            ['web', 'soc'], ['identity', 'soc'], ['files', 'soc']
        ];
        const svgLines = lines.map(([a, b]) => {
            const [x1, y1] = nodePositions[a], [x2, y2] = nodePositions[b];
            return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
        }).join('');
        const flowLines = state.flows.slice(0, 8).map((flow, i) => {
            const a = nodePositions[flow.source.id], b = nodePositions[flow.destination.id];
            if (!a || !b) return '';
            return `<line class="active-flow severity-${flow.severity}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" style="--delay:${i * -.18}s"></line>`;
        }).join('');
        const nodes = state.hosts.map(host => {
            const [x, y] = nodePositions[host.id];
            return `<button class="topology-node status-${host.status}" style="left:${x}%;top:${y}%" data-host="${host.id}" aria-label="${escapeHtml(host.name)}, ${host.ip}, status ${host.status}">
                <span aria-hidden="true">${icon[host.type] || '●'}</span><strong>${escapeHtml(host.name)}</strong><small>${host.ip}</small>
            </button>`;
        }).join('');
        $('#topology').innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g class="topology-links">${svgLines}</g><g class="flow-links">${flowLines}</g></svg>${nodes}`;
        document.querySelectorAll('[data-host]').forEach(button => button.addEventListener('click', () => inspectHost(button.dataset.host)));
    }

    function inspectHost(id) {
        const host = state.hosts.find(item => item.id === id);
        const related = state.events.filter(event => event.source.id === id || event.destination.id === id).length;
        $('#inspector-copy').innerHTML = `<strong>${escapeHtml(host.name)}</strong><span>${host.ip} · ${host.type}</span><p>Status: ${host.status}. ${related} synthetic event${related === 1 ? '' : 's'} involve this host. Documentation-only address; no connection is made.</p>`;
    }

    function render() {
        const s = state.scenario;
        $('#brief-title').textContent = s.title;
        $('#brief-objective').textContent = `Objective: ${s.objective}`;
        $('#brief-category').textContent = s.category;
        $('#brief-duration').textContent = s.duration;
        $('#brief-indicators').textContent = s.indicators;
        $('#stage-count').textContent = `${state.phase + 1} / 5`;
        $('#stage-list').innerHTML = stages.map((name, index) => `<li class="${index < state.phase ? 'done' : index === state.phase ? 'active' : ''}"><span>${index + 1}</span>${name}</li>`).join('');
        const guideText = state.config.mode === 'free-play'
            ? 'Free play hides step-by-step prompts. Select any host or flow to inspect it.'
            : guidedCopy();
        $('#guide-card').hidden = state.config.mode === 'free-play';
        $('#guide-copy').textContent = guideText;
        $('#run-status').textContent = `${capitalize(state.status)} · ${state.tick}/20`;
        $('#run-status').className = `status-pill status-${state.status}`;
        $('#metric-rps').textContent = state.metrics.rps.toLocaleString();
        $('#metric-latency').textContent = `${state.metrics.latency} ms`;
        $('#metric-errors').textContent = `${state.metrics.errors}%`;
        $('#metric-availability').textContent = `${state.metrics.availability}%`;
        $('#topology-summary').textContent = `${s.title}: virtual tick ${state.tick}, ${state.alerts.length} alerts, risk ${state.metrics.risk} out of 100.`;
        buildTopology();
        renderCharts();
        renderProtocols();
        renderAlerts();
        renderFlows();
        renderReport();
        $('#pause').textContent = state.status === 'paused' ? 'Resume' : 'Pause';
        $('#export-json').disabled = !state.findings;
        $('#export-csv').disabled = !state.findings;
    }

    function guidedCopy() {
        const copy = [
            'Observe the calm baseline. Check the normal request rate and healthy host states.',
            `Watch for the first indicator: ${state.scenario.indicators}`,
            'Compare the changing metrics. Select an active flow to understand why it matters.',
            `Try one relevant control: ${state.scenario.defenses.map(id => E.DEFENSES[id][0]).join(', ')}.`,
            'Review which controls helped and what residual risk remains in the findings report.'
        ];
        return copy[state.phase];
    }

    function renderCharts() {
        const history = state.history.length ? state.history : [{ tick: 0, ...state.metrics }];
        drawLines($('#rps-chart'), history, [{ key: 'rps', className: 'chart-primary' }]);
        drawLines($('#health-chart'), history, [{ key: 'latency', className: 'chart-primary' }, { key: 'errors', className: 'chart-danger' }]);
        $('#chart-rps-summary').textContent = `Current: ${state.metrics.rps.toLocaleString()} rps`;
        $('#chart-health-summary').textContent = `${state.metrics.latency} ms · ${state.metrics.errors}% errors`;
    }

    function drawLines(svg, data, series) {
        const width = 440, height = 130, pad = 12;
        const max = Math.max(1, ...series.flatMap(item => data.map(row => row[item.key])));
        const grid = [0.25, 0.5, 0.75].map(p => `<line class="chart-grid" x1="0" y1="${height * p}" x2="${width}" y2="${height * p}"></line>`).join('');
        const paths = series.map(item => {
            const points = data.map((row, index) => {
                const x = data.length === 1 ? pad : pad + index * ((width - pad * 2) / (data.length - 1));
                const y = height - pad - (row[item.key] / max) * (height - pad * 2);
                return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
            return `<path class="${item.className}" d="${points}"></path>`;
        }).join('');
        svg.innerHTML = `${grid}${paths}`;
    }

    function renderProtocols() {
        const counts = {};
        E.PROTOCOLS.forEach(p => { counts[p] = state.events.filter(e => e.protocol === p).length; });
        const max = Math.max(1, ...Object.values(counts));
        $('#protocol-chart').innerHTML = Object.entries(counts).map(([name, count]) => `<div class="protocol-row"><span>${name}</span><div><i style="width:${count / max * 100}%"></i></div><strong>${count}</strong></div>`).join('');
    }

    function renderAlerts() {
        $('#alert-count').textContent = `${state.alerts.length} alert${state.alerts.length === 1 ? '' : 's'}`;
        $('#alert-list').innerHTML = state.alerts.length ? state.alerts.slice(0, 10).map(alert => `
            <li class="severity-${alert.severity}"><time>${alert.time}</time><div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.explanation)}</span></div></li>`).join('')
            : '<li class="empty-state">Alerts appear here as the virtual clock advances.</li>';
    }

    function filteredEvents() {
        const protocol = $('#filter-protocol').value, severity = $('#filter-severity').value;
        const src = $('#filter-source').value.toLowerCase(), dst = $('#filter-destination').value.toLowerCase();
        const windowSize = Number($('#filter-time').value);
        return state.events.filter(event =>
            (!protocol || event.protocol === protocol) &&
            (!severity || event.severity === severity) &&
            (!src || `${event.source.name} ${event.source.ip}`.toLowerCase().includes(src)) &&
            (!dst || `${event.destination.name} ${event.destination.ip}`.toLowerCase().includes(dst)) &&
            (!windowSize || event.tick > state.tick - windowSize)
        );
    }

    function renderFlows() {
        const events = filteredEvents();
        $('#flow-table').innerHTML = events.length ? events.map(event => `
            <tr tabindex="0" data-event="${event.id}" aria-label="Inspect flow at ${event.time}">
                <td>${event.time}</td><td>${escapeHtml(event.source.name)}<small>${event.source.ip}</small></td><td>${escapeHtml(event.destination.name)}<small>${event.destination.ip}</small></td><td>${event.protocol}</td><td>${event.action}</td><td>${event.latency} ms</td><td><span class="severity-tag severity-${event.severity}">${event.severity}</span></td>
            </tr>`).join('') : '<tr><td colspan="7" class="empty-state">No synthetic flows match these filters.</td></tr>';
        document.querySelectorAll('[data-event]').forEach(row => {
            const inspect = () => {
                const event = state.events.find(item => item.id === row.dataset.event);
                $('#inspector-copy').innerHTML = `<strong>${escapeHtml(event.marker)}</strong><span>${event.source.name} → ${event.destination.name}</span><p>${escapeHtml(event.explanation)}</p>`;
            };
            row.addEventListener('click', inspect);
            row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') inspect(); });
        });
    }

    function renderReport() {
        if (!state.findings) return;
        const r = state.findings;
        $('#report-empty').hidden = true;
        $('#report-content').hidden = false;
        const comparison = priorReport ? `<div><span>Previous peak risk</span><strong>${priorReport.peakRisk}</strong><small>${r.peakRisk < priorReport.peakRisk ? 'Lower in this run' : r.peakRisk > priorReport.peakRisk ? 'Higher in this run' : 'No change'}</small></div>` : '';
        $('#report-content').innerHTML = `
            <div class="report-score"><span>Residual risk</span><strong>${r.residualRisk}<small>/100</small></strong><p>${r.blockedEvents} events blocked · seed ${r.seed}</p></div>
            <div class="report-findings">
                <div><span>Attacker objective</span><strong>${escapeHtml(r.objective)}</strong></div>
                <div><span>Observable indicators &amp; why alerts fired</span><strong>${escapeHtml(r.indicators)}</strong></div>
                <div><span>Affected assets</span><strong>${r.affectedAssets.map(escapeHtml).join(', ')}</strong></div>
                <div><span>Controls that helped</span><strong>${r.controlsHelped.length ? r.controlsHelped.map(escapeHtml).join(', ') : 'None enabled'}</strong></div>
                <div><span>Coverage gaps / controls not enabled</span><strong>${r.controlsNotEnabled.map(escapeHtml).join(', ')}</strong></div>
                <div><span>Recommended remediation</span><strong>${escapeHtml(r.recommendation)}</strong></div>${comparison}
            </div>`;
    }

    function advance() {
        state = E.reducer(state, { type: 'STEP' });
        render();
        if (state.status === 'complete') {
            stopTimer();
            announce(`Simulation complete. Residual risk ${state.findings.residualRisk} out of 100.`);
        } else if ([4, 8, 12, 16].includes(state.tick)) announce(`Teaching checkpoint: ${guidedCopy()}`);
    }

    function start() {
        if (state.status === 'complete') state = E.initialState(readConfig());
        state.status = 'running';
        stopTimer();
        advance();
        if (state.status !== 'complete') timer = window.setInterval(advance, Number($('#speed').value));
        announce(`${state.scenario.title} simulation started.`);
    }

    function stopTimer() {
        if (timer) window.clearInterval(timer);
        timer = null;
    }

    function reset() {
        stopTimer();
        if (state.findings) priorReport = state.findings;
        state = E.initialState(readConfig());
        buildDefenses();
        render();
        announce('Simulation reset.');
    }

    function download(format) {
        if (!state.findings) return;
        let content, type, extension;
        if (format === 'json') {
            content = JSON.stringify(state.findings, null, 2); type = 'application/json'; extension = 'json';
        } else {
            const header = ['time', 'source', 'destination', 'protocol', 'action', 'severity', 'marker'];
            const quote = value => `"${String(value).replaceAll('"', '""')}"`;
            content = [header.join(','), ...state.findings.events.map(e => [e.time, e.source.ip, e.destination.ip, e.protocol, e.action, e.severity, e.marker].map(quote).join(','))].join('\n');
            type = 'text/csv'; extension = 'csv';
        }
        const blob = new Blob([content], { type });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `microcompit-synthetic-${state.scenario.id}-report.${extension}`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function announce(message) { $('#live-region').textContent = message; }
    function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
    function escapeHtml(value) {
        const div = document.createElement('div'); div.textContent = String(value); return div.innerHTML;
    }

    state = E.initialState(readConfig());
    $('#scenario-search').addEventListener('input', event => buildScenarioList(event.target.value));
    ['difficulty', 'mode'].forEach(id => $(`#${id}`).addEventListener('change', reset));
    $('#seed').addEventListener('change', reset);
    $('#speed').addEventListener('change', () => { if (state.status === 'running') start(); });
    $('#start').addEventListener('click', start);
    $('#pause').addEventListener('click', () => {
        if (state.status === 'running') { stopTimer(); state = E.reducer(state, { type: 'PAUSE' }); }
        else if (state.status === 'paused') { state = E.reducer(state, { type: 'RESUME' }); timer = window.setInterval(advance, Number($('#speed').value)); }
        render();
    });
    $('#step').addEventListener('click', () => { stopTimer(); advance(); if (state.status !== 'complete') state.status = 'paused'; render(); });
    $('#reset').addEventListener('click', reset);
    $('#replay').addEventListener('click', () => { reset(); start(); });
    $('#reduced-motion').addEventListener('change', event => {
        document.body.classList.toggle('reduce-motion', event.target.checked);
        localStorage.setItem('microcompCyberReducedMotion', event.target.checked ? 'true' : 'false');
    });
    ['filter-protocol', 'filter-source', 'filter-destination', 'filter-severity', 'filter-time'].forEach(id => $(`#${id}`).addEventListener('input', renderFlows));
    $('#export-json').addEventListener('click', () => download('json'));
    $('#export-csv').addEventListener('click', () => download('csv'));
    E.PROTOCOLS.forEach(protocol => $('#filter-protocol').insertAdjacentHTML('beforeend', `<option>${protocol}</option>`));
    const reduced = localStorage.getItem('microcompCyberReducedMotion') === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('#reduced-motion').checked = reduced;
    document.body.classList.toggle('reduce-motion', reduced);
    buildScenarioList();
    buildDefenses();
    render();
});
