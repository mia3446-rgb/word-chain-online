(function () {
  const WCA = window.WCA = window.WCA || {};
  WCA.Utils = WCA.Utils || {
    escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#039;"
      }[ch]));
    },
    byId(id) {
      return document.getElementById(id);
    },
    clamp(value, min, max) {
      return Math.max(min, Math.min(max, Number(value) || 0));
    }
  };
})();
