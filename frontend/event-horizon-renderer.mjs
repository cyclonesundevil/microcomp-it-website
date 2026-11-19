import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RS_KM, DISK_OUTER, STAR_ANG_RADIUS, STAR_AZIMUTH, kerrHorizon, kerrIsco } from './event-horizon-physics.mjs';
import { quadVertexShader, blackHoleFragmentShader, finalPassShader } from './event-horizon-shaders.mjs';
import { createEventHorizonProbes } from './event-horizon-probes.mjs';

export const EVENT_HORIZON_DEFAULTS = Object.freeze({
  distanceKm: 800,     // target height above the event horizon
  timeScale: 1,
  fov: 95,             // the hole is huge from here, so the lens is wide
  spin: 0,
  inclination: 15,     // tilt of the disk / binary orbital plane toward the shuttle, degrees
  lensing: true, doppler: true, disk: true, star: true, stream: true, bloom: true,
  cockpit: true,
  steps: 220,
  resScale: 0.6,
  exposure: 1.0,
  paused: false,
});
export const DIST_MIN = 300, DIST_MAX = 1000;


/**
 * Host owns input, model clock and RAF. This renderer never schedules frames.
 * Legacy state retains r_s units and fixed 70-solar-mass physics for parity.
 * resize accepts CSS pixels and an explicit DPR; render accepts model time in
 * r_s/c units and wallTime/deltaTime in seconds. The host must hold modelTime
 * while params.paused is true; camera interaction may continue while paused.
 * The host disposes its own controls/listeners before calling dispose().
 */
