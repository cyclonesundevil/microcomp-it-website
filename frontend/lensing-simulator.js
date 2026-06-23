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
    const controls = {
        mass: document.getElementById('lens-mass'),
        sourceDistance: document.getElementById('source-distance'),
        observerDistance: document.getElementById('observer-distance'),
        alignment: document.getElementById('alignment'),
        frequency: document.getElementById('lens-frequency')
    };
    const values = {
        mass: document.getElementById('lens-mass-value'),
        sourceDistance: document.getElementById('source-distance-value'),
        observerDistance: document.getElementById('observer-distance-value'),
        alignment: document.getElementById('alignment-value'),
        frequency: document.getElementById('lens-frequency-value')
    };
    const readouts = {
        einstein: document.getElementById('einstein-readout'),
        magnification: document.getElementById('magnification-readout'),
        delay: document.getElementById('delay-readout'),
        split: document.getElementById('split-readout')
    };
    const modeButtons = document.querySelectorAll('[data-mode]');

    let mode = 'geometric';
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

        values.mass.textContent = `${state.mass} solar masses`;
        values.sourceDistance.textContent = `${state.sourceDistance.toFixed(1)} kpc`;
        values.observerDistance.textContent = `${state.observerDistance.toFixed(1)} kpc`;
        values.alignment.textContent = `${(state.beta * 0.28).toFixed(2)} arcsec`;
        values.frequency.textContent = `${(state.frequency / 1000).toFixed(1)} GHz`;

        readouts.einstein.textContent = `${state.einstein.toFixed(2)} arcsec`;
        readouts.magnification.textContent = `${state.magnification.toFixed(1)}x`;
        readouts.delay.textContent = `${state.delay.toFixed(1)} ms`;
        readouts.split.textContent = `${state.split.toFixed(2)} arcsec`;

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
    }

    Object.values(controls).forEach((control) => {
        control.addEventListener('input', requestDraw);
    });

    modeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            mode = button.dataset.mode;
            modeButtons.forEach((item) => item.classList.toggle('active', item === button));
            stopWaveAnimation();
            lastWaveFrame = 0;
            draw(performance.now());
        });
    });

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
});
