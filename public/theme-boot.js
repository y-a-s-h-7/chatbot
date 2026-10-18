/**
 * Applies the stored theme before first paint so a dark-mode reload never
 * flashes light. Loaded as a blocking script from index.html — deliberately
 * NOT inline, so the Content-Security-Policy needs no 'unsafe-inline' or
 * hash exceptions in any of its three sources (see scripts/security-headers.mjs).
 */
(function () {
  try {
    var t = localStorage.getItem('chatbot.theme');
    var d = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', d);
  } catch (e) {}
})();
