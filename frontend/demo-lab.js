document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-open-agent]').forEach((link) => {
        link.addEventListener('click', (event) => {
            const persona = link.dataset.openAgent;
            sessionStorage.setItem('microcompRequestedPersona', persona);
            link.href = 'index.html#agent';
        });
    });

    const stamp = document.querySelector('[data-build-stamp]');
    if (stamp) {
        const modified = new Date(document.lastModified);
        const datePart = modified.toLocaleDateString('en-US', {
            timeZone: 'America/Phoenix',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        const timePart = modified.toLocaleTimeString('en-US', {
            timeZone: 'America/Phoenix',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        stamp.textContent = `Site updated: ${datePart} ${timePart} MST`;
    }
});
