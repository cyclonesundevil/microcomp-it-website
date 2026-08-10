function boundedMode(mode) {
    return ['plus', 'cross', 'both'].includes(mode) ? mode : 'both';
}

export function polarizationComponents(snapshot, mode = 'both') {
    const selected = boundedMode(mode);
    const reference = Math.max(1e-30, snapshot.strainAmplitude);
    return {
        hPlus: selected === 'cross' ? 0 : snapshot.hPlus,
        hCross: selected === 'plus' ? 0 : snapshot.hCross,
        displayPlus: selected === 'cross' ? 0 : snapshot.hPlus / reference,
        displayCross: selected === 'plus' ? 0 : snapshot.hCross / reference
    };
}

export function deformTransversePoint(x, y, displayPlus, displayCross, visualGain = 0.2) {
    return {
        x: x + visualGain * (displayPlus * x + displayCross * y),
        y: y + visualGain * (displayCross * x - displayPlus * y)
    };
}

function prepareCanvas(canvas) {
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#020711';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return context;
}

function drawParticle(context, x, y, radius, color) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
}

export class BinaryWaveInstrumentRenderer {
    constructor(polarizationCanvas, detectorCanvas) {
        this.polarizationCanvas = polarizationCanvas;
        this.detectorCanvas = detectorCanvas;
    }

    draw(snapshot, mode = 'both') {
        const components = polarizationComponents(snapshot, mode);
        this.drawPolarizationRing(components, mode);
        this.drawDetector(components, mode);
        return components;
    }

    drawPolarizationRing(components, mode) {
        const canvas = this.polarizationCanvas;
        const context = prepareCanvas(canvas);
        if (!context) return;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(canvas.width, canvas.height) * 0.31;
        context.strokeStyle = 'rgba(119, 169, 224, .2)';
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.stroke();
        for (let index = 0; index < 20; index += 1) {
            const angle = index / 20 * Math.PI * 2;
            const point = deformTransversePoint(
                Math.cos(angle) * radius,
                Math.sin(angle) * radius,
                components.displayPlus,
                components.displayCross,
                0.24
            );
            drawParticle(context, centerX + point.x, centerY + point.y, 3.1, index % 2 ? '#69b7ff' : '#ffb45f');
        }
        context.fillStyle = '#d6e2f0';
        context.font = '700 12px Inter, sans-serif';
        context.fillText(mode === 'plus' ? 'h+' : mode === 'cross' ? 'h×' : 'h+ and h×', 10, 18);
    }

    drawDetector(components, mode) {
        const canvas = this.detectorCanvas;
        const context = prepareCanvas(canvas);
        if (!context) return;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2 + 8;
        const armLength = Math.min(canvas.width * 0.31, canvas.height * 0.34);
        const orientation = mode === 'cross'
            ? Math.PI / 4
            : mode === 'both'
                ? 0.5 * Math.atan2(components.displayCross, components.displayPlus || 1e-12)
                : 0;
        const basisX = { x: Math.cos(orientation) * armLength, y: Math.sin(orientation) * armLength };
        const basisY = { x: -Math.sin(orientation) * armLength, y: Math.cos(orientation) * armLength };
        const armX = deformTransversePoint(basisX.x, basisX.y, components.displayPlus, components.displayCross, 0.2);
        const armY = deformTransversePoint(basisY.x, basisY.y, components.displayPlus, components.displayCross, 0.2);

        context.lineWidth = 5;
        context.lineCap = 'round';
        for (const [arm, color] of [[armX, '#ffb45f'], [armY, '#69b7ff']]) {
            context.strokeStyle = color;
            context.beginPath();
            context.moveTo(centerX, centerY);
            context.lineTo(centerX + arm.x, centerY + arm.y);
            context.stroke();
            context.fillStyle = '#e8eef7';
            context.fillRect(centerX + arm.x - 5, centerY + arm.y - 5, 10, 10);
        }
        drawParticle(context, centerX, centerY, 6, '#ffffff');
        context.fillStyle = '#d6e2f0';
        context.font = '700 12px Inter, sans-serif';
        context.fillText('Michelson detector response', 10, 18);
    }
}
