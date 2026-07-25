(function () {
    const unsupportedDevelopmentHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (window.location.protocol === 'file:' || unsupportedDevelopmentHosts.has(window.location.hostname)) {
        return;
    }

    const idleTimeoutMs = 30_000;
    const heartbeatMs = 15_000;
    const maxActiveSeconds = 60 * 60;
    const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const startedAt = Date.now();
    let activeSeconds = 0;
    let lastSentActiveSeconds = 0;
    let interactionCount = 0;
    let lastActivityAt = Date.now();
    let maxScrollPercent = 0;
    let lastTickAt = Date.now();

    function pagePath() {
        return `${window.location.pathname}${window.location.search}`;
    }

    function updateScrollDepth() {
        const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const depth = Math.round(Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)));
        maxScrollPercent = Math.max(maxScrollPercent, depth);
    }

    function markActivity() {
        interactionCount += 1;
        lastActivityAt = Date.now();
        updateScrollDepth();
    }

    function tick() {
        const now = Date.now();
        const elapsed = Math.min(2, Math.max(0, (now - lastTickAt) / 1000));
        lastTickAt = now;
        if (
            document.visibilityState === 'visible' &&
            now - lastActivityAt <= idleTimeoutMs &&
            activeSeconds < maxActiveSeconds
        ) {
            activeSeconds = Math.min(maxActiveSeconds, activeSeconds + elapsed);
        }
    }

    function payload(reason, force = false) {
        tick();
        updateScrollDepth();
        const roundedActive = Math.floor(activeSeconds);
        const delta = Math.max(0, roundedActive - lastSentActiveSeconds);
        if (!force && delta <= 0 && reason !== 'pagehide') return null;
        lastSentActiveSeconds = roundedActive;
        return JSON.stringify({
            eventType: 'active_time',
            sessionId,
            path: pagePath(),
            wallTimeSeconds: Math.min(24 * 60 * 60, Math.floor((Date.now() - startedAt) / 1000)),
            activeTimeSeconds: roundedActive,
            activeTimeDeltaSeconds: delta,
            interactionCount,
            maxScrollPercent,
            lastActivityAgeSeconds: Math.floor((Date.now() - lastActivityAt) / 1000),
            reason,
            referrer: document.referrer,
            userAgent: navigator.userAgent
        });
    }

    function send(reason, force = false) {
        const data = payload(reason, force);
        if (!data) return;
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/track', data);
            return;
        }
        fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: data,
            keepalive: true
        }).catch(() => {});
    }

    ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach((eventName) => {
        window.addEventListener(eventName, markActivity, { passive: true });
    });

    window.addEventListener('focus', markActivity);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            send('hidden', true);
        } else {
            lastTickAt = Date.now();
            markActivity();
        }
    });
    window.addEventListener('pagehide', () => send('pagehide', true));

    updateScrollDepth();
    setInterval(tick, 1000);
    setInterval(() => send('heartbeat'), heartbeatMs);
}());
