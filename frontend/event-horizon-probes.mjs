import * as THREE from 'three';
import { DISK_OUTER, FRAME_DRAG_K } from './event-horizon-physics.mjs';

/** Legacy probe trajectories and ray picking; no DOM listeners or scheduler. */
export function createEventHorizonProbes({ params, camera, canvas, uniforms, diskN, diskE1, diskE2, camRight, camUp, camFwd }) {
  const probes = [];                 // each: { r, phi } in the disk plane, plus display state
  let probeSerial = 0;
  let lastProbeMessage = '', lastProbeMessageUntil = 0;


  // CPU copy of the shader's photon acceleration, used only for click picking.
  const _h = new THREE.Vector3(), _B = new THREE.Vector3(), _t = new THREE.Vector3();
  function photonAccel(p, v, out) {
    if (!params.lensing) return out.set(0, 0, 0);
    const r2 = p.lengthSq(), r = Math.sqrt(r2);
    _h.crossVectors(p, v);
    out.copy(p).multiplyScalar(-1.5 * _h.lengthSq() / (r2 * r2 * r));
    if (params.spin > 0) {
      const nd = diskN.dot(p) / r;
      _B.copy(p).multiplyScalar(3 * nd / r).sub(diskN).multiplyScalar(1 / (r2 * r));
      out.addScaledVector(_t.crossVectors(v, _B), params.spin * FRAME_DRAG_K);
    }
    return out;
  }

  // Follow the bent light ray under the cursor until it first pierces the disk.
  function traceClickToDisk(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1, y = 1 - ((clientY - rect.top) / rect.height) * 2;
    const tan = uniforms.uTanHalfFov.value;
    const dir = camFwd.clone().addScaledVector(camRight, x * camera.aspect * tan).addScaledVector(camUp, y * tan).normalize();
    const pos = camera.position.clone();
    if (params.lensing) {
      const r0 = pos.length(), rhat = pos.clone().divideScalar(r0), dr = dir.dot(rhat);
      dir.addScaledVector(rhat, dr * (Math.sqrt(1 - 1 / r0) - 1)).normalize();
    }
    const vel = dir, a = new THREE.Vector3(), np = new THREE.Vector3();
    let hPrev = pos.dot(diskN);
    for (let i = 0; i < 400; i++) {
      const r = pos.length();
      if (r < uniforms.uHorizon.value || r > 60) return null;
      const dt = Math.max(0.1 * r / vel.length(), 0.01);
      vel.addScaledVector(photonAccel(pos, vel, a), 0.5 * dt);
      np.copy(pos).addScaledVector(vel, dt);
      vel.addScaledVector(photonAccel(np, vel, a), 0.5 * dt);
      const hNew = np.dot(diskN);
      if (hPrev * hNew < 0) {
        const hit = pos.clone().lerp(np, hPrev / (hPrev - hNew)), rh = hit.length();
        if (rh > 1.15 && rh < DISK_OUTER) return { r: rh, phi: Math.atan2(hit.dot(diskE2), hit.dot(diskE1)) };
      }
      pos.copy(np); hPrev = hNew;
    }
    return null;
  }

  function dropProbe(clientX, clientY) {
    if (!params.disk) return;
    const hit = traceClickToDisk(clientX, clientY);
    if (!hit) return false;
    return addProbe(hit);
  }

  function addProbe(hit) {
    if (probes.length >= 4) probes.shift();
    probes.push({ id: ++probeSerial, r: hit.r, phi: hit.phi });
    return true;
  }

  function releaseProbe({ radiusRs = 6, azimuthRadians = 0 } = {}) {
    if (!Number.isFinite(radiusRs) || !Number.isFinite(azimuthRadians)
      || radiusRs <= uniforms.uIsco.value || radiusRs >= DISK_OUTER) return false;
    return addProbe({ r: radiusRs, phi: azimuthRadians });
  }

  // Probe motion in Schwarzschild coordinate time (what the distant shuttle sees).
  //  • Outside the ISCO: a circular Keplerian orbit with a steady inward drift
  //    (the probe brakes; real gas drifts in far more slowly).
  //  • Inside the ISCO: the exact plunge geodesic for E² = 8/9, L² = 3 r_s².
  //  Both dr/dt and dφ/dt carry the factor (1 − r_s/r), so the probe never
  //  quite reaches the horizon: it slows, reddens and freezes just outside.
  function stepProbes(dtSim, now) {
    const obsLapse = uniforms.uObsLapse.value;
    for (let i = probes.length - 1; i >= 0; i--) {
      const p = probes[i];
      let remaining = dtSim;
      while (remaining > 1e-6) {
        const h = Math.min(remaining, 0.05); remaining -= h;
        const lapse2 = 1 - 1 / p.r;
        const plunge = Math.sqrt(Math.max(0, 1 - lapse2 * (1 + 3 / (p.r * p.r)) * 9 / 8));
        p.r -= lapse2 * (plunge + 0.06) * h;
        p.phi += (p.r > 3 ? Math.sqrt(0.5 / p.r ** 3) : lapse2 * Math.sqrt(3) / (Math.sqrt(8 / 9) * p.r * p.r)) * h;
      }
      p.g = Math.sqrt(Math.max(1 - 1 / p.r, 0)) / obsLapse;     // gravitational redshift factor seen from the shuttle
      if (p.g < 0.04) {
        lastProbeMessage = `PROBE ${p.id}: signal lost — frozen at horizon`;
        lastProbeMessageUntil = now + 6000;
        probes.splice(i, 1);
      }
    }
    // Hand the survivors to the shader.
    uniforms.uProbeCount.value = probes.length;
    probes.forEach((p, i) => {
      uniforms.uProbes.value[i].set(0, 0, 0, 0)
        .addScaledVector(diskE1, p.r * Math.cos(p.phi)).addScaledVector(diskE2, p.r * Math.sin(p.phi));
      uniforms.uProbes.value[i].w = 7 * p.g ** 3;
      // Colour slides from blue-white through orange to deep red as g falls.
      const g = Math.min(p.g, 1), c = uniforms.uProbeCol.value[i];
      if (g > 0.5) c.set(1, 0.6, 0.2).lerp(_t.set(0.6, 0.95, 1.0), (g - 0.5) * 2);
      else c.set(0.9, 0.04, 0.0).lerp(_t.set(1, 0.6, 0.2), g * 2);
    });
  }


  return { probes, dropProbe, releaseProbe, stepProbes, clear() { probes.length = 0; uniforms.uProbeCount.value = 0; }, get lastProbeMessage() { return lastProbeMessage; }, get lastProbeMessageUntil() { return lastProbeMessageUntil; } };
}
