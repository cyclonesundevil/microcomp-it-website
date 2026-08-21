const SLIT_PARAMETER_LIMITS = Object.freeze({ minimum: 0, maximum: 100 });
const SCREEN_DISTANCE_LIMITS = Object.freeze({ minimum: 0.5, maximum: 2 });

function finiteNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
    return number;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function interpolate(minimum, maximum, fraction) {
    return minimum + (maximum - minimum) * fraction;
}

function freezePoint(x, y) {
    return Object.freeze({ x, y });
}

/**
 * Monotonic schematic transform shared by slit width and center separation.
 * It intentionally is not a physical scale. Using the same transform for a
 * and d preserves d >= a as non-overlapping/touching displayed apertures.
 */
export function schematicSlitMicrometersToPixels(valueMicrometers, viewportHeight) {
    const value = clamp(
        finiteNumber(valueMicrometers, 'slit geometry'),
        SLIT_PARAMETER_LIMITS.minimum,
        SLIT_PARAMETER_LIMITS.maximum
    );
    const height = Math.max(240, finiteNumber(viewportHeight, 'viewport height'));
    const minimumReadablePixels = clamp(height * 0.018, 6, 10);
    const maximumReadablePixels = clamp(height * 0.24, 72, 120);
    return interpolate(minimumReadablePixels, maximumReadablePixels, value / SLIT_PARAMETER_LIMITS.maximum);
}

export function createDetectionApparatusGeometry({
    viewportWidth,
    viewportHeight,
    slitWidthMicrometers = 12,
    slitSeparationMicrometers = 40,
    screenDistanceMeters = 1,
    binCount = 181
}) {
    const width = Math.max(240, finiteNumber(viewportWidth, 'viewport width'));
    const height = Math.max(240, finiteNumber(viewportHeight, 'viewport height'));
    const slitWidth = finiteNumber(slitWidthMicrometers, 'slit width');
    const slitSeparation = finiteNumber(slitSeparationMicrometers, 'slit separation');
    const screenDistance = finiteNumber(screenDistanceMeters, 'screen distance');
    const bins = Math.trunc(finiteNumber(binCount, 'bin count'));
    if (slitWidth <= 0 || slitSeparation < slitWidth) {
        throw new RangeError('schematic independent slits require d >= a > 0');
    }
    if (bins < 2) throw new RangeError('bin count must be at least two');

    const plotTop = height * 0.1;
    const plotBottom = height * 0.9;
    const centerY = (plotTop + plotBottom) / 2;
    const source = freezePoint(width * 0.12, centerY);
    const screenFraction = (
        clamp(screenDistance, SCREEN_DISTANCE_LIMITS.minimum, SCREEN_DISTANCE_LIMITS.maximum)
        - SCREEN_DISTANCE_LIMITS.minimum
    ) / (SCREEN_DISTANCE_LIMITS.maximum - SCREEN_DISTANCE_LIMITS.minimum);
    const detectorX = interpolate(width * 0.72, width * 0.84, screenFraction);
    const detector = Object.freeze({
        x: detectorX,
        top: plotTop,
        bottom: plotBottom,
        center: freezePoint(detectorX, centerY)
    });
    const barrierX = width * 0.38;
    const apertureWidthPixels = schematicSlitMicrometersToPixels(slitWidth, height);
    const apertureCenterSeparationPixels = schematicSlitMicrometersToPixels(slitSeparation, height);
    const upperCenterY = centerY - apertureCenterSeparationPixels / 2;
    const lowerCenterY = centerY + apertureCenterSeparationPixels / 2;
    const aperture = center => Object.freeze({
        center: freezePoint(barrierX, center),
        top: center - apertureWidthPixels / 2,
        bottom: center + apertureWidthPixels / 2,
        widthPixels: apertureWidthPixels
    });
    const upper = aperture(upperCenterY);
    const lower = aperture(lowerCenterY);
    const barrier = Object.freeze({
        x: barrierX,
        center: freezePoint(barrierX, centerY),
        upper,
        lower,
        apertureWidthPixels,
        apertureCenterSeparationPixels
    });

    return Object.freeze({
        viewport: Object.freeze({ width, height }),
        plot: Object.freeze({ top: plotTop, bottom: plotBottom, height: plotBottom - plotTop }),
        source,
        detector,
        barrier,
        binCount: bins,
        screenDistanceMeters: screenDistance,
        slitToScreenIndicator: Object.freeze({
            start: freezePoint(barrierX, plotBottom - 8),
            end: freezePoint(detectorX, plotBottom - 8),
            lengthPixels: detectorX - barrierX
        })
    });
}

export function detectorPointForBin(geometry, binIndex) {
    if (!geometry?.detector || !Number.isInteger(geometry.binCount)) {
        throw new TypeError('valid apparatus geometry is required');
    }
    const bin = Math.trunc(finiteNumber(binIndex, 'detector bin'));
    if (bin < 0 || bin >= geometry.binCount) throw new RangeError('detector bin is outside the apparatus');
    const fraction = bin / (geometry.binCount - 1);
    return freezePoint(
        geometry.detector.x,
        interpolate(geometry.detector.top, geometry.detector.bottom, fraction)
    );
}

export function createIllustrativeEmissionCoordinates(geometry, binIndex, { coherentDoubleSlit = false } = {}) {
    const detectorImpact = detectorPointForBin(geometry, binIndex);
    return Object.freeze({
        mode: coherentDoubleSlit ? 'symmetric-aperture-wavefront' : 'source-to-detector-cue',
        start: freezePoint(geometry.source.x, geometry.source.y),
        aperture: freezePoint(geometry.barrier.center.x, geometry.barrier.center.y),
        symmetricApertureCenters: Object.freeze([
            freezePoint(geometry.barrier.upper.center.x, geometry.barrier.upper.center.y),
            freezePoint(geometry.barrier.lower.center.x, geometry.barrier.lower.center.y)
        ]),
        end: detectorImpact
    });
}
