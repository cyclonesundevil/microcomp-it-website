document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-open-agent]').forEach((link) => {
        link.addEventListener('click', (event) => {
            const persona = link.dataset.openAgent;
            sessionStorage.setItem('microcompRequestedPersona', persona);
            link.href = 'index.html#agent';
        });
    });

});
