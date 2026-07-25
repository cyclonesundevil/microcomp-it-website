document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const E = window.CyberLabEngine;
    const $ = selector => document.querySelector(selector);
    let selectedScenario = 'dos';
    let state;
    let timer = null;
    let comparisonReport = null;

    const nodePositions = {
        internet: [8, 18], actor: [8, 45], actor2: [8, 56], actor3: [8, 67], actor4: [8, 78], actor5: [8, 89],
        upstream: [22, 52], edge: [39, 52], loadbalancer: [55, 40], web: [72, 24], email: [55, 63],
        identity: [55, 80], workstation: [73, 80], database: [90, 20], files: [90, 49], soc: [90, 80]
    };
    const icon = { cloud: '☁', shield: 'UP', actor: '◉', gateway: '◆', server: '▰', identity: '◇', email: '✉', endpoint: '▱', database: '▤', monitor: '◎' };

    function readConfig() {
        return {
            scenarioId: selectedScenario,
            difficulty: $('#difficulty')?.value || 'Beginner',
            mode: $('#mode')?.value || 'guided',
            seed: Number($('#seed')?.value) || 4242,
            attackType: $('#attack-type')?.value || 'ddos',
            recovery: $('#recovery')?.checked !== false,
            defenses: state ? state.defenses : {}
        };
    }

    function buildScenarioList(query = '') {
        const normalized = query.toLowerCase().trim();
        const items = E.SCENARIOS.filter(s => `${s.title} ${s.category} ${s.objective}`.toLowerCase().includes(normalized));
        $('#scenario-list').innerHTML = items.map(s => `
            <button class="scenario-card ${s.id === selectedScenario ? 'selected' : ''}" role="option" aria-selected="${s.id === selectedScenario}" ${s.id === selectedScenario ? 'aria-current="true"' : ''} data-scenario="${s.id}">
                <span>${escapeHtml(s.category)}</span><strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.duration)}</small>
            </button>`).join('') || '<p class="empty-state">No scenarios match that filter.</p>';
        document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
            selectedScenario = button.dataset.scenario;
            stopTimer();
            clearTransientUi();
            state = E.initialState(readConfig());
            buildScenarioList($('#scenario-search').value);
            buildDefenses();
            render();
        }));
    }

    function buildDefenses() {
        const entries = state.scenario.id === 'dos'
            ? state.scenario.defenses.map(id => [id, E.DEFENSES[id]])
            : Object.entries(E.DEFENSES);
        $('#defense-list').innerHTML = entries.map(([id, details]) => `
            <label class="defense-control ${state.scenario.defenses.includes(id) ? 'recommended' : ''}">
                <input type="checkbox" data-defense="${id}" ${state.defenses[id] ? 'checked' : ''}>
                <span><strong>${escapeHtml(details[0])}${state.scenario.defenses.includes(id) ? '<em>Relevant</em>' : ''}</strong><small>${escapeHtml(details[1])}</small><small class="defense-meta">${escapeHtml(E.DEFENSE_META[id].kind)} · ${escapeHtml(E.DEFENSE_META[id].layer)}</small><small class="tradeoff">${escapeHtml(details[2])}</small></span>
            </label>`).join('');
        document.querySelectorAll('[data-defense]').forEach(input => input.addEventListener('change', () => {
            state = E.reducer(state, { type: 'DEFENSE', id: input.dataset.defense, enabled: input.checked });
            announce(`${E.DEFENSES[input.dataset.defense][0]} ${input.checked ? 'enabled' : 'disabled'}.`);
            render();
        }));
    }

    function buildTopology() {
        const topology = $('#topology');
        topology.classList.toggle('is-paused', state.status === 'paused');
        topology.classList.toggle('is-complete', state.status === 'complete');
        topology.classList.toggle('is-running', state.status === 'running');
        const upstreamVisible = state.scenario.id === 'dos' && state.defenses.upstreamProtection;
        const ingress = upstreamVisible ? 'upstream' : 'edge';
        const actorTarget = state.scenario.id === 'password' ? 'identity' : ingress;
        const passwordSourceCount = state.scenario.id === 'password'
            ? Math.max(1, state.scenarioState?.distinctSources || 1)
            : 0;
        const actorVisible = id => {
            if (id === 'actor') return true;
            const sourceNumber = Number(id.replace('actor', ''));
            return (state.scenario.id === 'dos' && state.config.attackType === 'ddos') ||
                (state.scenario.id === 'password' && sourceNumber <= passwordSourceCount);
        };
        const lines = [
            ['internet', ingress], ['actor', actorTarget], ['actor2', actorTarget], ['actor3', actorTarget], ['actor4', actorTarget], ['actor5', actorTarget],
            ...(upstreamVisible ? [['upstream', 'edge']] : []),
            ['edge', 'loadbalancer'], ['loadbalancer', 'web'], ['edge', 'email'], ['edge', 'identity'],
            ['web', 'database'], ['email', 'workstation'], ['identity', 'workstation'], ['workstation', 'files'],
            ['web', 'soc'], ['identity', 'soc'], ['files', 'soc']
        ];
        const visibleLines = lines.filter(([source]) => !source.match(/^actor[2-5]$/) || actorVisible(source));
        const svgLines = visibleLines.map(([a, b]) => {
            const [x1, y1] = nodePositions[a], [x2, y2] = nodePositions[b];
            return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
        }).join('');
        const flowLines = state.flows.slice(0, 16).map((flow, i) => {
            const a = nodePositions[flow.source.id], b = nodePositions[flow.destination.id];
            if (!a || !b) return '';
            const effectClass = flow.visualEffect ? ` flow-${flow.visualEffect}` : '';
            const interrupted = flow.action === 'scrubbed' ? ' flow-interrupted' : '';
            return `<line class="active-flow severity-${flow.severity}${effectClass}${interrupted}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" style="--delay:${i * -.18}s"></line>`;
        }).join('');
        const visibleHosts = state.hosts.filter(host => {
            if (host.id === 'upstream') return upstreamVisible;
            if (!host.id.match(/^actor[2-5]$/)) return true;
            return actorVisible(host.id);
        });
        const nodes = visibleHosts.map(host => {
            const [x, y] = nodePositions[host.id];
            const nodeEffects = defenseEffectsForHost(host.id);
            const counter = nodeEffects.length
                ? `<em class="topology-counter">${nodeEffects.map(effect => `${effect.name}: ${effect.affected.toLocaleString()} ${effect.action}`).join(' · ')}</em>`
                : '';
            return `<button class="topology-node status-${host.status} ${host.id === 'upstream' ? 'upstream-node' : ''}" style="left:${x}%;top:${y}%" data-host="${host.id}" aria-label="${escapeHtml(host.name)}, ${host.ip}, status ${host.status}${host.id === 'upstream' ? `, ${state.metrics.upstreamFiltered} requests filtered this tick` : ''}">
                <span aria-hidden="true">${icon[host.type] || '●'}</span><strong>${escapeHtml(host.name)}</strong><small>${host.ip}</small>
                ${counter}
            </button>`;
        }).join('');
        $('#topology').innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g class="topology-links">${svgLines}</g><g class="flow-links">${flowLines}</g></svg>${nodes}`;
        document.querySelectorAll('[data-host]').forEach(button => button.addEventListener('click', () => inspectHost(button.dataset.host)));
    }

    function defenseEffectsForHost(hostId) {
        const layers = {
            upstream: ['upstream'],
            edge: ['firewall', 'application-edge', 'network'],
            loadbalancer: ['load-balancer'],
            web: ['service', 'host'],
            identity: ['identity', 'authorization'],
            email: ['gateway'],
            workstation: ['endpoint'],
            files: ['data'],
            soc: ['monitoring']
        };
        return state.activeDefenseEffects.filter(effect => (layers[hostId] || []).includes(effect.layer));
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
        const stages = s.phases || ['Baseline', 'Initial activity', 'Escalation', 'Detection & response', 'Outcome'];
        const totalTicks = s.id === 'dos' ? 24 : s.phases.length * 4;
        $('#stage-count').textContent = `${state.phase + 1} / ${stages.length}`;
        $('#stage-list').innerHTML = stages.map((name, index) => `<li class="${index < state.phase ? 'done' : index === state.phase ? 'active' : ''}"><span>${index + 1}</span>${name}</li>`).join('');
        const guideText = state.config.mode === 'free-play'
            ? 'Free play hides step-by-step prompts. Select any host or flow to inspect it.'
            : guidedCopy();
        $('#guide-card').hidden = state.config.mode === 'free-play';
        $('#guide-copy').textContent = guideText;
        $('#run-status').textContent = `${capitalize(state.status)} · ${state.tick}/${totalTicks}`;
        $('#run-status').className = `status-pill status-${state.status}`;
        $('#metric-rps').textContent = state.metrics.rps.toLocaleString();
        $('#metric-allowed').textContent = (state.metrics.allowed ?? state.metrics.rps).toLocaleString();
        $('#metric-server-rps').textContent = (state.metrics.serverRps ?? state.metrics.allowed ?? state.metrics.rps).toLocaleString();
        $('#metric-blocked').textContent = (state.metrics.blocked ?? 0).toLocaleString();
        $('#metric-latency').textContent = `${state.metrics.latency} ms`;
        $('#metric-errors').textContent = `${state.metrics.errors}%`;
        $('#metric-availability').textContent = `${state.metrics.availability}%`;
        renderScenarioOutcomes();
        $('#topology-summary').textContent = `${s.title}: virtual tick ${state.tick}, ${state.alerts.length} alerts, risk ${state.metrics.risk} out of 100.${state.defenses.upstreamProtection ? ` Upstream filter removed ${state.metrics.upstreamFiltered.toLocaleString()} synthetic requests before the edge.` : ''}`;
        $('#attack-type-field').hidden = s.id !== 'dos';
        $('#recovery-field').hidden = s.id !== 'dos';
        buildTopology();
        updateMotionStatus($('#reduced-motion').checked);
        renderCharts();
        renderProtocols();
        renderDefenseEffects();
        renderAlerts();
        renderFlows();
        renderReport();
        $('#pause').textContent = state.status === 'paused' ? 'Resume' : 'Pause';
        $('#pause').setAttribute('aria-pressed', state.status === 'paused' ? 'true' : 'false');
        $('#pause').setAttribute('aria-label', state.status === 'paused' ? 'Resume simulation activity' : 'Pause simulation activity');
        $('#export-json').disabled = !state.findings;
        $('#export-csv').disabled = !state.findings;
    }

    function guidedCopy() {
        if (state.scenario.id === 'dos') {
            const typeLesson = state.config.attackType === 'ddos'
                ? 'DDoS uses several fictional sources at once, so source-by-source blocking is harder than with a single-source DoS.'
                : 'DoS uses one fictional source. DDoS differs by distributing the same availability pressure across multiple sources.';
            const lessons = [
                typeLesson,
                'As accepted request volume approaches service capacity, requests wait longer. That queueing raises latency before the service fully fails.',
                'A server can remain powered on while users experience failure: excessive delay and error responses make the service effectively unavailable.',
                'Rate limiting rejects requests above a safe threshold. Compare accepted and blocked traffic to see the availability trade-off.',
                'Autoscaling adds capacity after a delay, but it does not remove hostile traffic. Without filtering, the surge can consume every new instance.',
                'Layered defenses work at different points: upstream protection and filtering remove traffic, rate limits cap acceptance, caching offloads work, and autoscaling adds capacity.'
            ];
            const thresholds = [0, 4, 8, 11, 15, 19];
            let index = 0;
            thresholds.forEach((threshold, lessonIndex) => { if (state.tick >= threshold) index = lessonIndex; });
            return lessons[index];
        }
        const networkGuidance = E.scenarioGuidance(state.scenario.id);
        if (networkGuidance) return networkGuidance[state.phase];
        const copy = [
            'Observe the calm baseline. Check the normal request rate and healthy host states.',
            `Watch for the first indicator: ${state.scenario.indicators}`,
            'Compare the changing metrics. Select an active flow to understand why it matters.',
            `Try one relevant control: ${state.scenario.defenses.map(id => E.DEFENSES[id][0]).join(', ')}.`,
            'Review which controls helped and what residual risk remains in the findings report.'
        ];
        return copy[state.phase];
    }

    function renderScenarioOutcomes() {
        const strip = $('#scenario-outcome-strip');
        const inbox = $('#mock-inbox');
        const specializedScenario = ['mitm', 'password', 'eavesdropping', 'sqli', 'xss', 'phishing', 'malware', 'insider', 'zeroday', 'apt'].includes(state.scenario.id);
        const labels = specializedScenario
            ? {
                mitm: ['Session attempts / tick', 'Altered this tick', 'Protected total', 'Defense effects'],
                password: ['Auth attempts / tick', 'Accepted attempts', 'Failed total', 'Blocked this tick'],
                eavesdropping: ['Observed units / tick', 'Observable units', 'Encrypted total', 'Isolated this tick'],
                sqli: ['Marked requests / tick', 'Database-bound', 'Database queries total', 'Rejected this tick'],
                xss: ['Content submissions / tick', 'Application-bound', 'Unsafe renders total', 'Rejected this tick'],
                phishing: ['Mock messages / tick', 'Delivered messages', 'Interactions total', 'Filtered this tick'],
                malware: ['Endpoint events / tick', 'Active events', 'Infected endpoints', 'Controlled this tick'],
                insider: ['Access events / tick', 'Allowed events', 'Baseline deviations', 'Restricted this tick'],
                zeroday: ['Behavior events / tick', 'Impact actions', 'Signature misses', 'Contained this tick'],
                apt: ['Stage actions / tick', 'Allowed actions', 'Collected units', 'Controlled this tick']
            }[state.scenario.id]
            : ['Offered requests / sec', 'Accepted at edge / sec', 'Server-bound / sec', 'Filtered / sec'];
        ['#metric-rps-label', '#metric-allowed-label', '#metric-server-label', '#metric-blocked-label']
            .forEach((selector, index) => { $(selector).textContent = labels[index]; });
        if (!specializedScenario || !state.scenarioState) {
            strip.innerHTML = '<p>Scenario-specific integrity, identity, or confidentiality outcomes appear here.</p>';
            inbox.hidden = true;
            inbox.innerHTML = '';
            return;
        }
        const values = state.scenario.id === 'mitm'
            ? {
                'Route integrity': state.scenarioState.routeIntegrity,
                'Certificate': state.scenarioState.certificateStatus,
                'Altered sessions': state.scenarioState.alteredSessions,
                'Protected sessions': state.scenarioState.protectedSessions
            }
            : state.scenario.id === 'password'
                ? {
                    'Pattern': state.scenarioState.pattern,
                    'Failed attempts': state.scenarioState.failedAttempts,
                    'Locked accounts': state.scenarioState.lockedAccounts,
                    'Prevented takeovers': state.scenarioState.preventedTakeovers
                }
                : state.scenario.id === 'eavesdropping' ? {
                    'Content visibility': state.scenarioState.contentVisibility,
                    'Encrypted units': state.scenarioState.encryptedPackets,
                    'Exposed units': state.scenarioState.exposedPackets,
                    'Isolated units': state.scenarioState.isolatedFlows
                } : state.scenario.id === 'sqli' ? {
                    'Request handling': state.scenarioState.requestHandling,
                    'Rejected requests': state.scenarioState.rejectedRequests,
                    'Database errors': state.scenarioState.databaseErrors,
                    'Records at risk': state.scenarioState.recordsAtRisk
                } : state.scenario.id === 'xss' ? {
                    'Browser policy': state.scenarioState.browserPolicy,
                    'Rejected content': state.scenarioState.rejectedContent,
                    'Unsafe renders': state.scenarioState.unsafeRenders,
                    'Sessions at risk': state.scenarioState.sessionsAtRisk
                } : state.scenario.id === 'phishing' ? {
                    'Campaign variant': state.scenarioState.variant,
                    'Filtered messages': state.scenarioState.filteredMessages,
                    'User interactions': state.scenarioState.interactions,
                    'Protected identities': state.scenarioState.protectedIdentities
                } : state.scenario.id === 'malware' ? {
                    'Endpoint health': state.scenarioState.endpointHealth,
                    'Infected endpoints': state.scenarioState.infectedEndpoints,
                    'Contained events': state.scenarioState.containedEvents,
                    'Isolated spread': state.scenarioState.isolatedSpread
                } : state.scenario.id === 'insider' ? {
                    'Insider variant': state.scenarioState.variant,
                    'Baseline deviations': state.scenarioState.baselineDeviations,
                    'Restricted events': state.scenarioState.restrictedEvents,
                    'Transfer risk': state.scenarioState.transferRisk
                } : state.scenario.id === 'zeroday' ? {
                    'Signature status': state.scenarioState.signatureStatus,
                    'Signature misses': state.scenarioState.signatureMisses,
                    'Anomaly detections': state.scenarioState.anomalyDetections,
                    'Impact actions': state.scenarioState.impactActions
                } : {
                    'APT stage': state.scenarioState.currentStage.replaceAll('-', ' '),
                    'Completed stages': state.scenarioState.completedStages.length,
                    'Collected units': state.scenarioState.collectedUnits,
                    'Exfiltrated units': state.scenarioState.exfiltratedUnits
                };
        strip.innerHTML = Object.entries(values).map(([label, value]) =>
            `<div class="scenario-outcome"><span>${escapeHtml(label)}</span><strong>${typeof value === 'number' ? value.toLocaleString() : escapeHtml(value)}</strong></div>`
        ).join('');
        inbox.hidden = state.scenario.id !== 'phishing';
        inbox.innerHTML = state.scenario.id === 'phishing'
            ? `<div class="mock-inbox-header">Mock inbox · inert metadata only</div>${state.scenarioState.inbox.slice(0, 5).map(message =>
                `<div class="mock-message"><span>${escapeHtml(message.sender)}</span><strong>${escapeHtml(message.subject)}</strong><em>${escapeHtml(message.disposition)}</em></div>`
            ).join('')}`
            : '';
    }

    function renderCharts() {
        const history = state.history.length ? state.history : [{ tick: 0, ...state.metrics }];
        const requestSeries = state.scenario.id === 'dos'
            ? [{ key: 'rps', className: 'chart-primary' }, { key: 'allowed', className: 'chart-secondary' }, { key: 'serverRps', className: 'chart-server' }, { key: 'blocked', className: 'chart-blocked' }]
            : [{ key: 'rps', className: 'chart-primary' }];
        drawLines($('#rps-chart'), history, requestSeries);
        drawLines($('#health-chart'), history, [{ key: 'latency', className: 'chart-primary' }, { key: 'errors', className: 'chart-danger' }]);
        $('#chart-rps-summary').textContent = state.scenario.id === 'dos'
            ? `Offered ${state.metrics.rps.toLocaleString()} · edge ${state.metrics.allowed.toLocaleString()} · server ${state.metrics.serverRps.toLocaleString()} · filtered ${state.metrics.blocked.toLocaleString()}`
            : `Current: ${state.metrics.rps.toLocaleString()} rps`;
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
        E.PROTOCOLS.forEach(p => {
            counts[p] = state.events.filter(e => e.protocol === p).reduce((sum, event) => sum + (event.requests || 1), 0);
        });
        const max = Math.max(1, ...Object.values(counts));
        $('#protocol-chart').innerHTML = Object.entries(counts).map(([name, count]) => `<div class="protocol-row"><span>${name}</span><div><i style="width:${count / max * 100}%"></i></div><strong>${count}</strong></div>`).join('');
    }

    function renderDefenseEffects() {
        const effects = state.activeDefenseEffects;
        $('#defense-effect-strip').innerHTML = effects.length
            ? effects.map(effect => `<div class="defense-effect effect-${effect.kind}"><strong>${escapeHtml(effect.name)}</strong><span>${escapeHtml(effect.action)} ${effect.affected.toLocaleString()} synthetic units at ${escapeHtml(effect.layer)}</span></div>`).join('')
            : '<p>No defense triggered on this virtual tick.</p>';
    }

    function renderAlerts() {
        $('#alert-count').textContent = `${state.alerts.length} alert${state.alerts.length === 1 ? '' : 's'}`;
        $('#alert-list').innerHTML = state.alerts.length ? state.alerts.slice(0, 10).map(alert => `
            <li class="severity-${alert.severity}"><time>${alert.time}</time><div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.explanation)}</span></div></li>`).join('')
            : '<li class="empty-state">Alerts appear here as the virtual clock advances.</li>';
    }

    function filteredEvents() {
        return E.filterEvents(state.events, {
            protocol: $('#filter-protocol').value,
            severity: $('#filter-severity').value,
            source: $('#filter-source').value,
            destination: $('#filter-destination').value,
            timeWindow: $('#filter-time').value
        }, state.tick);
    }

    function renderFlows() {
        const events = filteredEvents();
        $('#flow-table').innerHTML = events.length ? events.map(event => `
            <tr tabindex="0" data-event="${event.id}" aria-label="Inspect flow at ${event.time}">
                <td>${event.time}</td><td>${escapeHtml(event.source.name)}<small>${event.source.ip}</small></td><td>${escapeHtml(event.destination.name)}<small>${event.destination.ip}</small></td><td>${event.protocol}</td><td>${(event.requests ?? 1).toLocaleString()}</td><td>${(event.allowedRequests ?? (event.action === 'blocked' ? 0 : 1)).toLocaleString()}</td><td>${(event.blockedRequests ?? (event.action === 'blocked' ? 1 : 0)).toLocaleString()}</td><td>${event.latency} ms</td><td><span class="severity-tag severity-${event.severity}">${event.severity}</span></td>
            </tr>`).join('') : '<tr><td colspan="9" class="empty-state">No synthetic flows match these filters.</td></tr>';
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
        if (!state.findings) {
            $('#report-empty').hidden = false;
            $('#report-content').hidden = true;
            $('#report-content').innerHTML = '';
            return;
        }
        const r = state.findings;
        $('#report-empty').hidden = true;
        $('#report-content').hidden = false;
        if (state.scenario.id === 'dos') {
            renderDosReport(r);
            return;
        }
        const comparisonResult = E.compareReports(comparisonReport, r);
        const comparison = comparisonResult.comparable
            ? `<div><span>Previous peak risk</span><strong>${comparisonReport.peakRisk}</strong><small>${r.peakRisk < comparisonReport.peakRisk ? 'Lower in this run' : r.peakRisk > comparisonReport.peakRisk ? 'Higher in this run' : 'No change'}</small></div>`
            : '';
        $('#report-content').innerHTML = `
            <div class="report-score"><span>Residual risk</span><strong>${r.residualRisk}<small>/100</small></strong><p>${r.blockedEvents} events blocked · seed ${r.seed}</p></div>
            <div class="report-findings">
                <div><span>Attacker objective</span><strong>${escapeHtml(r.objective)}</strong></div>
                <div><span>Observable indicators &amp; why alerts fired</span><strong>${escapeHtml(r.indicators)}</strong></div>
                <div><span>Affected assets</span><strong>${r.affectedAssets.map(escapeHtml).join(', ')}</strong></div>
                <div><span>Controls that helped</span><strong>${r.controlsHelped.length ? r.controlsHelped.map(escapeHtml).join(', ') : 'None enabled'}</strong></div>
                <div><span>Standardized defense effects</span><strong>${r.defensesTriggered.length ? r.defensesTriggered.map(effect => `${escapeHtml(effect.name)} · ${escapeHtml(effect.kind)} · ${effect.affectedUnits.toLocaleString()} affected`).join('<br>') : 'No defense triggered'}</strong></div>
                <div><span>Coverage gaps / controls not enabled</span><strong>${r.controlsNotEnabled.map(escapeHtml).join(', ')}</strong></div>
                <div><span>Recommended remediation</span><strong>${escapeHtml(r.recommendation)}</strong></div>${comparison}
                ${r.specializedScenario ? `<div><span>Scenario-specific outcomes</span><strong>${Object.entries(r.outcomeMetrics).map(([key, value]) => `${escapeHtml(humanize(key))}: ${typeof value === 'number' ? value.toLocaleString() : escapeHtml(value)}`).join('<br>')}</strong></div>` : ''}
            </div>`;
    }

    function renderDosReport(report) {
        const reportComparison = E.compareReports(comparisonReport, report);
        const comparable = reportComparison.comparable;
        const delta = (current, previous, lowerIsBetter = true) => {
            const difference = current - previous;
            if (difference === 0) return 'No change';
            const improved = lowerIsBetter ? difference < 0 : difference > 0;
            return `${Math.abs(difference).toLocaleString()} ${difference < 0 ? 'lower' : 'higher'} · ${improved ? 'improved' : 'worse'}`;
        };
        const comparison = comparable ? `
            <div><span>Same-seed comparison</span><strong>Peak server RPS: ${delta(report.peakServerRps, comparisonReport.peakServerRps)}<br>Max latency: ${delta(report.maximumLatency, comparisonReport.maximumLatency)}<br>Downtime: ${delta(report.serviceDowntimeSeconds, comparisonReport.serviceDowntimeSeconds)}</strong></div>` :
            '<div><span>Same-seed comparison</span><strong>Replay this seed with different defenses to compare outcomes.</strong></div>';
        const triggered = report.defensesTriggered.length
            ? report.defensesTriggered.map(item => {
                const upstreamDetail = item.id === 'upstreamProtection'
                    ? `; ${item.effectivenessPercent}% effectiveness; +${item.availabilityImprovement} availability points`
                    : '';
                return `${escapeHtml(item.name)} (${item.affectedUnits.toLocaleString()} synthetic units affected${upstreamDetail}; trade-off: ${escapeHtml(item.tradeOff)})`;
            }).join('<br>')
            : 'No defenses triggered';
        $('#report-content').innerHTML = `
            <div class="report-score"><span>Residual risk</span><strong>${report.residualRisk}<small>/100</small></strong><p>${report.attackType} · seed ${report.seed} · ${report.trafficBlocked.toLocaleString()} requests blocked</p></div>
            <div class="report-findings dos-report-findings">
                <div><span>Peak requests / second</span><strong>${report.peakRps.toLocaleString()}</strong></div>
                <div><span>Peak server-bound requests / second</span><strong>${report.peakServerRps.toLocaleString()}</strong></div>
                <div><span>Maximum latency</span><strong>${report.maximumLatency.toLocaleString()} ms</strong></div>
                <div><span>Maximum error rate</span><strong>${report.maximumErrorRate}%</strong></div>
                <div><span>Service downtime</span><strong>${report.serviceDowntimeSeconds} virtual seconds (${report.serviceDowntimeTicks} ticks)</strong></div>
                <div><span>Traffic blocked</span><strong>${report.trafficBlocked.toLocaleString()} synthetic requests</strong></div>
                <div><span>Upstream traffic filtered</span><strong>${report.upstreamTrafficFiltered.toLocaleString()} requests · ${report.upstreamEffectivenessPercent}% effectiveness</strong></div>
                <div><span>Upstream availability improvement</span><strong>+${report.availabilityImprovement} percentage points · ${report.latencyImprovement} ms lower peak latency</strong></div>
                <div><span>Minimum availability</span><strong>${report.minimumAvailability}%</strong></div>
                <div><span>Defenses triggered &amp; trade-offs</span><strong>${triggered}</strong></div>
                <div><span>Missed detections / coverage</span><strong>${report.missedDetections.length ? report.missedDetections.map(escapeHtml).join('<br>') : 'All reference defense layers were enabled.'}</strong></div>
                <div><span>Recommended improvements</span><strong>${escapeHtml(report.recommendation)}</strong></div>
                ${comparison}
            </div>`;
    }

    function advance(actionType = 'TICK') {
        state = E.reducer(state, { type: actionType });
        render();
        if (state.status === 'complete') {
            stopTimer();
            announce(`Simulation complete. Residual risk ${state.findings.residualRisk} out of 100.`);
        } else if (E.shouldAnnounceCheckpoint(state)) {
            announce(`Teaching checkpoint: ${guidedCopy()}`);
        }
    }

    function start() {
        if (state.status === 'complete') reset(false);
        state = E.reducer(state, { type: 'START' });
        stopTimer();
        advance('TICK');
        if (state.status !== 'complete') timer = window.setInterval(advance, Number($('#speed').value));
        announce(`${state.scenario.title} simulation started.`);
    }

    function stopTimer() {
        if (timer) window.clearInterval(timer);
        timer = null;
    }

    function clearTransientUi() {
        ['filter-protocol', 'filter-source', 'filter-destination', 'filter-severity', 'filter-time'].forEach(id => {
            const control = $(`#${id}`);
            if (control) control.value = '';
        });
        $('#inspector-copy').textContent = 'Select a host or flow to see a plain-language explanation.';
        $('#live-region').textContent = '';
    }

    function reset(announceReset = true) {
        stopTimer();
        if (state.findings) comparisonReport = state.findings;
        clearTransientUi();
        state = E.initialState(readConfig());
        buildDefenses();
        render();
        if (announceReset) announce('Simulation reset. Runtime events, alerts, filters, and selections were cleared.');
    }

    function download(format) {
        if (!state.findings) return;
        let content, type, extension;
        if (format === 'json') {
            content = E.serializeReportJson(state.findings); type = 'application/json'; extension = 'json';
        } else {
            content = E.serializeReportCsv(state.findings);
            type = 'text/csv'; extension = 'csv';
        }
        const blob = new Blob([content], { type });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `microcompit-synthetic-${state.scenario.id}-report.${extension}`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function updateMotionStatus(reduced) {
        const status = $('#motion-status');
        status.textContent = reduced
            ? 'Static flow view enabled. Line color, host status, counters, and logs preserve traffic meaning.'
            : state.status === 'paused'
                ? 'Simulation paused. Flow paths are frozen and no attack activity is advancing.'
                : state.status === 'complete'
                    ? 'Simulation complete. Flow paths are stopped at the final recorded state.'
                    : state.status === 'running'
                        ? 'Animated flow view enabled. Paths move only while the simulation is running.'
                        : 'Flow paths are static until the simulation starts.';
        status.classList.toggle('active', reduced || state.status !== 'running');
    }

    function announce(message) { $('#live-region').textContent = message; }
    function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
    function humanize(value) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' '); }
    function escapeHtml(value) {
        const div = document.createElement('div'); div.textContent = String(value); return div.innerHTML;
    }

    state = E.initialState(readConfig());
    $('#scenario-search').addEventListener('input', event => buildScenarioList(event.target.value));
    ['difficulty', 'mode', 'attack-type', 'recovery'].forEach(id => $(`#${id}`).addEventListener('change', () => reset()));
    $('#seed').addEventListener('change', () => reset());
    $('#speed').addEventListener('change', () => {
        if (state.status === 'running') {
            stopTimer();
            timer = window.setInterval(advance, Number($('#speed').value));
        }
    });
    $('#start').addEventListener('click', start);
    $('#pause').addEventListener('click', () => {
        if (state.status === 'running') { stopTimer(); state = E.reducer(state, { type: 'PAUSE' }); }
        else if (state.status === 'paused') { state = E.reducer(state, { type: 'RESUME' }); timer = window.setInterval(advance, Number($('#speed').value)); }
        render();
    });
    $('#step').addEventListener('click', () => { stopTimer(); advance('STEP'); });
    $('#reset').addEventListener('click', () => reset());
    $('#replay').addEventListener('click', () => { reset(); start(); });
    $('#reduced-motion').addEventListener('change', event => {
        document.body.classList.toggle('reduce-motion', event.target.checked);
        localStorage.setItem('microcompCyberReducedMotion', event.target.checked ? 'true' : 'false');
        updateMotionStatus(event.target.checked);
    });
    ['filter-protocol', 'filter-source', 'filter-destination', 'filter-severity', 'filter-time'].forEach(id => $(`#${id}`).addEventListener('input', renderFlows));
    $('#export-json').addEventListener('click', () => download('json'));
    $('#export-csv').addEventListener('click', () => download('csv'));
    E.PROTOCOLS.forEach(protocol => $('#filter-protocol').insertAdjacentHTML('beforeend', `<option>${protocol}</option>`));
    const reduced = localStorage.getItem('microcompCyberReducedMotion') === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('#reduced-motion').checked = reduced;
    document.body.classList.toggle('reduce-motion', reduced);
    updateMotionStatus(reduced);
    buildScenarioList();
    buildDefenses();
    render();
});
