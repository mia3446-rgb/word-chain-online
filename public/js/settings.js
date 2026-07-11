(function () {
  const WCA = window.WCA = window.WCA || {};
  WCA.Settings = WCA.Settings || {
    keys: ["wca_sfx", "wca_bgm", "wca_sfx_volume", "wca_bgm_volume", "wca_master_volume", "wca_animation"],
    syncAudio(settings) {
      if (WCA.Audio) WCA.Audio.syncSettings(settings);
    }
  };
})();
