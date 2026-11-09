import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'workkit-theme';

// The inline script in app.html has already picked the theme, before first paint
export const themeState = $state<{ theme: Theme }>({
	theme: browser && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
});

// Another tab switched theme
if (browser) {
	window.addEventListener('storage', (e) => {
		if (e.key !== THEME_KEY || (e.newValue !== 'light' && e.newValue !== 'dark')) return;
		themeState.theme = e.newValue;
		document.documentElement.dataset.theme = e.newValue;
	});
}

export function toggleTheme() {
	themeState.theme = themeState.theme === 'dark' ? 'light' : 'dark';
	document.documentElement.dataset.theme = themeState.theme;
	try { localStorage.setItem(THEME_KEY, themeState.theme); } catch { /* ignore */ }
}
