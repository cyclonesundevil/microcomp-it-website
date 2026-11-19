export const DISK_RENDER_QUALITY = Object.freeze({
    performance: Object.freeze({ steps: 96, resScale: 0.4, bloom: false }),
    balanced: Object.freeze({ steps: 220, resScale: 0.6, bloom: true }),
    high: Object.freeze({ steps: 360, resScale: 0.85, bloom: true })
});

/** Page controls and modal presentation only; never creates a canvas or RAF. */
export function createBlackHoleExperience({ section, container, getSnapshot, getRenderer,
    onDistanceChange, onResize, onRedraw }) {
    const ids = ['distance', 'distance-value', 'lensing', 'doppler', 'quality', 'quality-help',
        'disk-tools', 'enter-immersive', 'exit-immersive', 'immersive-dialog', 'immersive-slot',
        'immersive-controls', 'cockpit', 'cockpit-readouts', 'cockpit-summary',
        'launch-probe', 'clear-probes', 'probe-status'];
    const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(`bh-${id}`)]));
    const listeners = new AbortController();
    const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: listeners.signal });
    const dialog = elements['immersive-dialog'];
    let placeholder = null, savedScroll = 0, previousProbeCount = -1;
    let pointerStart = null, disposed = false;
    const settings = { lensing: true, doppler: true, quality: 'balanced' };

    function getRenderSettings() {
        return { ...DISK_RENDER_QUALITY[settings.quality], lensing: settings.lensing, doppler: settings.doppler };
    }
    function canProbe() {
        return getSnapshot().spin === 0 && settings.lensing && Boolean(getRenderer());
    }
    function writeText(element, text) { if (element.textContent !== text) element.textContent = text; }
    function setProbeMessage(message) { writeText(elements['probe-status'], message); }
    function update() {
        if (disposed) return;
        const state = getSnapshot(), engine = getRenderer();
        if (Number(elements.distance.value) !== state.observerRadiusRg) elements.distance.value = state.observerRadiusRg;
        writeText(elements['distance-value'], `${state.observerRadiusRg.toFixed(1)} r_g · ${Math.round(state.observerRadiusKm).toLocaleString()} km`);
        elements['enter-immersive'].disabled = !engine;
        if (!canProbe() && engine?.probeSystem.probes.length) engine.probeSystem.clear();
        const count = engine?.probeSystem.probes.length || 0;
        elements['launch-probe'].disabled = !canProbe();
        elements['clear-probes'].disabled = count === 0;
        if (!canProbe()) {
            setProbeMessage(state.spin !== 0 ? 'Set spin to 0 to explore nonrotating probe orbits.' : 'Enable gravitational lensing to launch a probe.');
        } else if (count !== previousProbeCount) {
            setProbeMessage(count ? `${count} ${count === 1 ? 'probe' : 'probes'} in flight.` : 'Ready to launch at 12 r_g, or click the disk.');
        }
        previousProbeCount = count;
        writeText(elements['cockpit-summary'], `${state.massSolar} solar masses · spin ${state.spin.toFixed(2)} · ${state.observerAngleDegrees.toFixed(0)}° · ${state.observerRadiusRg.toFixed(1)} r_g from center`);
    }
    function enterImmersive() {
        if (disposed || dialog.open || !getRenderer()) return;
        savedScroll = window.scrollY;
        placeholder = document.createComment('Black hole playground position');
        section.before(placeholder);
        elements['immersive-slot'].append(section);
        document.body.classList.add('bh-immersive-open');
        elements.cockpit.hidden = false;
        elements['cockpit-readouts'].hidden = false;
        dialog.classList.remove('bh-controls-visible');
        elements['immersive-controls'].setAttribute('aria-expanded', 'false');
        elements['immersive-controls'].textContent = 'Flight controls';
        dialog.showModal();
        onResize();
    }
    function exitImmersive({ restoreFocus = true } = {}) {
        if (!placeholder) return;
        placeholder.replaceWith(section);
        placeholder = null;
        elements.cockpit.hidden = true;
        elements['cockpit-readouts'].hidden = true;
        document.body.classList.remove('bh-immersive-open');
        if (dialog.open) dialog.close();
        onResize();
        window.scrollTo(0, savedScroll);
        if (restoreFocus) elements['enter-immersive'].focus({ preventScroll: true });
    }
    listen(elements.distance, 'input', () => onDistanceChange(Number(elements.distance.value)));
    for (const name of ['lensing', 'doppler']) {
        listen(elements[name], 'change', () => {
            settings[name] = elements[name].checked;
            update(); onRedraw();
        });
    }
    listen(elements.quality, 'change', () => {
        settings.quality = elements.quality.value;
        elements['quality-help'].textContent = {
            performance: 'Lower rendering cost for smoother interaction.',
            balanced: 'Balanced detail and rendering cost.',
            high: 'Finer light paths and a larger render buffer; needs a capable GPU.'
        }[settings.quality];
        onResize();
    });
    listen(elements['enter-immersive'], 'click', enterImmersive);
    listen(elements['exit-immersive'], 'click', () => exitImmersive());
    listen(dialog, 'cancel', event => { event.preventDefault(); exitImmersive(); });
    listen(dialog, 'close', () => exitImmersive());
    listen(elements['immersive-controls'], 'click', () => {
        const visible = dialog.classList.toggle('bh-controls-visible');
        elements['immersive-controls'].setAttribute('aria-expanded', String(visible));
        elements['immersive-controls'].textContent = visible ? 'Hide controls' : 'Flight controls';
        elements['cockpit-readouts'].hidden = visible;
        if (visible) document.getElementById('bh-mass').focus({ preventScroll: true });
    });
    listen(elements['launch-probe'], 'click', () => {
        if (!canProbe()) return;
        getRenderer().probeSystem.releaseProbe({ radiusRs: 6, azimuthRadians: getSnapshot().observerAzimuthRadians });
        update(); onRedraw();
    });
    listen(elements['clear-probes'], 'click', () => {
        getRenderer()?.probeSystem.clear(); update(); onRedraw();
    });
    // The only direct child canvas is the existing shared WebGL canvas.
    const canvas = container.querySelector(':scope > canvas');
    listen(canvas, 'pointerdown', event => {
        pointerStart = event.button === 0 ? { x: event.clientX, y: event.clientY, time: performance.now() } : null;
    });
    listen(canvas, 'pointerup', event => {
        if (event.button !== 0 || !pointerStart) return;
        const start = pointerStart; pointerStart = null;
        if (Math.hypot(event.clientX-start.x, event.clientY-start.y) >= 5 || performance.now()-start.time >= 500 || !canProbe()) return;
        getRenderer().probeSystem.dropProbe(event.clientX, event.clientY);
        update(); onRedraw();
    });
    function setMode(mode) {
        if (mode !== 'disk') exitImmersive({ restoreFocus: false });
        elements['disk-tools'].hidden = mode !== 'disk';
        elements['enter-immersive'].hidden = mode !== 'disk';
        if (mode !== 'disk') getRenderer()?.probeSystem.clear();
    }
    function dispose() {
        if (disposed) return;
        exitImmersive({ restoreFocus: false });
        disposed = true; listeners.abort();
    }
    return { update, setMode, getRenderSettings, enterImmersive, exitImmersive, dispose,
        get immersive() { return dialog.open; } };
}