export function createEventHorizonRenderer({ container, initialState = {}, renderer: sharedRenderer, camera: sharedCamera }) {
  const params = { ...EVENT_HORIZON_DEFAULTS, ...initialState };
  let disposed = false;
  const ownsRenderer = !sharedRenderer;
  const renderer = sharedRenderer || new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  if (ownsRenderer) container.prepend(renderer.domElement);
  const canvas = renderer.domElement;

  // This camera is never used to draw geometry: it only carries the shuttle's
  // position and orientation, which are handed to the shader as uniforms.
  const camera = sharedCamera || new THREE.PerspectiveCamera(params.fov, 1, 0.1, 100);
  if (!sharedCamera) camera.position.set(0, 0, (RS_KM + params.distanceKm) / RS_KM);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCamPos: { value: new THREE.Vector3() }, uCamRight: { value: new THREE.Vector3() },
    uCamUp: { value: new THREE.Vector3() }, uCamFwd: { value: new THREE.Vector3() },
    uTanHalfFov: { value: 1 },
    uTime: { value: 0 },
    uSteps: { value: params.steps },
    uSpin: { value: 0 }, uHorizon: { value: 1 }, uIsco: { value: 3 }, uDiskOuter: { value: DISK_OUTER },
    uDiskN: { value: new THREE.Vector3() }, uDiskE1: { value: new THREE.Vector3() }, uDiskE2: { value: new THREE.Vector3() },
    uObsLapse: { value: 1 }, uSkyBoost: { value: 1 },
    uStarDir: { value: new THREE.Vector3() }, uStarAng: { value: STAR_ANG_RADIUS }, uStarPhi: { value: STAR_AZIMUTH },
    uLensing: { value: 1 }, uDoppler: { value: 1 }, uDisk: { value: 1 }, uStar: { value: 1 }, uStream: { value: 1 },
    uProbes: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    uProbeCol: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    uProbeCount: { value: 0 },
  };

  // Full-screen quad that runs the ray marcher.
  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: quadVertexShader, fragmentShader: blackHoleFragmentShader, depthTest: false, depthWrite: false })
  );
  quad.frustumCulled = false;
  quadScene.add(quad);

  // The ray marcher draws into this reduced-resolution HDR buffer, which the
  // post-processing chain then upscales to the full window.
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });

  /* ---------- post-processing: HDR buffer → bloom → tone map ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new TexturePass(sceneTarget.texture));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.4, 1.2);   // strength, radius, threshold
  composer.addPass(bloomPass);
  const finalPass = new ShaderPass(finalPassShader);
  composer.addPass(finalPass);

  const diskN = new THREE.Vector3(), diskE1 = new THREE.Vector3(1, 0, 0), diskE2 = new THREE.Vector3();
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), camFwd = new THREE.Vector3();
  const probeSystem = createEventHorizonProbes({ params, camera, canvas, uniforms, diskN, diskE1, diskE2, camRight, camUp, camFwd });
  function resize({ width, height, pixelRatio = 1 }) {
    if (disposed) return;
    const w = Math.max(1, width), h = Math.max(1, height);
    const dpr = Math.min(pixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    const rw = Math.max(2, Math.floor(w * dpr * params.resScale));
    const rh = Math.max(2, Math.floor(h * dpr * params.resScale));
    sceneTarget.setSize(rw, rh);
    uniforms.uResolution.value.set(rw, rh);
    camera.aspect = w / h;
  }

  function updateDiskOrientation() {
    const inc = THREE.MathUtils.degToRad(params.inclination);
    diskN.set(0, Math.cos(inc), Math.sin(inc));
    diskE2.crossVectors(diskN, diskE1);

  }
  function render({ modelTime, deltaModelTime = 0, wallTime, deltaTime = 0, currentDistKm,
    lookYaw = 0, lookPitch = 0, physicalState = null, cinematicMotion = true }) {
    if (disposed) return;
    if (physicalState) {
      params.spin = physicalState.spin;
      params.inclination = 0; // Playground camera moves around a fixed spin axis.
    }
    updateDiskOrientation();
    camera.updateMatrixWorld();
    const t = wallTime, dt = deltaTime, simTime = physicalState?.modelTimeRs ?? modelTime;
    const camR = physicalState?.observerRadiusRs ?? (RS_KM + currentDistKm) / RS_KM;
    // --- camera basis, with head-turn offsets and station-keeping shake ---
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    camFwd.setFromMatrixColumn(camera.matrixWorld, 2).negate();
    const close = cinematicMotion ? THREE.MathUtils.clamp((DIST_MAX - currentDistKm) / (DIST_MAX - DIST_MIN), 0, 1) : 0;
    const shake = 0.0006 + 0.004 * close * close;
    const yaw   = lookYaw   + (cinematicMotion ? 0.004 * Math.sin(t * 0.31) + shake * (Math.sin(t * 13.1) + Math.sin(t * 7.3 + 1.0)) : 0);
    const pitch = lookPitch + (cinematicMotion ? 0.003 * Math.sin(t * 0.23 + 2.0) + shake * (Math.sin(t * 11.7 + 0.5) + Math.sin(t * 5.9)) : 0);
    camFwd.applyAxisAngle(camUp, yaw);  camRight.applyAxisAngle(camUp, yaw);
    camFwd.applyAxisAngle(camRight, pitch);  camUp.applyAxisAngle(camRight, pitch);


    // --- uniforms ---
    const lapse = params.lensing ? Math.sqrt(1 - 1 / camR) : 1;
    uniforms.uCamPos.value.copy(camera.position);
    uniforms.uCamRight.value.copy(camRight); uniforms.uCamUp.value.copy(camUp); uniforms.uCamFwd.value.copy(camFwd);
    uniforms.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(physicalState ? camera.fov : params.fov) / 2);
    uniforms.uTime.value = simTime;
    uniforms.uSteps.value = params.steps;
    uniforms.uSpin.value = params.lensing ? params.spin : 0;
    uniforms.uHorizon.value = physicalState ? physicalState.physics.horizonRadiusRg / 2 : (params.lensing ? kerrHorizon(params.spin) : 1);
    uniforms.uIsco.value = physicalState ? physicalState.physics.iscoRadiusRg / 2 : Math.max(kerrIsco(params.spin), 1.02);
    uniforms.uDiskN.value.copy(diskN); uniforms.uDiskE1.value.copy(diskE1); uniforms.uDiskE2.value.copy(diskE2);
    uniforms.uStarDir.value.set(0, 0, 0).addScaledVector(diskE1, Math.cos(STAR_AZIMUTH)).addScaledVector(diskE2, Math.sin(STAR_AZIMUTH));
    uniforms.uObsLapse.value = lapse;
    uniforms.uSkyBoost.value = 1 / lapse ** 3;       // starlight arrives blueshifted and brighter for a hovering observer
    uniforms.uLensing.value = +params.lensing; uniforms.uDoppler.value = +params.doppler;
    uniforms.uDisk.value = +params.disk; uniforms.uStar.value = +params.star; uniforms.uStream.value = +params.stream;
    bloomPass.enabled = params.bloom;
    finalPass.uniforms.uTime.value = t;
    finalPass.uniforms.uExposure.value = params.exposure;

    probeSystem.stepProbes(params.paused ? 0 : deltaModelTime, wallTime * 1000);

    // --- draw: ray march into the HDR buffer, then post-process to the screen ---
    renderer.setRenderTarget(sceneTarget);
    renderer.render(quadScene, quadCamera);
    renderer.setRenderTarget(null);
    composer.render(dt);

  }

  function setState(snapshot) { if (!disposed) Object.assign(params, snapshot); }
  function pause() { setState({ paused: true }); }
  function resume() { setState({ paused: false }); }
  function dispose() {
    if (disposed) return;
    disposed = true;
    probeSystem.clear();
    for (const pass of composer.passes) pass.dispose?.();
    composer.dispose();
    sceneTarget.dispose();
    quad.geometry.dispose(); quad.material.dispose();
    quadScene.clear();
    if (ownsRenderer) { renderer.dispose(); canvas.remove(); }
  }
  return { params, canvas, camera, uniforms, bloomPass, diskN, probeSystem, resize, render,
    updateDiskOrientation, setState, pause, resume, dispose,
    get disposed() { return disposed; },
    get memory() { return { ...renderer.info.memory }; }
  };
}
