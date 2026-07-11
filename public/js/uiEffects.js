(function () {
  const WCA = window.WCA = window.WCA || {};
  WCA.UIEffects = WCA.UIEffects || {
    showWordImpact(event) {
      if (typeof window.showWordImpact === "function") window.showWordImpact(event);
    },
    showFinalCountdown(room) {
      if (typeof window.showFinalCountdown === "function") window.showFinalCountdown(room);
    },
    showMatchFeelOverlay(room) {
      if (typeof window.showMatchFeelOverlay === "function") window.showMatchFeelOverlay(room);
    }
  };
})();
