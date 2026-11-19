import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { createEventHorizonRenderer, DIST_MIN, DIST_MAX } from './event-horizon-renderer.mjs';
import { G, C, BH_MASS, RS_M, RS_KM, T_UNIT, SHUTTLE_LENGTH, G0, SIM_RATE } from './event-horizon-physics.mjs';

function startEventHorizonPage() {
  const listeners = new AbortController();
  const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: listeners.signal });
  let disposed = false, frameId = null;
  const engine = createEventHorizonRenderer({ container: document.body });
  const { params, canvas, camera, uniforms, bloomPass, diskN } = engine;
  const probes = engine.probeSystem.probes;
  function resize() { engine.resize({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio || 1 }); }
  listen(window, 'resize', resize);
  resize();
  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45;
  controls.minDistance = 1.5;                       // never inside the photon sphere
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: null, RIGHT: null };

  let currentDistKm = params.distanceKm;            // eased toward params.distanceKm
  let lookYaw = 0, lookPitch = 0;                   // right-drag "turn your head" offsets
  const keys = new Set();

  listen(canvas, 'wheel', (e) => {
    e.preventDefault();
    params.distanceKm = THREE.MathUtils.clamp(params.distanceKm + e.deltaY * 0.4, DIST_MIN, DIST_MAX);
  }, { passive: false });

  // Right-drag looks around; a left click that does not move drops a probe.
  let looking = false, downX = 0, downY = 0, downT = 0;
  listen(canvas, 'pointerdown', (e) => {
    if (e.button === 2) { looking = true; canvas.setPointerCapture(e.pointerId); }
    if (e.button === 0) { downX = e.clientX; downY = e.clientY; downT = performance.now(); }
  });
  listen(canvas, 'pointermove', (e) => {
    if (!looking) return;
    lookYaw   = THREE.MathUtils.clamp(lookYaw   - e.movementX * 0.003, -2.6, 2.6);
    lookPitch = THREE.MathUtils.clamp(lookPitch - e.movementY * 0.003, -1.4, 1.4);
  });
  listen(canvas, 'pointerup', (e) => {
    if (e.button === 2) looking = false;
    if (e.button === 0 && Math.hypot(e.clientX - downX, e.clientY - downY) < 5 && performance.now() - downT < 400) {
      engine.probeSystem.dropProbe(e.clientX, e.clientY);
    }
  });
  listen(canvas, 'contextmenu', (e) => e.preventDefault());

  listen(window, 'keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;       // don't hijack typing in the control panel
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === ' ') { params.paused = !params.paused; e.preventDefault(); }
    if (k === 'h') { params.cockpit = !params.cockpit; applyCockpit(); }
    if (k === 'r') { lookYaw = 0; lookPitch = 0; }
  });
  listen(window, 'keyup', (e) => keys.delete(e.key.toLowerCase()));
  listen(window, 'blur', () => keys.clear());

  const cockpitEl = document.getElementById('cockpit');
  function applyCockpit() { cockpitEl.classList.toggle('off', !params.cockpit); }

  /* ---------- control panel ---------- */
  const gui = new GUI({ title: 'Flight controls' });
  if (window.matchMedia('(max-width: 600px)').matches) gui.close();
  const fFlight = gui.addFolder('Shuttle');
  fFlight.add(params, 'distanceKm', DIST_MIN, DIST_MAX, 1).name('Distance (km)').listen();
  fFlight.add(params, 'timeScale', 0, 10, 0.1).name('Time scale ×');
  fFlight.add(params, 'fov', 60, 130, 1).name('Field of view °');
  fFlight.add(params, 'cockpit').name('Cockpit frame (H)').onChange(applyCockpit).listen();
  const fHole = gui.addFolder('Black hole');
  fHole.add(params, 'spin', 0, 0.99, 0.01).name('Spin a (approx.)');
  fHole.add(params, 'inclination', 3, 85, 1).name('Disk inclination °');
  const fLayers = gui.addFolder('Layers');
  fLayers.add(params, 'lensing').name('Gravitational lensing');
  fLayers.add(params, 'doppler').name('Doppler beaming');
  fLayers.add(params, 'disk').name('Accretion disk');
  fLayers.add(params, 'star').name('Companion star');
  fLayers.add(params, 'stream').name('Gas stream');
  fLayers.add(params, 'bloom').name('Bloom');
  const fQuality = gui.addFolder('Quality');
  fQuality.add(params, 'steps', 60, 500, 10).name('Ray-march steps');
  fQuality.add(params, 'resScale', 0.25, 1, 0.05).name('Resolution scale').onChange(resize);
  fQuality.add(params, 'exposure', 0.3, 3, 0.05).name('Exposure');
  fQuality.close();
  gui.add({ clear: () => engine.probeSystem.clear() }, 'clear').name('Clear probes');
  if (window.innerWidth < 900) gui.close();

  const hudEl = document.getElementById('hud');
  const fmt = (v, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sci = (v) => { const e = Math.floor(Math.log10(v)); return `${(v / 10 ** e).toFixed(2)}×10<sup>${e}</sup>`; };
  let fpsSmooth = 60;

  function updateHud(now) {
    const rM = RS_M + currentDistKm * 1000;          // radial coordinate of the shuttle, metres
    const x = rM / RS_M;                             // … in units of r_s
    const lapse = Math.sqrt(1 - 1 / x);
    const tidalG = 2 * G * BH_MASS * SHUTTLE_LENGTH / rM ** 3 / G0;       // stretch across the shuttle's length
    const hoverG = G * BH_MASS / (rM * rM * lapse) / G0;                   // thrust needed to hover
    const shadowDeg = 2 * THREE.MathUtils.radToDeg(Math.asin(Math.min(1, 2.598 / x * lapse)));
    const orbitMs = 2 * Math.PI * Math.sqrt(2 * x ** 3) * T_UNIT * 1000;
    const aboveSphere = x - 1.5;

    let level = '', status = 'STATION KEEPING — NOMINAL';
    if (x < 3.2) { level = 'danger'; status = '⚠ PHOTON SPHERE PROXIMITY'; }
    else if (x < 4.4) { level = 'warn'; status = 'CAUTION — DEEP GRAVITY WELL'; }
    if (params.paused) status = '❚❚ TIME PAUSED';
    hudEl.className = level;

    const row = (a, b) => `<div class="row"><span>${a}</span><span>${b}</span></div>`;
    let html = `<div class="title">STS HORIZON · 70 M☉ · r<sub>s</sub> = ${fmt(RS_KM, 1)} km</div>`;
    html += row('Above horizon', `${fmt(currentDistKm, 0)} km`);
    html += row('Radius', `${fmt(x, 2)} r<sub>s</sub>`);
    html += row('Above photon sphere', `${fmt(aboveSphere, 2)} r<sub>s</sub>`);
    html += `<div class="sep"></div>`;
    html += row('Time dilation', `1 s aboard = ${fmt(1 / lapse, 3)} s far away`);
    html += row('Escape velocity', `${fmt(Math.sqrt(1 / x), 3)} c`);
    html += row('Tidal stretch (37 m)', `${sci(tidalG)} g`);
    html += row('Thrust to hover', `${sci(hoverG)} g`);
    html += row('Orbit period here', `${fmt(orbitMs, 1)} ms`);
    html += row('Shadow diameter', `${fmt(shadowDeg, 0)}° of sky`);
    html += `<div class="sep"></div>`;
    html += row('Slow motion', params.paused ? 'paused' : `1 s = ${fmt(SIM_RATE * params.timeScale * T_UNIT * 1000, 2)} ms`);
    html += row('Frame rate', `${fmt(fpsSmooth, 0)} fps`);
    for (const p of probes) {
      const z = 1 / Math.max(p.g, 1e-3) - 1;
      html += row(`Probe ${p.id}`, `${fmt(p.r, 3)} r<sub>s</sub> · z = ${z > 0 ? '+' : ''}${fmt(z, 2)}`);
    }
    const { lastProbeMessage, lastProbeMessageUntil } = engine.probeSystem;
    if (now < lastProbeMessageUntil) html += `<div class="status">${lastProbeMessage}</div>`;
    html += `<div class="status">${status}</div>`;
    hudEl.innerHTML = html;
  }


  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameId); frameId = null;
    listeners.abort(); controls.dispose(); gui.destroy(); engine.dispose();
  }
  listen(window, 'pagehide', event => { if (!event.persisted) dispose(); });
  let simTime = 0, lastNow = performance.now(), lastHud = 0;

  function frame(now) {
    if (disposed) return;
    frameId = requestAnimationFrame(frame);
    const dt = Math.min((now - lastNow) / 1000, 0.1);
    lastNow = now;
    fpsSmooth += (1 / Math.max(dt, 1e-3) - fpsSmooth) * 0.05;
    const t = now / 1000;

    // --- orientation of the disk / binary orbital plane ---
    engine.updateDiskOrientation();

    // --- keyboard flight ---
    if (keys.has('w')) params.distanceKm -= 160 * dt;
    if (keys.has('s')) params.distanceKm += 160 * dt;
    params.distanceKm = THREE.MathUtils.clamp(params.distanceKm, DIST_MIN, DIST_MAX);
    if (keys.has('a')) camera.position.applyAxisAngle(diskN, -0.5 * dt);
    if (keys.has('d')) camera.position.applyAxisAngle(diskN, 0.5 * dt);

    // --- eased distance, then let OrbitControls do its orbiting ---
    currentDistKm += (params.distanceKm - currentDistKm) * (1 - Math.exp(-dt * 4));
    const camR = (RS_KM + currentDistKm) / RS_KM;
    camera.position.setLength(camR);
    controls.update();
    camera.updateMatrixWorld();

    const dtSim = params.paused ? 0 : dt * params.timeScale * SIM_RATE;
    simTime += dtSim;
    engine.render({ modelTime: simTime, deltaModelTime: dtSim, wallTime: t,
      deltaTime: dt, currentDistKm, lookYaw, lookPitch });

    if (now - lastHud > 120) { updateHud(now); lastHud = now; }
  }
  applyCockpit();
  frameId = requestAnimationFrame(frame);
  window.__eh = { params, uniforms, bloomPass, engine, dispose, pause: engine.pause, resume: engine.resume };   // handy for poking at the scene from the console

}
try {
  if (!document.createElement('canvas').getContext('webgl2')) throw new Error('WebGL2 not available');
  startEventHorizonPage();
} catch (error) {
  document.getElementById('fallback').style.display = 'flex';
  console.error('Event Horizon could not start.', error);
}
