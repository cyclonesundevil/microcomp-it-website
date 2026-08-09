document.addEventListener('DOMContentLoaded', () => {

    const canvas = document.getElementById('lensing-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const controlGroups = {
        mass: Array.from(document.querySelectorAll('[data-lensing-control="mass"]')),
        sourceDistance: Array.from(document.querySelectorAll('[data-lensing-control="sourceDistance"]')),
        observerDistance: Array.from(document.querySelectorAll('[data-lensing-control="observerDistance"]')),
        alignment: Array.from(document.querySelectorAll('[data-lensing-control="alignment"]')),
        frequency: Array.from(document.querySelectorAll('[data-lensing-control="frequency"]'))
    };
    const controls = {
        mass: controlGroups.mass[0],
        sourceDistance: controlGroups.sourceDistance[0],
        observerDistance: controlGroups.observerDistance[0],
        alignment: controlGroups.alignment[0],
        frequency: controlGroups.frequency[0]
    };
    const values = {
        mass: Array.from(document.querySelectorAll('[data-lensing-value="mass"]')),
        sourceDistance: Array.from(document.querySelectorAll('[data-lensing-value="sourceDistance"]')),
        observerDistance: Array.from(document.querySelectorAll('[data-lensing-value="observerDistance"]')),
        alignment: Array.from(document.querySelectorAll('[data-lensing-value="alignment"]')),
        frequency: Array.from(document.querySelectorAll('[data-lensing-value="frequency"]'))
    };
    const readouts = {
        einstein: document.getElementById('einstein-readout'),
        magnification: document.getElementById('magnification-readout'),
        delay: document.getElementById('delay-readout'),
        split: document.getElementById('split-readout')
    };
    const paper = {
        canvas: document.getElementById('paper-observable-canvas'),
        delay: document.getElementById('paper-delay'),
        phase: document.getElementById('paper-phase'),
        fringe: document.getElementById('paper-fringe'),
        regime: document.getElementById('paper-regime'),
        resolution: document.getElementById('paper-resolution'),
        plasma: document.getElementById('paper-plasma'),
        note: document.getElementById('paper-observable-note'),
        channelWidth: document.getElementById('channel-width'),
        plotWindow: document.getElementById('paper-plot-window'),
        plotButtons: Array.from(document.querySelectorAll('[data-paper-plot]')),
        claimTerms: Array.from(document.querySelectorAll('[data-claim-term]')),
        claimObservables: Array.from(document.querySelectorAll('[data-claim-observable]')),
        claimSummary: document.getElementById('claim-equation-summary')
    };
    const paperCtx = paper.canvas ? paper.canvas.getContext('2d') : null;
    const modeButtons = document.querySelectorAll('[data-mode]');

    let mode = 'geometric';
    let paperPlotMode = 'intensity';
    let previousClaimObservable = null;
    let lastClaimParam = null;
    let animationTimer = null;
    let lastWaveFrame = 0;
    const waveCanvas = document.createElement('canvas');
    const waveCtx = waveCanvas.getContext('2d');

    function rawInputs() {
        return {
            mass: Number(controls.mass.value),
            sourceDistance: Number(controls.sourceDistance.value),
            observerDistance: Number(controls.observerDistance.value),
            alignment: Number(controls.alignment.value),
            frequency: Number(controls.frequency.value)
        };
    }

    function modelFromRaw(raw) {
        const mass = raw.mass;
        const sourceDistance = raw.sourceDistance / 10;
        const observerDistance = raw.observerDistance / 10;
        const alignment = raw.alignment / 100;
        const frequency = raw.frequency;
        const distanceRatio = Math.sqrt((sourceDistance * observerDistance) / (sourceDistance + observerDistance));
        const einstein = Math.sqrt(mass / 80) * distanceRatio * 0.55;
        const beta = Math.max(0.015, alignment * 1.45);
        const imagePositive = (beta + Math.sqrt(beta * beta + 4 * einstein * einstein)) / 2;
        const imageNegative = (beta - Math.sqrt(beta * beta + 4 * einstein * einstein)) / 2;
        const split = Math.abs(imagePositive - imageNegative);
        const magnification = Math.min(12, Math.max(1, (beta * beta + 2 * einstein * einstein) / (beta * Math.sqrt(beta * beta + 4 * einstein * einstein))));
        const delay = Math.max(0.4, mass * split * (0.22 + observerDistance / 20));

        return {
            mass,
            sourceDistance,
            observerDistance,
            alignment,
            frequency,
            einstein,
            beta,
            imagePositive,
            imageNegative,
            split,
            magnification,
            delay
        };
    }

    function model() {
        return modelFromRaw(rawInputs());
    }

    function formatScientific(value, unit = '') {
        if (!Number.isFinite(value)) return '--';
        if (Math.abs(value) >= 100_000 || Math.abs(value) < 0.01) {
            return `${value.toExponential(2)}${unit}`;
        }
        return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`;
    }

    function formatFrequency(hz) {
        if (hz >= 1_000_000_000) return `${(hz / 1_000_000_000).toFixed(2)} GHz`;
        if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(2)} MHz`;
        if (hz >= 1_000) return `${(hz / 1_000).toFixed(2)} kHz`;
        return `${hz.toFixed(1)} Hz`;
    }

    function formatPhaseWraps(turns) {
        if (!Number.isFinite(turns)) return '--';
        if (turns >= 1_000_000) return `${(turns / 1_000_000).toFixed(2)}M`;
        if (turns >= 1_000) return `${(turns / 1_000).toFixed(2)}K`;
        if (turns >= 10) return turns.toFixed(0);
        return turns.toFixed(2);
    }

    function paperObservableModel(state) {
        const delaySeconds = state.delay / 1000;
        const frequencyHz = state.frequency * 1_000_000;
        const phaseRadians = 2 * Math.PI * frequencyHz * delaySeconds;
        const fringeSpacingHz = 1 / Math.max(delaySeconds, 1e-12);
        const channelWidthHz = Number(paper.channelWidth?.value || 24_000);
        const resolvable = fringeSpacingHz >= channelWidthHz * 2;
        const visibility = Math.min(0.88, Math.max(0.12, (state.magnification - 1) / 5.8));
        const channelSmearing = Math.min(1, channelWidthHz / Math.max(fringeSpacingHz, 1));
        const regime = resolvable ? 'Wave/interference' : 'Geometric averaged';
        return {
            delaySeconds,
            frequencyHz,
            phaseRadians,
            fringeSpacingHz,
            channelWidthHz,
            resolvable,
            visibility,
            channelSmearing,
            regime
        };
    }

    const sensitivityConfig = {
        mass: { label: 'lens mass M', min: 10, max: 120, target: 'Delta t grav' },
        sourceDistance: { label: 'source distance Ds', min: 30, max: 100, target: 'Delta t grav' },
        observerDistance: { label: 'observer distance Do', min: 20, max: 90, target: 'Delta t grav' },
        alignment: { label: 'alignment beta', min: 0, max: 100, target: 'Delta t grav' },
        frequency: { label: 'observing frequency nu', min: 600, max: 3000, target: 'Delta phi' }
    };

    function sensitivityTarget(param, raw, target = 'phase') {
        const state = modelFromRaw(raw);
        const observable = paperObservableModel(state);
        if (target === 'delay') return observable.delaySeconds;
        if (target === 'fringe') return observable.fringeSpacingHz;
        if (target === 'channel') return observable.channelSmearing;
        return observable.phaseRadians;
    }

    function parameterSensitivity(param, raw, target = 'phase') {
        const config = sensitivityConfig[param];
        if (!config) return 0;

        const value = raw[param];
        const step = Math.max(1, (config.max - config.min) * 0.035);
        const lowValue = Math.max(config.min, value - step);
        const highValue = Math.min(config.max, value + step);
        if (highValue === lowValue) return 0;

        const lowRaw = { ...raw, [param]: lowValue };
        const highRaw = { ...raw, [param]: highValue };
        const lowTarget = sensitivityTarget(param, lowRaw, target);
        const highTarget = sensitivityTarget(param, highRaw, target);
        const baseTarget = Math.max(Math.abs(sensitivityTarget(param, raw, target)), 1e-9);
        const fractionalControlChange = Math.max((highValue - lowValue) / Math.max(Math.abs(value), 1), 1e-6);
        return Math.abs(highTarget - lowTarget) / baseTarget / fractionalControlChange;
    }

    function visibleHeat(score, maxScore) {
        if (score <= 0) return 0;
        const normalized = Math.min(1, score / Math.max(maxScore, 0.05));
        return 0.16 + Math.sqrt(normalized) * 0.84;
    }

    function valueHeat(level) {
        return 0.18 + Math.min(1, Math.max(0, level)) * 0.82;
    }

    function targetLevelForParam(param, raw, target = 'phase') {
        const config = sensitivityConfig[param];
        if (!config) return 0.18;

        const samples = 24;
        const values = [];
        for (let i = 0; i <= samples; i += 1) {
            const value = config.min + ((config.max - config.min) * i) / samples;
            values.push(sensitivityTarget(param, { ...raw, [param]: value }, target));
        }
        const currentValue = sensitivityTarget(param, raw, target);
        const minValue = Math.min(...values, currentValue);
        const maxValue = Math.max(...values, currentValue);
        if (Math.abs(maxValue - minValue) < 1e-12) return 0.18;
        return valueHeat((currentValue - minValue) / (maxValue - minValue));
    }

    function channelResolutionHeat(observable) {
        const channelPressure = observable.channelWidthHz / Math.max(observable.fringeSpacingHz, 1);
        return valueHeat(Math.min(1, Math.log10(channelPressure + 1) / 3.5));
    }

    function channelSensitivity(observable) {
        const channelPressure = observable.channelWidthHz / Math.max(observable.fringeSpacingHz, 1);
        return Math.min(0.72, Math.log10(channelPressure + 1) * 0.24);
    }

    function observableChangeHeat(previous, current, key) {
        if (!previous) return 0.42;
        const previousValue = Math.max(Math.abs(previous[key]), 1e-12);
        const currentValue = Math.abs(current[key]);
        const fractionalChange = Math.abs(currentValue - previousValue) / previousValue;
        return Math.min(1, 0.18 + fractionalChange * 9);
    }

    function currentObservableSnapshot(observable) {
        return {
            delay: observable.delaySeconds,
            phase: observable.phaseRadians,
            fringe: observable.fringeSpacingHz,
            channel: observable.channelSmearing
        };
    }

    function updateClaimEquation(state, observable) {
        if (!paper.claimTerms.length && !paper.claimObservables.length) return;

        const raw = rawInputs();
        const rawScores = Object.fromEntries(
            Object.keys(sensitivityConfig).map((param) => [param, parameterSensitivity(param, raw)])
        );
        rawScores.channel = channelSensitivity(observable);
        const maxScore = Math.max(...Object.values(rawScores), 0.05);
        const normalizedScores = Object.fromEntries(
            Object.entries(rawScores).map(([param, score]) => [param, visibleHeat(score, maxScore)])
        );

        paper.claimTerms.forEach((term) => {
            const param = term.dataset.claimTerm;
            let heat = normalizedScores[param] || 0;
            if (param === lastClaimParam && sensitivityConfig[param]) {
                heat = targetLevelForParam(param, raw, 'phase');
            } else if (param === 'channel' && lastClaimParam === 'channel') {
                heat = channelResolutionHeat(observable);
            }
            term.style.setProperty('--heat', heat.toFixed(3));
            const config = sensitivityConfig[param];
            const label = config?.label || 'channel width Wchan';
            term.title = `${label}: ${Math.round(heat * 100)}% ${param === lastClaimParam ? 'current Delta phi level' : 'relative influence on Delta phi'} at this setting`;
            term.setAttribute('aria-label', term.title);
        });

        const snapshot = currentObservableSnapshot(observable);
        const observableHeat = {
            delay: observableChangeHeat(previousClaimObservable, snapshot, 'delay'),
            phase: observableChangeHeat(previousClaimObservable, snapshot, 'phase'),
            fringe: observableChangeHeat(previousClaimObservable, snapshot, 'fringe')
        };
        if (lastClaimParam && sensitivityConfig[lastClaimParam]) {
            observableHeat.delay = targetLevelForParam(lastClaimParam, raw, 'delay');
            observableHeat.phase = targetLevelForParam(lastClaimParam, raw, 'phase');
            observableHeat.fringe = targetLevelForParam(lastClaimParam, raw, 'fringe');
        } else if (lastClaimParam === 'channel') {
            observableHeat.fringe = channelResolutionHeat(observable);
        }
        paper.claimObservables.forEach((term) => {
            const observableKey = term.dataset.claimObservable;
            const heat = observableHeat[observableKey] || 0;
            term.style.setProperty('--heat', heat.toFixed(3));
            term.title = `${term.textContent.trim()}: ${Math.round(heat * 100)}% recent observable movement`;
            term.setAttribute('aria-label', term.title);
        });

        if (paper.claimSummary) {
            const strongest = Object.entries(normalizedScores)
                .sort((a, b) => b[1] - a[1])[0];
            const strongestConfig = sensitivityConfig[strongest[0]];
            const strongestLabel = strongestConfig?.label || 'channel width Wchan';
            const strongestObservable = Object.entries(observableHeat)
                .sort((a, b) => b[1] - a[1])[0];
            const observableLabels = {
                delay: 'Delta t grav',
                phase: 'Delta phi',
                fringe: 'fringe spacing Delta nu'
            };
            const activeConfig = sensitivityConfig[lastClaimParam];
            const activeLabel = activeConfig?.label || (lastClaimParam === 'channel' ? 'channel width Wchan' : strongestLabel);
            let activeEffect = `latest observable movement: ${observableLabels[strongestObservable[0]]}`;
            if (lastClaimParam === 'frequency') {
                activeEffect = 'latest effect: nu directly changes Delta phi';
            } else if (lastClaimParam === 'channel') {
                activeEffect = 'latest effect: Wchan changes whether the Delta nu fringes are resolved';
            } else if (activeConfig) {
                activeEffect = `latest effect: ${activeLabel} changes Delta t grav, which drives Delta phi and Delta nu`;
            }
            paper.claimSummary.textContent = `Heat combines local sensitivity and the latest movement. Last moved: ${activeLabel}; strongest overall parameter now: ${strongestLabel}; ${activeEffect}.`;
        }

        previousClaimObservable = snapshot;
    }

    function resizePaperCanvas() {
        if (!paper.canvas || !paperCtx) return;
        const rect = paper.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(320, rect.width || 640);
        const height = Math.max(220, width * 0.34);
        paper.canvas.style.height = `${height}px`;
        paper.canvas.width = Math.floor(width * dpr);
        paper.canvas.height = Math.floor(height * dpr);
        paperCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawPaperPlot(state, observable) {
        if (!paper.canvas || !paperCtx) return;
        resizePaperCanvas();
        const width = paper.canvas.clientWidth || 960;
        const height = paper.canvas.clientHeight || 320;
        const pad = { left: 54, right: 22, top: 28, bottom: 42 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const spanHz = Math.max(observable.channelWidthHz * 4, 8_000);
        const startHz = observable.frequencyHz - spanHz / 2;
        const endHz = observable.frequencyHz + spanHz / 2;
        const rawModulation = Math.max(0.42, observable.visibility);
        const channelAveragedModulation = rawModulation * (1 - Math.min(0.92, observable.channelSmearing * 0.72));
        const displayAmplitude = 0.375;

        paperCtx.clearRect(0, 0, width, height);
        const bg = paperCtx.createLinearGradient(0, 0, width, height);
        bg.addColorStop(0, '#02040a');
        bg.addColorStop(1, '#07101e');
        paperCtx.fillStyle = bg;
        paperCtx.fillRect(0, 0, width, height);

        paperCtx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
        paperCtx.lineWidth = 1;
        for (let i = 0; i <= 5; i += 1) {
            const y = pad.top + (plotH * i) / 5;
            paperCtx.beginPath();
            paperCtx.moveTo(pad.left, y);
            paperCtx.lineTo(width - pad.right, y);
            paperCtx.stroke();
        }
        for (let i = 0; i <= 6; i += 1) {
            const x = pad.left + (plotW * i) / 6;
            paperCtx.beginPath();
            paperCtx.moveTo(x, pad.top);
            paperCtx.lineTo(x, height - pad.bottom);
            paperCtx.stroke();
        }

        const channelPixels = Math.max(2, Math.min(plotW, (observable.channelWidthHz / spanHz) * plotW));
        paperCtx.fillStyle = 'rgba(255, 255, 255, 0.055)';
        for (let x = pad.left; x < width - pad.right; x += channelPixels * 2) {
            paperCtx.fillRect(x, pad.top, channelPixels, plotH);
        }

        paperCtx.strokeStyle = paperPlotMode === 'phase' ? 'rgba(255, 0, 255, 0.9)' : 'rgba(0, 240, 255, 0.95)';
        paperCtx.lineWidth = 2.4;

        if (paperPlotMode === 'intensity') {
            const columns = Math.max(220, Math.floor(plotW));
            const subSamples = 10;
            paperCtx.fillStyle = 'rgba(0, 240, 255, 0.18)';
            paperCtx.beginPath();
            for (let xIndex = 0; xIndex <= columns; xIndex += 1) {
                let minValue = 1;
                let maxValue = 0;
                for (let sub = 0; sub < subSamples; sub += 1) {
                    const t = (xIndex + sub / subSamples) / columns;
                    const hz = startHz + (endHz - startHz) * t;
                    const phase = 2 * Math.PI * hz * observable.delaySeconds;
                    const value = 0.5 + displayAmplitude * Math.cos(phase);
                    minValue = Math.min(minValue, value);
                    maxValue = Math.max(maxValue, value);
                }
                const x = pad.left + plotW * (xIndex / columns);
                const y = pad.top + plotH * (1 - maxValue);
                if (xIndex === 0) paperCtx.moveTo(x, y);
                else paperCtx.lineTo(x, y);
            }
            for (let xIndex = columns; xIndex >= 0; xIndex -= 1) {
                let minValue = 1;
                for (let sub = 0; sub < subSamples; sub += 1) {
                    const t = (xIndex + sub / subSamples) / columns;
                    const hz = startHz + (endHz - startHz) * t;
                    const phase = 2 * Math.PI * hz * observable.delaySeconds;
                    const value = 0.5 + displayAmplitude * Math.cos(phase);
                    minValue = Math.min(minValue, value);
                }
                const x = pad.left + plotW * (xIndex / columns);
                const y = pad.top + plotH * (1 - minValue);
                paperCtx.lineTo(x, y);
            }
            paperCtx.closePath();
            paperCtx.fill();

            paperCtx.strokeStyle = 'rgba(0, 240, 255, 0.98)';
            paperCtx.beginPath();
            const traceSamples = 520;
            for (let i = 0; i <= traceSamples; i += 1) {
                const t = i / traceSamples;
                const hz = startHz + (endHz - startHz) * t;
                const phase = 2 * Math.PI * hz * observable.delaySeconds;
                const averagedValue = 0.5 + displayAmplitude * Math.cos(phase);
                const x = pad.left + plotW * t;
                const y = pad.top + plotH * (1 - averagedValue);
                if (i === 0) paperCtx.moveTo(x, y);
                else paperCtx.lineTo(x, y);
            }
            paperCtx.stroke();
        } else {
            const totalTurns = Math.max(spanHz * observable.delaySeconds, 1e-9);
            const totalPhaseRadians = 2 * Math.PI * totalTurns;
            const visibleWrapLines = Math.min(360, Math.max(12, Math.floor(totalTurns)));
            const density = Math.min(1, Math.log10(totalTurns + 1) / 4);
            const densityGradient = paperCtx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
            densityGradient.addColorStop(0, `rgba(255, 0, 255, ${0.05 + density * 0.14})`);
            densityGradient.addColorStop(0.5, `rgba(0, 240, 255, ${0.035 + density * 0.08})`);
            densityGradient.addColorStop(1, `rgba(255, 0, 255, ${0.05 + density * 0.14})`);
            paperCtx.fillStyle = densityGradient;
            paperCtx.fillRect(pad.left, pad.top, plotW, plotH);

            paperCtx.strokeStyle = `rgba(255, 0, 255, ${totalTurns > 360 ? 0.12 : 0.24})`;
            paperCtx.lineWidth = totalTurns > 360 ? 1 : 1.35;
            const lineStride = Math.max(1, Math.ceil(totalTurns / visibleWrapLines));
            for (let wrap = 0; wrap <= totalTurns; wrap += lineStride) {
                const x = pad.left + plotW * (wrap / totalTurns);
                paperCtx.beginPath();
                paperCtx.moveTo(x, pad.top);
                paperCtx.lineTo(x, height - pad.bottom);
                paperCtx.stroke();
            }

            paperCtx.strokeStyle = 'rgba(255, 0, 255, 0.96)';
            paperCtx.lineWidth = 2.2;
            paperCtx.beginPath();
            const samples = 760;
            for (let i = 0; i <= samples; i += 1) {
                const t = i / samples;
                const wrappedPhase = (totalTurns * t) % 1;
                const x = pad.left + plotW * t;
                const y = pad.top + plotH * (1 - wrappedPhase);
                if (i === 0) paperCtx.moveTo(x, y);
                else paperCtx.lineTo(x, y);
            }
            paperCtx.stroke();

            paperCtx.strokeStyle = 'rgba(223, 251, 255, 0.7)';
            paperCtx.lineWidth = 2;
            paperCtx.beginPath();
            const accumulationHeight = Math.min(1, Math.log10(totalTurns + 1) / 5);
            paperCtx.moveTo(pad.left, height - pad.bottom);
            paperCtx.lineTo(width - pad.right, height - pad.bottom - plotH * accumulationHeight);
            paperCtx.stroke();

            paperCtx.fillStyle = 'rgba(255, 0, 255, 0.2)';
            paperCtx.fillRect(pad.left + 8, pad.top + 8, 238, 42);
            paperCtx.strokeStyle = 'rgba(255, 0, 255, 0.55)';
            paperCtx.strokeRect(pad.left + 8, pad.top + 8, 238, 42);
            paperCtx.fillStyle = 'rgba(255, 232, 255, 0.96)';
            paperCtx.font = '800 12px Inter, sans-serif';
            paperCtx.fillText(`~${formatPhaseWraps(totalTurns)} phase wraps`, pad.left + 20, pad.top + 27);
            paperCtx.font = '700 11px Inter, sans-serif';
            paperCtx.fillStyle = 'rgba(223, 251, 255, 0.82)';
            paperCtx.fillText(`${formatScientific(totalPhaseRadians)} rad across this window`, pad.left + 20, pad.top + 43);
        }

        paperCtx.fillStyle = 'rgba(223, 251, 255, 0.92)';
        paperCtx.font = '800 12px Inter, sans-serif';
        paperCtx.fillText(paperPlotMode === 'phase' ? 'phase-wrap density across accumulation window' : 'normalized intensity across accumulation window', pad.left, 18);
        paperCtx.font = '700 11px Inter, sans-serif';
        paperCtx.fillStyle = 'rgba(184, 199, 220, 0.92)';
        paperCtx.fillText(`${formatFrequency(startHz)} to ${formatFrequency(endHz)}`, pad.left, height - 14);
        paperCtx.textAlign = 'right';
        paperCtx.fillText(`channel ${formatFrequency(observable.channelWidthHz)}; averaged contrast ~${Math.round(channelAveragedModulation * 100)}%`, width - pad.right, height - 14);
        paperCtx.textAlign = 'left';

        if (paper.plotWindow) {
            paper.plotWindow.textContent = `Accumulation window: ${formatFrequency(spanHz)} around ${(state.frequency / 1000).toFixed(2)} GHz`;
        }
    }

    function updatePaperObservables(state) {
        if (!paper.delay) return;
        const observable = paperObservableModel(state);
        paper.delay.textContent = `${(observable.delaySeconds * 1000).toFixed(2)} ms`;
        paper.phase.textContent = `${formatScientific(observable.phaseRadians)} rad`;
        paper.fringe.textContent = formatFrequency(observable.fringeSpacingHz);
        paper.regime.textContent = observable.regime;
        paper.resolution.textContent = observable.resolvable
            ? `Resolvable at ${formatFrequency(observable.channelWidthHz)}`
            : `Averaged by ${formatFrequency(observable.channelWidthHz)} channels`;
        paper.plasma.textContent = 'Achromatic delay';
        if (paper.note) {
            if (paperPlotMode === 'phase') {
                paper.note.textContent = 'Phase mode shows how many gravitational phase wraps accumulate across the selected frequency window. Denser magenta structure means the signal changes phase more rapidly with frequency; plasma dispersion follows a different frequency dependence.';
            } else {
                paper.note.textContent = observable.resolvable
                    ? 'Gravitational delay is achromatic, but phase grows with frequency; this channel setting can sample the spectral interference.'
                    : 'The underlying gravitational phase structure is present, but this channel width would average over the fringes. Plasma dispersion follows a different frequency dependence.';
            }
        }
        updateClaimEquation(state, observable);
        drawPaperPlot(state, observable);
    }

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = Math.max(320, rect.width);
        const cssHeight = Math.max(440, cssWidth * 0.64);
        canvas.style.height = `${cssHeight}px`;
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(performance.now());
    }

    function drawText(text, x, y, options = {}) {
        ctx.save();
        ctx.fillStyle = options.color || 'rgba(255,255,255,0.82)';
        ctx.font = options.font || '600 13px Inter, sans-serif';
        ctx.textAlign = options.align || 'center';
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    function drawGlowingCircle(x, y, radius, color, alpha = 1) {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.2);
        gradient.addColorStop(0, color.replace('ALPHA', String(alpha)));
        gradient.addColorStop(0.35, color.replace('ALPHA', String(alpha * 0.26)));
        gradient.addColorStop(1, color.replace('ALPHA', '0'));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = color.replace('ALPHA', String(alpha));
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawImageMarker(x, y, radius, color, alpha = 1) {
        ctx.save();
        ctx.strokeStyle = color.replace('ALPHA', String(alpha));
        ctx.fillStyle = color.replace('ALPHA', String(alpha * 0.18));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - radius * 1.8, y);
        ctx.lineTo(x + radius * 1.8, y);
        ctx.moveTo(x, y - radius * 1.8);
        ctx.lineTo(x, y + radius * 1.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawPath(points, color, width = 2) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.quadraticCurveTo(point.cx ?? point.x, point.cy ?? point.y, point.x, point.y);
        });
        ctx.stroke();
        ctx.restore();
    }

    function drawWaveField(bounds, source, lens, observer, state, time) {
        const quality = window.devicePixelRatio > 1 ? 0.42 : 0.5;
        const scaledBounds = {
            w: Math.max(240, Math.floor(bounds.w * quality)),
            h: Math.max(180, Math.floor(bounds.h * quality))
        };

        if (waveCanvas.width !== scaledBounds.w || waveCanvas.height !== scaledBounds.h) {
            waveCanvas.width = scaledBounds.w;
            waveCanvas.height = scaledBounds.h;
        }

        const image = waveCtx.createImageData(scaledBounds.w, scaledBounds.h);
        const pixels = image.data;
        const freqScale = state.frequency / 1400;
        const bend = state.einstein * 0.72;
        const sourceToLens = Math.hypot(lens.x - source.x, lens.y - source.y);
        const sourceToObserver = Math.hypot(observer.x - source.x, observer.y - source.y);
        let index = 0;

        for (let y = 0; y < scaledBounds.h; y += 1) {
            for (let x = 0; x < scaledBounds.w; x += 1) {
                const canvasX = bounds.x + (x / scaledBounds.w) * bounds.w;
                const canvasY = bounds.y + (y / scaledBounds.h) * bounds.h;
                const sourceRadius = Math.hypot(canvasX - source.x, canvasY - source.y);
                const lensRadius = Math.hypot(canvasX - lens.x, canvasY - lens.y);
                const observerRadius = Math.hypot(canvasX - observer.x, canvasY - observer.y);
                const sourcePhase = sourceRadius * (0.052 + freqScale * 0.018) - time * 0.004;
                const lensPass = Math.exp(-Math.abs(sourceRadius - sourceToLens) / Math.max(32, bounds.w * 0.055));
                const observerFade = 1 - Math.max(0, (sourceRadius - sourceToObserver * 0.98) / Math.max(sourceToObserver * 0.16, 1));
                const lensPerturbation = Math.sin(lensRadius * (0.04 + bend * 0.012) + state.alignment * 8) * lensPass * 0.38;
                const pathInterference = Math.sin((observerRadius - lensRadius) * 0.05 * freqScale + bend * 5) * lensPass * 0.2;
                const ring = Math.sin(sourcePhase + lensPerturbation);
                const sourceEnvelope = Math.exp(-Math.abs(sourceRadius - sourceToLens * 0.82) / Math.max(sourceToObserver * 0.75, 1));
                const intensity = Math.max(0, Math.min(1, 0.22 + ring * 0.34 + pathInterference)) * sourceEnvelope * Math.max(0, observerFade);
                pixels[index] = Math.floor(16 + intensity * 30);
                pixels[index + 1] = Math.floor(52 + intensity * 160);
                pixels[index + 2] = Math.floor(82 + intensity * 165);
                pixels[index + 3] = Math.floor(24 + intensity * 150);
                index += 4;
            }
        }

        waveCtx.putImageData(image, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(waveCanvas, bounds.x, bounds.y, bounds.w, bounds.h);
    }

    function stopWaveAnimation() {
        if (animationTimer) {
            window.clearTimeout(animationTimer);
            animationTimer = null;
        }
    }

    function draw(time) {
        const state = model();
        const width = canvas.clientWidth || 1120;
        const height = canvas.clientHeight || 720;
        ctx.clearRect(0, 0, width, height);

        values.mass.forEach((value) => { value.textContent = `${state.mass} solar masses`; });
        values.sourceDistance.forEach((value) => { value.textContent = `${state.sourceDistance.toFixed(1)} kpc`; });
        values.observerDistance.forEach((value) => { value.textContent = `${state.observerDistance.toFixed(1)} kpc`; });
        values.alignment.forEach((value) => { value.textContent = `${(state.beta * 0.28).toFixed(2)} arcsec`; });
        values.frequency.forEach((value) => { value.textContent = `${(state.frequency / 1000).toFixed(1)} GHz`; });

        readouts.einstein.textContent = `${state.einstein.toFixed(2)} arcsec`;
        readouts.magnification.textContent = `${state.magnification.toFixed(1)}x`;
        readouts.delay.textContent = `${state.delay.toFixed(1)} ms`;
        readouts.split.textContent = `${state.split.toFixed(2)} arcsec`;
        updatePaperObservables(state);

        const top = 48;
        const bottom = height - 66;
        const lens = { x: width * 0.5, y: height * 0.5 };
        const margin = Math.max(54, width * 0.07);
        const viewSpan = Math.max(240, Math.min(width, height * 1.65));
        const minSideSpan = viewSpan * 0.23;
        const maxSideSpan = viewSpan * 0.43;
        const sourceScale = Math.max(0, Math.min(1, (state.sourceDistance - 3) / 7));
        const observerScale = Math.max(0, Math.min(1, (state.observerDistance - 2) / 7));
        const sourceSpan = minSideSpan + sourceScale * (maxSideSpan - minSideSpan);
        const observerSpan = minSideSpan + observerScale * (maxSideSpan - minSideSpan);
        const source = {
            x: Math.max(margin, lens.x - sourceSpan),
            y: height * (0.28 + state.alignment * 0.34)
        };
        const observer = {
            x: Math.min(width - margin, lens.x + observerSpan),
            y: height * 0.5
        };
        const ringRadius = Math.min(width, height) * (0.11 + state.einstein * 0.055);
        const splitPx = Math.min(height * 0.22, ringRadius * (0.45 + state.alignment));

        const bg = ctx.createLinearGradient(0, 0, width, height);
        bg.addColorStop(0, '#02040a');
        bg.addColorStop(0.6, '#050814');
        bg.addColorStop(1, '#070412');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= width; x += width / 12) {
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.stroke();
        }
        for (let y = top; y <= bottom; y += (bottom - top) / 8) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        const shouldUpdateWave = mode === 'wave' && time - lastWaveFrame > 80;
        if (mode === 'wave' && shouldUpdateWave) {
            lastWaveFrame = time;
            drawWaveField({
                x: 0,
                y: 0,
                w: Math.floor(width),
                h: Math.floor(height)
            }, source, lens, observer, state, time || 0);
        }

        ctx.setLineDash([8, 9]);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(observer.x, observer.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const sourceToLens = Math.max(1, lens.x - source.x);
        const lensToObserver = Math.max(1, observer.x - lens.x);
        const localSpan = Math.min(sourceToLens, lensToObserver);
        const bendStrength = Math.min(localSpan * 0.58, 28 + state.mass * 0.82);
        const upper = lens.y - splitPx;
        const lower = lens.y + splitPx * 0.82;

        drawPath([
            source,
            { x: lens.x - sourceToLens * 0.12, y: upper, cx: lens.x - bendStrength, cy: upper - bendStrength * 0.22 },
            { x: observer.x, y: observer.y, cx: lens.x + bendStrength, cy: upper - bendStrength * 0.16 }
        ], 'rgba(0, 240, 255, 0.88)', 3);
        drawPath([
            source,
            { x: lens.x - sourceToLens * 0.11, y: lower, cx: lens.x - bendStrength, cy: lower + bendStrength * 0.22 },
            { x: observer.x, y: observer.y, cx: lens.x + bendStrength, cy: lower + bendStrength * 0.16 }
        ], 'rgba(255, 0, 255, 0.72)', 2.5);

        const guideY = Math.min(bottom - 24, lens.y + Math.max(ringRadius * 0.9, 74));
        ctx.save();
        ctx.setLineDash([5, 7]);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(source.x, guideY);
        ctx.lineTo(lens.x, guideY);
        ctx.lineTo(observer.x, guideY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,240,255,0.72)';
        ctx.beginPath();
        ctx.arc(lens.x, guideY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawText(`${state.sourceDistance.toFixed(1)} kpc`, (source.x + lens.x) * 0.5, guideY - 10, {
            color: 'rgba(223,251,255,0.74)',
            font: '700 11px Inter, sans-serif'
        });
        drawText(`${state.observerDistance.toFixed(1)} kpc`, (lens.x + observer.x) * 0.5, guideY - 10, {
            color: 'rgba(223,251,255,0.74)',
            font: '700 11px Inter, sans-serif'
        });

        ctx.strokeStyle = mode === 'wave' ? 'rgba(255,255,255,0.74)' : 'rgba(0,240,255,0.48)';
        ctx.lineWidth = mode === 'wave' ? 3 : 2;
        ctx.beginPath();
        ctx.ellipse(lens.x, lens.y, ringRadius, ringRadius * (0.72 + state.alignment * 0.1), 0, 0, Math.PI * 2);
        ctx.stroke();

        if (state.alignment < 0.18) {
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.ellipse(lens.x, lens.y, ringRadius * 0.98, ringRadius * 0.72, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            const brightImage = { x: lens.x + ringRadius * 0.9, y: lens.y - splitPx * 0.35 };
            const faintImage = { x: lens.x - ringRadius * 0.7, y: lens.y + splitPx * 0.28 };
            drawImageMarker(brightImage.x, brightImage.y, 6 + state.magnification * 0.28, 'rgba(255,255,255,ALPHA)', 0.92);
            drawImageMarker(faintImage.x, faintImage.y, 4.5 + state.magnification * 0.18, 'rgba(0,240,255,ALPHA)', 0.7);
            drawText('apparent images', brightImage.x + 18, brightImage.y - 16, {
                align: 'left',
                color: 'rgba(223,251,255,0.72)',
                font: '700 11px Inter, sans-serif'
            });
        }

        drawGlowingCircle(source.x, source.y, 8, 'rgba(255,0,255,ALPHA)', 0.85);
        drawGlowingCircle(lens.x, lens.y, 14 + state.mass * 0.07, 'rgba(0,240,255,ALPHA)', 0.9);
        drawGlowingCircle(observer.x, observer.y, 9, 'rgba(255,255,255,ALPHA)', 0.85);

        drawText(`source ${state.sourceDistance.toFixed(1)} kpc`, source.x, source.y - 24);
        drawText('lens mass', lens.x, lens.y + 42);
        drawText(`observer ${state.observerDistance.toFixed(1)} kpc`, observer.x, observer.y - 24);

        ctx.fillStyle = 'rgba(3, 5, 10, 0.74)';
        ctx.fillRect(24, 24, Math.min(360, width - 48), 74);
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.22)';
        ctx.strokeRect(24, 24, Math.min(360, width - 48), 74);
        drawText(mode === 'wave' ? 'Wave optics view' : 'Geometric optics view', 42, 54, {
            align: 'left',
            color: '#fff',
            font: '800 14px Inter, sans-serif'
        });
        drawText(mode === 'wave'
            ? '2D diagnostic projection; rotate the spatial geometry below.'
            : '2D ray projection; rotate the spatial geometry below.',
        42, 78, {
            align: 'left',
            color: 'rgba(160,174,192,0.94)',
            font: '13px Inter, sans-serif'
        });

        if (mode === 'wave') {
            stopWaveAnimation();
            animationTimer = window.setTimeout(() => {
                requestAnimationFrame(draw);
            }, 90);
        } else {
            stopWaveAnimation();
        }
    }

    function requestDraw() {
        stopWaveAnimation();
        draw(performance.now());
        window.dispatchEvent(new CustomEvent('lensing-controls-change'));
    }

    function syncControlSet(sourceControl) {
        const key = sourceControl.dataset.lensingControl;
        if (!key || !controlGroups[key]) return;

        controlGroups[key].forEach((control) => {
            if (control !== sourceControl) {
                control.value = sourceControl.value;
            }
        });
    }

    Object.values(controlGroups).flat().forEach((control) => {
        control.addEventListener('input', () => {
            lastClaimParam = control.dataset.lensingControl || null;
            syncControlSet(control);
            requestDraw();
        });
    });

    modeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            mode = button.dataset.mode;
            modeButtons.forEach((item) => item.classList.toggle('active', item.dataset.mode === mode));
            stopWaveAnimation();
            lastWaveFrame = 0;
            draw(performance.now());
            window.dispatchEvent(new CustomEvent('lensing-controls-change'));
        });
    });

    paper.plotButtons.forEach((button) => {
        button.addEventListener('click', () => {
            paperPlotMode = button.dataset.paperPlot;
            paper.plotButtons.forEach((item) => item.classList.toggle('active', item === button));
            requestDraw();
        });
    });

    if (paper.channelWidth) {
        paper.channelWidth.addEventListener('change', () => {
            lastClaimParam = 'channel';
            requestDraw();
        });
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
});
