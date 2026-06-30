(function () {
    const storageKey = 'microcomp-theme';
    const root = document.documentElement;

    function preferredTheme() {
        const saved = localStorage.getItem(storageKey);
        if (saved === 'light' || saved === 'dark') return saved;
        return 'dark';
    }

    function applyTheme(theme) {
        root.dataset.theme = theme;
        root.style.colorScheme = theme;
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            const isLight = theme === 'light';
            button.setAttribute('aria-pressed', String(isLight));
            button.querySelector('[data-theme-label]').textContent = isLight ? 'Light' : 'Dark';
            const icon = button.querySelector('i');
            if (icon) {
                icon.className = isLight ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
            }
        });
    }

    applyTheme(preferredTheme());

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(preferredTheme());
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.addEventListener('click', () => {
                const nextTheme = root.dataset.theme === 'light' ? 'dark' : 'light';
                localStorage.setItem(storageKey, nextTheme);
                applyTheme(nextTheme);
            });
        });
    });
}());
