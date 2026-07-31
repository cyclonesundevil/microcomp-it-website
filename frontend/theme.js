(function () {
    const storageKey = 'microcomp-theme';
    const root = document.documentElement;
    const themes = ['dark', 'moderate', 'light'];
    const themeLabels = {
        dark: 'Dark',
        moderate: 'Moderate',
        light: 'Light'
    };

    function preferredTheme() {
        const saved = localStorage.getItem(storageKey);
        if (themes.includes(saved)) return saved;
        return 'dark';
    }

    function applyTheme(theme) {
        const activeTheme = themes.includes(theme) ? theme : 'dark';
        const nextTheme = themes[(themes.indexOf(activeTheme) + 1) % themes.length];
        root.dataset.theme = activeTheme;
        root.style.colorScheme = activeTheme === 'light' ? 'light' : 'dark';
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.removeAttribute('aria-pressed');
            button.setAttribute(
                'aria-label',
                `${themeLabels[activeTheme]} color scheme selected. Switch to ${themeLabels[nextTheme]}.`
            );
            button.title = `Color scheme: ${themeLabels[activeTheme]}`;
            button.querySelector('[data-theme-label]').textContent = themeLabels[activeTheme];
            const icon = button.querySelector('i');
            if (icon) {
                icon.className = activeTheme === 'light'
                    ? 'fa-solid fa-sun'
                    : activeTheme === 'moderate'
                        ? 'fa-solid fa-circle-half-stroke'
                        : 'fa-solid fa-moon';
            }
        });
    }

    applyTheme(preferredTheme());

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(preferredTheme());
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.addEventListener('click', () => {
                const currentIndex = themes.indexOf(root.dataset.theme);
                const nextTheme = themes[(currentIndex + 1) % themes.length];
                localStorage.setItem(storageKey, nextTheme);
                applyTheme(nextTheme);
            });
        });
    });
}());
