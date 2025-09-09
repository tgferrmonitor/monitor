// Theme toggle functionality
function initThemeToggle() {
  const themeToggle = document.getElementById('themeToggle');
  const body = document.body;

  // Load saved theme or default to light
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);

  themeToggle.addEventListener('click', () => {
    const currentTheme = body.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  });
}

function setTheme(theme) {
  const body = document.body;
  const themeToggle = document.getElementById('themeToggle');

  body.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  themeToggle.innerHTML =
    theme === 'light' ? '🌙 Tema Escuro' : '☀️ Tema Claro';
}

// Initialize theme toggle when DOM is loaded
document.addEventListener('DOMContentLoaded', initThemeToggle);
