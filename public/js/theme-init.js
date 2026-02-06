/**
 * @fileoverview Apply saved theme before first paint to prevent FOUC.
 */
(function applyThemeEarly() {
  const THEME_KEY = 'wine-cellar-theme';
  const savedTheme = localStorage.getItem(THEME_KEY);

  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    // No saved preference — detect OS and set explicitly
    // This makes theme work independently of CSS media query support (WebView compat)
    const prefersDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }

  // Detect actual theme: explicit attribute or OS preference
  const attr = document.documentElement.getAttribute('data-theme');
  const isDark = attr === 'dark' || (!attr && !window.matchMedia('(prefers-color-scheme: light)').matches);
  const themeColor = isDark ? '#722F37' : '#7A6240';
  const tileColor = isDark ? '#1a1a1a' : '#FAF6F1';

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', themeColor);
  }

  const tileMeta = document.querySelector('meta[name="msapplication-TileColor"]');
  if (tileMeta) {
    tileMeta.setAttribute('content', tileColor);
  }
})();
