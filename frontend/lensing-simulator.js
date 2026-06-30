document.addEventListener('DOMContentLoaded', () => {
    function updateBuildStamp() {
        const stampElements = document.querySelectorAll('[data-build-stamp]');
        if (!stampElements.length) return;

        const modifiedDate = new Date(document.lastModified);
        if (Number.isNaN(modifiedDate.getTime())) return;

        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Phoenix',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        const parts = Object.fromEntries(formatter.formatToParts(modifiedDate).map((part) => [part.type, part.value]));
        const formatted = `${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} MST`;
        stampElements.forEach((element) => {
            element.textContent = `Site updated: ${formatted}`;
        });
    }

    updateBuildStamp();

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
        plotButtons: Array.from(document.querySelectorAll('[data-paper-plot]'))
    };
    const paperCtx = paper.canvas ? paper.canvas.getContext('2d') : null;
    const modeButtons = document.querySelectorAll('[data-mode]');

    let mode = 'geometric';
    let paperPlotMode = 'intensity';
    let animationTimer = null;
    let lastWaveFrame = 0;
    const waveCanvas = document.createElement('canvas');
    const waveCtx = waveCanvas.getContext('2d');

    function model() {
        const mass = Number(controls.mass.value);
        const sourceDistance = Number(controls.sourceDistance.value) / 10;
        const observerDistance = Number(controls.observerDistance.value) / 10;
        const alignment = Number(controls.alignment.value) / 100;
        const frequency = Number(controls.frequency.value);
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
        const cyclesShown = paperPlotMode === 'phase' ? 120 : 180;
        const spanHz = Math.max(
            observable.fringeSpacingHz * cyclesShown,
            observable.channelWidthHz * 4,
            8_000
        );
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
            paperCtx.beginPath();
            const samples = 720;
            const totalTurns = spanHz * observable.delaySeconds;
            for (let i = 0; i <= samples; i += 1) {
                const t = i / samples;
                const turns = totalTurns * t;
                const yValue = 1 - (turns / Math.max(totalTurns, 1e-9));
                const x = pad.left + plotW * t;
                const y = pad.top + plotH * (1 - yValue);
                if (i === 0) paperCtx.moveTo(x, y);
                else paperCtx.lineTo(x, y);
            }
            paperCtx.stroke();

            paperCtx.fillStyle = 'rgba(255, 0, 255, 0.18)';
            paperCtx.font = '700 11px Inter, sans-serif';
            paperCtx.fillText(`${formatScientific(2 * Math.PI * spanHz * observable.delaySeconds)} rad phase accumulation across window`, pad.left + 8, pad.top + 18);
        }

        paperCtx.fillStyle = 'rgba(223, 251, 255, 0.92)';
        paperCtx.font = '800 12px Inter, sans-serif';
        paperCtx.fillText(paperPlotMode === 'phase' ? 'unwrapped phase accumulation' : 'normalized intensity across accumulation window', pad.left, 18);
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
            paper.note.textContent = observable.resolvable
                ? 'Gravitational delay is achromatic, but phase grows with frequency; this channel setting can sample the spectral interference.'
                : 'The underlying gravitational phase structure is present, but this channel width would average over the fringes. Plasma dispersion follows a different frequency dependence.';
        }
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

    function drawWaveField(bounds, lens, state, time) {
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
        let index = 0;

        for (let y = 0; y < scaledBounds.h; y += 1) {
            for (let x = 0; x < scaledBounds.w; x += 1) {
                const canvasX = bounds.x + (x / scaledBounds.w) * bounds.w;
                const canvasY = bounds.y + (y / scaledBounds.h) * bounds.h;
                const dx = (canvasX - lens.x) / bounds.w;
                const dy = (canvasY - lens.y) / bounds.h;
                const radius = Math.sqrt(dx * dx + dy * dy) + 0.002;
                const angle = Math.atan2(dy, dx);
                const ring = Math.sin(radius * (58 + freqScale * 28) - time * 0.004 + bend * 7);
                const caustic = Math.sin((dx * Math.cos(angle) + dy * Math.sin(angle)) * 42 * freqScale + state.alignment * 9);
                const envelope = Math.exp(-Math.abs(radius - 0.2 - bend * 0.04) * 4.2);
                const intensity = Math.max(0, Math.min(1, 0.25 + ring * 0.32 + caustic * 0.18)) * envelope;
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
        const source = { x: width * 0.16, y: height * (0.28 + state.alignment * 0.34) };
        const lens = { x: width * 0.5, y: height * 0.5 };
        const observer = { x: width * 0.86, y: height * 0.5 };
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
            }, lens, state, time || 0);
        }

        ctx.setLineDash([8, 9]);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(observer.x, observer.y);
        ctx.stroke();
        ctx.setLineDash([]);

        const bendStrength = Math.min(130, 28 + state.mass * 0.82);
        const upper = lens.y - splitPx;
        const lower = lens.y + splitPx * 0.82;

        drawPath([
            source,
            { x: lens.x - width * 0.05, y: upper, cx: lens.x - bendStrength, cy: upper - bendStrength * 0.22 },
            { x: observer.x, y: observer.y, cx: lens.x + bendStrength, cy: upper - bendStrength * 0.16 }
        ], 'rgba(0, 240, 255, 0.88)', 3);
        drawPath([
            source,
            { x: lens.x - width * 0.045, y: lower, cx: lens.x - bendStrength, cy: lower + bendStrength * 0.22 },
            { x: observer.x, y: observer.y, cx: lens.x + bendStrength, cy: lower + bendStrength * 0.16 }
        ], 'rgba(255, 0, 255, 0.72)', 2.5);

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
            drawGlowingCircle(lens.x + ringRadius * 0.9, lens.y - splitPx * 0.35, 5 + state.magnification, 'rgba(255,255,255,ALPHA)', 0.92);
            drawGlowingCircle(lens.x - ringRadius * 0.7, lens.y + splitPx * 0.28, 3 + state.magnification * 0.42, 'rgba(0,240,255,ALPHA)', 0.66);
        }

        drawGlowingCircle(source.x, source.y, 8, 'rgba(255,0,255,ALPHA)', 0.85);
        drawGlowingCircle(lens.x, lens.y, 14 + state.mass * 0.07, 'rgba(0,240,255,ALPHA)', 0.9);
        drawGlowingCircle(observer.x, observer.y, 9, 'rgba(255,255,255,ALPHA)', 0.85);

        drawText('source', source.x, source.y - 24);
        drawText('lens mass', lens.x, lens.y + 42);
        drawText('observer', observer.x, observer.y - 24);

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
            ? 'Interference-style structure changes with frequency.'
            : 'Ray paths bend around the lens into apparent images.',
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
        paper.channelWidth.addEventListener('change', requestDraw);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
});
