"use strict";

const RANK_TIERS = Object.freeze([
  "Bronze",
"Silver",
"Gold",
"Platinum",
"Diamond",
"Emerald",
"Ruby",
"Master",
"Grandmaster",
"Mythic"
]);
const PLACEMENT_MATCHES = 10;

function normalizeTier(value) {
  const tier = RANK_TIERS.find(item => item.toLowerCase() === String(value || "").toLowerCase());
  return tier || "Unranked";
}

function divisionForTier(tier, value) {
  if (tier === "Master" || tier === "Grandmaster") return 1;
  const division = Math.floor(Number(value));
  return Number.isFinite(division) && division >= 1 && division <= 4 ? division : 4;
}

function ensureRankedFields(profile) {
  if (!profile) return profile;
  profile.rankTier = normalizeTier(profile.rankTier);
  profile.rankDivision = divisionForTier(profile.rankTier, profile.rankDivision);
  profile.rankLP = Math.max(0, Math.floor(Number(profile.rankLP) || 0));
  profile.rankedWins = Math.max(0, Math.floor(Number(profile.rankedWins) || 0));
  profile.rankedLosses = Math.max(0, Math.floor(Number(profile.rankedLosses) || 0));
  profile.placementMatchesPlayed = Math.min(
    PLACEMENT_MATCHES,
    Math.max(0, Math.floor(Number(profile.placementMatchesPlayed) || 0))
  );
  profile.placementWins = Math.min(
    profile.placementMatchesPlayed,
    Math.max(0, Math.floor(Number(profile.placementWins) || 0))
  );
  profile.rankedMatchHistory = Array.isArray(profile.rankedMatchHistory)
    ? profile.rankedMatchHistory.slice(-20)
    : [];
  profile.seasonHighestTier = normalizeTier(profile.seasonHighestTier);
  profile.seasonHighestLP = Math.max(0, Math.floor(Number(profile.seasonHighestLP) || 0));
  return profile;
}

function rankLabel(profile) {
  ensureRankedFields(profile);
  if (profile.rankTier === "Unranked") return "Unranked";
  return `${profile.rankTier} ${profile.rankDivision}`;
}

function placementTier(wins) {
  if (wins <= 2) return "Bronze";
  if (wins <= 4) return "Silver";
  if (wins <= 6) return "Gold";
  if (wins <= 8) return "Platinum";
  if (wins === 9) return "Diamond";
  return "Master";
}

function updateSeasonPeak(profile) {
  const current = RANK_TIERS.indexOf(profile.rankTier);
  const peak = RANK_TIERS.indexOf(profile.seasonHighestTier);
  if (current > peak) {
    profile.seasonHighestTier = profile.rankTier;
    profile.seasonHighestLP = profile.rankLP;
  } else if (current === peak) {
    profile.seasonHighestLP = Math.max(profile.seasonHighestLP, profile.rankLP);
  }
}

function promote(profile) {
  if (profile.rankTier === "Grandmaster") return;
  if (profile.rankDivision > 1) {
    profile.rankDivision--;
    profile.rankLP -= 100;
    return;
  }
  const index = RANK_TIERS.indexOf(profile.rankTier);
  profile.rankTier = RANK_TIERS[Math.min(RANK_TIERS.length - 1, index + 1)];
  profile.rankDivision = divisionForTier(profile.rankTier, 4);
  profile.rankLP -= 100;
}

function demote(profile) {
  if (profile.rankTier === "Bronze" && profile.rankDivision === 4) {
    profile.rankLP = 0;
    return;
  }
  if (profile.rankDivision < 4 && profile.rankTier !== "Master" && profile.rankTier !== "Grandmaster") {
    profile.rankDivision++;
    profile.rankLP += 100;
    return;
  }
  const index = RANK_TIERS.indexOf(profile.rankTier);
  profile.rankTier = RANK_TIERS[Math.max(0, index - 1)];
  profile.rankDivision = 1;
  profile.rankLP += 100;
}

function applyRankedResult(profile, won, date = new Date().toISOString()) {
  ensureRankedFields(profile);
  const oldTier = rankLabel(profile);
  let lpChange = 0;

  if (won) profile.rankedWins++;
  else profile.rankedLosses++;

  if (profile.placementMatchesPlayed < PLACEMENT_MATCHES) {
    profile.placementMatchesPlayed++;
    if (won) profile.placementWins++;
    if (profile.placementMatchesPlayed === PLACEMENT_MATCHES) {
      profile.rankTier = placementTier(profile.placementWins);
      profile.rankDivision = divisionForTier(profile.rankTier, 4);
      profile.rankLP = 0;
    }
  } else {
    lpChange = won ? 25 : -15;
    profile.rankLP += lpChange;
    if (won && profile.rankTier !== "Grandmaster") {
      while (profile.rankLP >= 100 && profile.rankTier !== "Grandmaster") promote(profile);
    } else if (!won && profile.rankLP < 0) {
      demote(profile);
    }
  }

  updateSeasonPeak(profile);
  const entry = {
    date,
    result: won ? "win" : "loss",
    oldTier,
    newTier: rankLabel(profile),
    lpChange
  };
  profile.rankedMatchHistory.push(entry);
  profile.rankedMatchHistory = profile.rankedMatchHistory.slice(-20);
  return entry;
}

function publicRankedData(profile) {
  ensureRankedFields(profile);
  const total = profile.rankedWins + profile.rankedLosses;
  return {
    rankTier: profile.rankTier,
    rankDivision: profile.rankDivision,
    rankLP: profile.rankLP,
    rankedWins: profile.rankedWins,
    rankedLosses: profile.rankedLosses,
    rankedWinRate: total ? Math.round(profile.rankedWins / total * 100) : 0,
    placementMatchesPlayed: profile.placementMatchesPlayed,
    placementWins: profile.placementWins,
    placementTotal: PLACEMENT_MATCHES,
    placementComplete: profile.placementMatchesPlayed >= PLACEMENT_MATCHES,
    rankedMatchHistory: profile.rankedMatchHistory.slice().reverse(),
    seasonHighestTier: profile.seasonHighestTier,
    seasonHighestLP: profile.seasonHighestLP,
    rankDisplay: rankLabel(profile)
  };
}

module.exports = Object.freeze({
  name: "game",
  events: [
    "startGame", "toggleReady", "requestRematch", "submitWord", "spectateRoom",
    "switchWatchedPlayer", "rankedMatch", "getRankedData"
  ],
  responsibilities: ["match flow", "turn timers", "bots", "rewards", "spectating", "ranked play"],
  RANK_TIERS,
  PLACEMENT_MATCHES,
  ensureRankedFields,
  applyRankedResult,
  publicRankedData,
  rankLabel
});
