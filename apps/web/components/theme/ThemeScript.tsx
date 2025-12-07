export function ThemeScript() {
  const code = `(() => { try { const key='blobinfini.theme'; const s = localStorage.getItem(key); const prefers = window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches; const isDark = s ? s === 'dark' : prefers; const root = document.documentElement; const body = document.body; root.classList.toggle('dark', isDark); if (body) body.classList.toggle('dark', isDark); } catch (e) {} })();`;
  // Inline script to set the theme class before paint
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

