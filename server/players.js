"use strict";

function createPlayerRepository({ fs, dataDir, playersFile, oldPlayersFile, logger = console }) {
  function prepare() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(playersFile) && fs.existsSync(oldPlayersFile)) {
      try { fs.copyFileSync(oldPlayersFile, playersFile); }
      catch (error) { logger.log("기존 players.json 복사 실패:", error.message); }
    }
  }
  function load() {
    prepare();
    try {
      if (!fs.existsSync(playersFile)) return {};
      const data = JSON.parse(fs.readFileSync(playersFile, "utf8"));
      logger.log(`플레이어 데이터 ${Object.keys(data).length}명 불러옴`);
      return data;
    } catch (error) {
      logger.log("플레이어 데이터 로드 실패:", error.message);
      return {};
    }
  }
  function save(data) {
    try { fs.writeFileSync(playersFile, JSON.stringify(data, null, 2), "utf8"); }
    catch (error) { logger.log("플레이어 데이터 저장 실패:", error.message); }
  }
  return { prepare, load, save, playersFile };
}

module.exports = {
  name: "players",
  events: ["getProfile"],
  responsibilities: ["player persistence", "schema migration", "default profiles"],
  createPlayerRepository
};
