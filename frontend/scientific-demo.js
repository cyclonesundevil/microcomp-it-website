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

    const canvas = document.getElementById('phase-canvas');
    const ctx = canvas.getContext('2d');

    const controls = {
        delay: document.getElementById('delay-slider'),
        frequency: document.getElementById('frequency-slider'),
        bandwidth: document.getElementById('bandwidth-slider'),
        plasma: document.getElementById('plasma-slider'),
        zoom: document.getElementById('zoom-slider')
    };

    const values = {
        delay: document.getElementById('delay-value'),
        frequency: document.getElementById('frequency-value'),
        bandwidth: document.getElementById('bandwidth-value'),
        plasma: document.getElementById('plasma-value'),
        zoom: document.getElementById('zoom-value')
    };

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(640, Math.floor(rect.width * dpr));
        canvas.height = Math.floor((canvas.width / 920) * 520);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    function colorRamp(value) {
        const v = Math.max(0, Math.min(1, value));
        const r = Math.floor(20 + 80 * v + 120 * Math.max(0, v - 0.55));
        const g = Math.floor(65 + 155 * v);
        const b = Math.floor(115 + 120 * (1 - Math.abs(v - 0.5)));
        return `rgb(${r}, ${g}, ${b})`;
    }

    function drawGrid(width, height, plot) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 8; i++) {
            const x = plot.x + (plot.w * i) / 8;
            ctx.beginPath();
            ctx.moveTo(x, plot.y);
            ctx.lineTo(x, plot.y + plot.h);
            ctx.stroke();
        }
        for (let i = 0; i <= 6; i++) {
            const y = plot.y + (plot.h * i) / 6;
            ctx.beginPath();
            ctx.moveTo(plot.x, y);
            ctx.lineTo(plot.x + plot.w, y);
            ctx.stroke();
        }

        ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText('time samples', plot.x + plot.w - 92, plot.y + plot.h + 32);
        ctx.save();
        ctx.translate(plot.x - 34, plot.y + 98);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('frequency channels', 0, 0);
        ctx.restore();
    }

    function draw() {
        if (!ctx) return;

        const cssWidth = canvas.clientWidth || 920;
        const cssHeight = cssWidth * (520 / 920);
        canvas.style.height = `${cssHeight}px`;

        const width = cssWidth;
        const height = cssHeight;
        ctx.clearRect(0, 0, width, height);

        const delayPs = Number(controls.delay.value);
        const centerMHz = Number(controls.frequency.value);
        const bandwidthMHz = Number(controls.bandwidth.value);
        const plasmaStrength = Number(controls.plasma.value) / 100;
        const zoom = Number(controls.zoom.value) / 100;
        const sampleSpan = 1 / zoom;
        const sampleStart = 0.5 - sampleSpan / 2;

        values.delay.textContent = `${delayPs} ps`;
        values.frequency.textContent = `${(centerMHz / 1000).toFixed(1)} GHz`;
        values.bandwidth.textContent = `${bandwidthMHz} MHz`;
        values.plasma.textContent = `${Math.round(plasmaStrength * 100)}%`;
        values.zoom.textContent = `${zoom.toFixed(1)}x`;

        ctx.fillStyle = '#050814';
        ctx.fillRect(0, 0, width, height);

        const plot = {
            x: 58,
            y: 38,
            w: width - 92,
            h: height - 104
        };

        const cols = 150;
        const rows = 86;
        const cellW = plot.w / cols;
        const cellH = plot.h / rows;
        const phaseScale = 2 * Math.PI * centerMHz * 1e6 * delayPs * 1e-12;

        for (let row = 0; row < rows; row++) {
            const rawFNorm = row / (rows - 1);
            const fNorm = sampleStart + rawFNorm * sampleSpan;
            const freqMHz = centerMHz - bandwidthMHz / 2 + fNorm * bandwidthMHz;
            const frequencyLinear = freqMHz / centerMHz;
            const plasmaCurve = plasmaStrength * (Math.pow(centerMHz / freqMHz, 2) - 1);

            for (let col = 0; col < cols; col++) {
                const rawT = col / (cols - 1);
                const t = sampleStart + rawT * sampleSpan;
                const burstEnvelope = Math.exp(-Math.pow((t - 0.48 - plasmaCurve * 0.18) / 0.14, 2));
                const weakLensRipple = Math.sin(phaseScale * frequencyLinear + t * 18 + Math.sin(fNorm * 12) * 0.6);
                const residualTexture = Math.sin((t * 34) + (fNorm * 20)) * 0.08;
                const intensity = 0.24 + burstEnvelope * (0.45 + 0.28 * weakLensRipple) + residualTexture;

                ctx.fillStyle = colorRamp(intensity);
                ctx.fillRect(plot.x + col * cellW, plot.y + row * cellH, cellW + 0.5, cellH + 0.5);
            }
        }

        drawGrid(width, height, plot);

        ctx.strokeStyle = 'rgba(0, 240, 255, 0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 180; i++) {
            const rawT = i / 179;
            const t = sampleStart + rawT * sampleSpan;
            const x = plot.x + (plot.w * i) / 179;
            const y = plot.y + plot.h * (0.52 + Math.sin(t * 13 + phaseScale) * 0.08 + Math.sin(t * 5.8) * 0.035);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 0, 255, 0.86)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 180; i++) {
            const rawT = i / 179;
            const t = sampleStart + rawT * sampleSpan;
            const x = plot.x + (plot.w * i) / 179;
            const y = plot.y + plot.h * (0.28 + plasmaStrength * Math.pow(Math.max(0, t), 1.8) * 0.48);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        const phaseTurns = phaseScale / (2 * Math.PI);
        ctx.fillStyle = 'rgba(3, 5, 10, 0.78)';
        ctx.fillRect(plot.x + 16, plot.y + 16, 255, 76);
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.24)';
        ctx.strokeRect(plot.x + 16, plot.y + 16, 255, 76);
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 14px Inter, sans-serif';
        ctx.fillText('Derived phase estimate', plot.x + 32, plot.y + 42);
        ctx.fillStyle = '#a0aec0';
        ctx.font = '13px Inter, sans-serif';
        ctx.fillText(`${phaseTurns.toFixed(3)} cycles at ${(centerMHz / 1000).toFixed(2)} GHz`, plot.x + 32, plot.y + 68);
    }

    Object.values(controls).forEach((control) => {
        control.addEventListener('input', draw);
    });

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
});
