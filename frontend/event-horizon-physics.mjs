/** Legacy fixed-mass physics, preserved for Stage 2 visual parity. Radii use r_s. */
export const G      = 6.67430e-11;        // gravitational constant, m^3 kg^-1 s^-2
export const C      = 299792458;          // speed of light, m/s
export const M_SUN  = 1.98847e30;         // solar mass, kg
export const BH_MASS = 70 * M_SUN;        // a heavy stellar-mass black hole
export const RS_M   = 2 * G * BH_MASS / (C * C);   // Schwarzschild radius ≈ 206.7 km
export const RS_KM  = RS_M / 1000;
export const T_UNIT = RS_M / C;           // light-crossing time of one r_s ≈ 0.69 ms
export const SHUTTLE_LENGTH = 37;         // m (Space Shuttle orbiter)
export const G0 = 9.80665;                // standard gravity, m/s^2

// The companion: an O-type star in a tight X-ray binary (Cygnus X-1-like).
// It is ~200,000 r_s away, so the shader treats it as being at infinity.
export const STAR_DISTANCE_KM = 45e6;
export const STAR_RADIUS_KM   = 6.3e6;    // ≈ 9 solar radii
export const STAR_ANG_RADIUS  = Math.asin(STAR_RADIUS_KM / STAR_DISTANCE_KM);   // ≈ 8°
export const STAR_AZIMUTH     = 65 * Math.PI / 180;   // position angle within the orbital plane

// Real orbital periods here are tens of milliseconds, far too fast to watch.
// At time scale 1× the simulation advances SIM_RATE units of r_s/c per real
// second, i.e. roughly 1.5 ms of black-hole time per second on screen.
export const SIM_RATE = 2.2;

export const DISK_OUTER = 15;             // outer edge of the accretion disk, in r_s
export const FRAME_DRAG_K = 1.0;          // strength of the approximate frame-dragging term (see shader)

// Prograde ISCO radius of a Kerr black hole (Bardeen 1972), returned in r_s.
export function kerrIsco(a) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  return (3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2))) / 2;   // /2: M units → r_s units
}
// Kerr event-horizon radius in r_s.
export const kerrHorizon = (a) => (1 + Math.sqrt(1 - a * a)) / 2;
