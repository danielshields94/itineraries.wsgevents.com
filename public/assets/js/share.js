// Share + Print buttons. Add data-share / data-print to any button.
document.addEventListener('click', async (e) => {
  const shareBtn = e.target.closest('[data-share]');
  if (shareBtn) {
    e.preventDefault();
    const data = { title: document.title, url: location.href };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(location.href);
      const old = shareBtn.textContent;
      shareBtn.textContent = 'Link copied';
      setTimeout(() => (shareBtn.textContent = old), 2000);
    } catch (_) { /* user cancelled */ }
  }
  if (e.target.closest('[data-print]')) { e.preventDefault(); window.print(); }
});
