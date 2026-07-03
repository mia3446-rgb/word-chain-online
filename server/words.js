"use strict";

function loadDictionaries({ fs, path, wordsDir, wordDB, allWords, startMap, logger = console }) {
  if (!fs.existsSync(wordsDir)) {
    logger.log("words 폴더가 없습니다.");
    return;
  }
  const files = fs.readdirSync(wordsDir).filter(file => file.endsWith(".txt"));
  for (const file of files) {
    const text = fs.readFileSync(path.join(wordsDir, file), "utf8");
    wordDB.push("/" + text.trim() + "/");
    const words = text.split("/").map(word => word.trim()).filter(word => /^[가-힣]{2,}$/.test(word));
    for (const word of words) {
      allWords.push(word);
      const first = word[0];
      if (!startMap.has(first)) startMap.set(first, []);
      startMap.get(first).push(word);
    }
  }
  logger.log(`단어 DB ${files.length}개 파일 불러옴`);
  logger.log(`전체 단어 ${allWords.length}개 준비됨`);
  logger.log(`첫 글자 인덱스 ${startMap.size}개 준비됨`);
}

module.exports = {
  name: "words", events: [],
  responsibilities: ["dictionary loading", "word validation", "dueum rules", "one-shot cache"],
  loadDictionaries
};
