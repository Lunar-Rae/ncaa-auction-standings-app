import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const MOBILE_BREAKPOINT = 760;
const TABLET_BREAKPOINT = 1100;
const COMMENT_POLL_MS = 10000;
const COMMENT_CLIENT_ID_STORAGE_KEY = "leaderboardCommentClientId";
const COMMENT_LAST_SEEN_STORAGE_KEY = "leaderboardCommentLastSeenAt";
const NOTIFICATION_SETTINGS_STORAGE_KEY = "leaderboardNotificationSettings";
const NOTIFICATIONS_STORAGE_KEY = "leaderboardNotifications";
const TEXT_SIZE_STORAGE_KEY = "leaderboardTextSize";
const THEME_STORAGE_KEY = "leaderboardTheme";
const ACCESS_PROFILE_STORAGE_KEY = "leaderboardAccessProfile";
const ACCESS_DEVICE_PIN_STORAGE_KEY = "leaderboardAccessDevicePin";
const ACCESS_UNLOCKED_SESSION_KEY = "leaderboardAccessUnlocked";
const LEAGUE_TIME_ZONE = "America/Los_Angeles";
const TEXT_SIZE_OPTIONS = {
  small: { label: "Small", scale: 0.95 },
  medium: { label: "Medium", scale: 1 },
  large: { label: "Large", scale: 1.08 },
};
const APP_THEMES = {
  light: {
    label: "Light",
    pageBg: "#f1f5f9",
    text: "#0f172a",
    muted: "#64748b",
    subtleText: "#94a3b8",
    surface: "#ffffff",
    surfaceAlt: "#f8fafc",
    surfaceStrong: "#e2e8f0",
    border: "#e2e8f0",
    borderStrong: "#cbd5e1",
    shadow: "0 1px 8px rgba(0,0,0,.07)",
    headerBg: "#0f172a",
    headerSurface: "#111827",
    headerBorder: "#334155",
    headerMuted: "#94a3b8",
    navActiveBg: "#0f172a",
    navActiveText: "#ffffff",
    buttonBg: "#ffffff",
    buttonText: "#0f172a",
    inputBg: "#ffffff",
    inputText: "#0f172a",
  },
  dark: {
    label: "Dark",
    pageBg: "#000000",
    text: "#f5f5f5",
    muted: "#a3a3a3",
    subtleText: "#737373",
    surface: "#0b0b0b",
    surfaceAlt: "#121212",
    surfaceStrong: "#1f1f1f",
    border: "#232323",
    borderStrong: "#3a3a3a",
    shadow: "0 12px 28px rgba(0,0,0,.45)",
    headerBg: "#000000",
    headerSurface: "#0b0b0b",
    headerBorder: "#2a2a2a",
    headerMuted: "#a3a3a3",
    navActiveBg: "#f5f5f5",
    navActiveText: "#0a0a0a",
    buttonBg: "#111111",
    buttonText: "#f5f5f5",
    inputBg: "#111111",
    inputText: "#f5f5f5",
  },
};
const DEFAULT_NOTIFICATION_SETTINGS = {
  comments: false,
  mentions: true,
  leadChanges: true,
  gameFinals: true,
  dailyRecap: true,
};
const ThemeContext = React.createContext(APP_THEMES.light);

function useTheme() {
  return React.useContext(ThemeContext);
}

function useResponsiveLayout() {
  const getWidth = () => (typeof window === "undefined" ? 1280 : window.innerWidth);
  const [width, setWidth] = useState(getWidth);

  useEffect(() => {
    const onResize = () => setWidth(getWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    width,
    isMobile: width < MOBILE_BREAKPOINT,
    isTablet: width < TABLET_BREAKPOINT,
  };
}

function responsiveColumns({ isMobile, isTablet, desktop, tablet = "repeat(2,1fr)", mobile = "1fr" }) {
  if (isMobile) return mobile;
  if (isTablet) return tablet;
  return desktop;
}

function getStoredValue(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function setStoredValue(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Ignore storage failures in private browsing / locked-down environments.
  }
}

function getStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getSessionValue(key, fallback = "") {
  try {
    return sessionStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function setSessionValue(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function createClientId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePersonName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCommentRecord(record) {
  if (!record || typeof record !== "object") return null;
  return {
    id: String(record.id),
    message: String(record.message || "").trim(),
    authorName: String(record.authorName ?? record.author_name ?? "Guest").trim() || "Guest",
    authorTeamId: record.authorTeamId ?? record.author_team_id ?? null,
    teamId: record.teamId ?? record.team_id ?? null,
    clientId: record.clientId ?? record.client_id ?? null,
    replyToId: record.replyToId ?? record.reply_to_id ?? null,
    createdAt: record.createdAt ?? record.created_at ?? new Date().toISOString(),
    updatedAt: record.updatedAt ?? record.updated_at ?? null,
  };
}

function sortCommentsAscending(list) {
  return list.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function mergeCommentList(current, incoming) {
  const nextMap = new Map(current.map((comment) => [comment.id, comment]));
  (Array.isArray(incoming) ? incoming : [incoming])
    .map(normalizeCommentRecord)
    .filter(Boolean)
    .forEach((comment) => {
      nextMap.set(comment.id, {
        ...(nextMap.get(comment.id) || {}),
        ...comment,
      });
    });
  return sortCommentsAscending([...nextMap.values()]).slice(-250);
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
const ROUND_POINTS = { FF: 3, R64: 3, R32: 3, S16: 4, E8: 4, F4: 5, CH: 6 };
const roundLabels = { FF: "First Four", R64: "Round of 64", R32: "Round of 32", S16: "Sweet 16", E8: "Elite 8", F4: "Final Four", CH: "Championship" };
const ROUND_GAME_COUNTS = { FF: 2, R64: 32, R32: 16, S16: 8, E8: 4, F4: 2, CH: 1 };
const TOTAL_TOURNAMENT_POINTS = Object.entries(ROUND_POINTS).reduce(
  (sum, [round, points]) => sum + (ROUND_GAME_COUNTS[round] || 0) * points,
  0
);

// 6 groups × $200 buy-in = $1200 pot
const NUM_GROUPS = 6;
const BUYIN = 200;
const TOTAL_POT = NUM_GROUPS * BUYIN; // $1200
const PAYOUTS = [ // 6-group split: 50 / 33.3 / 16.7
  { place: 1, pct: 0.500 },
  { place: 2, pct: 0.333 },
  { place: 3, pct: 0.167 },
];

// ─── Fantasy Teams ────────────────────────────────────────────────────────────
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit random PIN
}

const initialFantasyTeams = [
  { id: "mike-bob", name: "Mike / Bob", members: ["Mike W.", "Bob"], budget: 100, pin: generatePin(), privateNotes: [] },
  { id: "solomon-brenden", name: "Solomon / Brenden", members: ["Solomon", "Brenden"], budget: 100, pin: generatePin(), privateNotes: null },
  { id: "dan-chris", name: "Dan / Chris", members: ["Dan", "Chris"], budget: 100, pin: generatePin(), privateNotes: [] },
  { id: "ryan-brian", name: "Ryan / Brian", members: ["Ryan", "Brian"], budget: 100, pin: generatePin(), privateNotes: [] },
  { id: "mikea-gregg", name: "Mike A / Gregg", members: ["Mike A.", "Gregg"], budget: 100, pin: generatePin(), privateNotes: [] },
  { id: "josh-gabe", name: "Josh / Gabe", members: ["Josh", "Gabe"], budget: 100, pin: generatePin(), privateNotes: [] },
];
const fantasyTeams = initialFantasyTeams;
const adminAccounts = [
  { id: "admin-ariel", name: "Ariel", role: "admin" },
  { id: "admin-commissioner", name: "Commissioner", role: "admin" },
];
const leagueMemberAccounts = fantasyTeams.flatMap((team) =>
  team.members.map((member) => ({
    id: `${team.id}:${member.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: member,
    teamId: team.id,
    role: "member",
  }))
);
const leagueAccessAccounts = [...leagueMemberAccounts, ...adminAccounts];

function accountLabel(account) {
  if (!account) return "";
  return account.role === "admin" ? `${account.name} · Admin` : `${account.name} · ${ownerName(account.teamId)}`;
}

function accountById(accountId) {
  return leagueAccessAccounts.find((account) => account.id === accountId) || null;
}

function normalizeAccessProfile(record) {
  if (!record || typeof record !== "object") return null;
  const account = accountById(record.accountId);
  if (!account) return null;
  return {
    accountId: account.id,
    name: account.name,
    role: account.role,
    teamId: account.teamId || null,
  };
}

// ─── Auction Intel ────────────────────────────────────────────────────────────
const auctionIntel = [
  { tier: "A", seedRange: "1–2", role: "One anchor only", target: "1: 18–22 / 2: 15–19", max: "1: 25 / 2: 21", expected: "8–12" },
  { tier: "B", seedRange: "3–4", role: "Best ROI core", target: "3: 12–15 / 4: 10–13", max: "3: 16 / 4: 14", expected: "6–9" },
  { tier: "C", seedRange: "5–6", role: "Secondary core", target: "5: 8–11 / 6: 6–9", max: "5: 12 / 6: 10", expected: "4–6" },
  { tier: "D", seedRange: "7–10", role: "Depth if discounted", target: "7: 5–7 / 8–9: 4–6 / 10: 3–5", max: "7: 8 / 8–9: 7 / 10: 6", expected: "2.5–4.5" },
  { tier: "E", seedRange: "11–12", role: "Cheap upside", target: "11: 3–5 / 12: 2–4", max: "11: 6 / 12: 5", expected: "2–3.5" },
  { tier: "F", seedRange: "13–16", role: "Endgame only", target: "13: 2–4 / 14–16: 1–2", max: "13: 5 / 14–16: 2", expected: "0–2.5" },
];

// ─── Ownership Ledger (source of truth: auction whiteboard + March 19 email) ──
// Regions are OFFICIAL 2026 NCAA Tournament regions: East, West, South, Midwest
const ownedTeams = [
  // ── Mike W. / Bob ──────────────────────────────────────────────────────────
  { school: "Purdue", seed: 2, region: "West", ownerId: "mike-bob", price: 21 },
  { school: "St. John's", seed: 5, region: "East", ownerId: "mike-bob", price: 17 },
  { school: "Vanderbilt", seed: 5, region: "South", ownerId: "mike-bob", price: 15 },
  { school: "UCLA", seed: 7, region: "East", ownerId: "mike-bob", price: 6 },
  { school: "Clemson", seed: 8, region: "South", ownerId: "mike-bob", price: 5 },
  { school: "Ohio State", seed: 8, region: "East", ownerId: "mike-bob", price: 5 },
  { school: "Villanova", seed: 8, region: "West", ownerId: "mike-bob", price: 6 },
  { school: "Wisconsin", seed: 5, region: "West", ownerId: "mike-bob", price: 13 },
  { school: "Troy", seed: 13, region: "South", ownerId: "mike-bob", price: 1 },
  { school: "Wright State", seed: 14, region: "Midwest", ownerId: "mike-bob", price: 1 },

  // ── Solomon / Brenden ──────────────────────────────────────────────────────
  { school: "Michigan", seed: 1, region: "Midwest", ownerId: "solomon-brenden", price: 11 },
  { school: "Nebraska", seed: 4, region: "South", ownerId: "solomon-brenden", price: 11 },
  { school: "Texas Tech", seed: 5, region: "Midwest", ownerId: "solomon-brenden", price: 5 },
  { school: "North Carolina", seed: 6, region: "South", ownerId: "solomon-brenden", price: 6 },
  { school: "Miami (FL)", seed: 7, region: "West", ownerId: "solomon-brenden", price: 7 },
  { school: "Kentucky", seed: 7, region: "Midwest", ownerId: "solomon-brenden", price: 5 },
  { school: "Georgia", seed: 8, region: "Midwest", ownerId: "solomon-brenden", price: 6 },
  { school: "Iowa", seed: 9, region: "South", ownerId: "solomon-brenden", price: 4 },
  { school: "UCF", seed: 10, region: "East", ownerId: "solomon-brenden", price: 5 },
  { school: "Texas A&M", seed: 10, region: "South", ownerId: "solomon-brenden", price: 5 },
  { school: "South Florida", seed: 11, region: "East", ownerId: "solomon-brenden", price: 6 },
  { school: "VCU", seed: 11, region: "South", ownerId: "solomon-brenden", price: 11 },
  { school: "High Point", seed: 12, region: "West", ownerId: "solomon-brenden", price: 2 },
  { school: "Hofstra", seed: 13, region: "Midwest", ownerId: "solomon-brenden", price: 2 },
  { school: "Idaho", seed: 15, region: "South", ownerId: "solomon-brenden", price: 1 },
  { school: "Siena", seed: 16, region: "East", ownerId: "solomon-brenden", price: 1 },
  { school: "LIU", seed: 16, region: "West", ownerId: "solomon-brenden", price: 1 },

  // ── Dan / Chris ────────────────────────────────────────────────────────────
  { school: "Florida", seed: 1, region: "South", ownerId: "dan-chris", price: 41 },
  { school: "UConn", seed: 2, region: "East", ownerId: "dan-chris", price: 19 },
  { school: "Gonzaga", seed: 3, region: "West", ownerId: "dan-chris", price: 19 },
  { school: "Alabama", seed: 4, region: "Midwest", ownerId: "dan-chris", price: 5 },
  { school: "Louisville", seed: 6, region: "East", ownerId: "dan-chris", price: 5 },
  { school: "Santa Clara", seed: 10, region: "Midwest", ownerId: "dan-chris", price: 6 },
  { school: "Northern Iowa", seed: 12, region: "East", ownerId: "dan-chris", price: 3 },
  { school: "North Dakota State", seed: 14, region: "East", ownerId: "dan-chris", price: 1 },

  // ── Ryan / Brian ───────────────────────────────────────────────────────────
  { school: "Arizona", seed: 1, region: "West", ownerId: "ryan-brian", price: 44 },
  { school: "Michigan State", seed: 3, region: "East", ownerId: "ryan-brian", price: 17 },
  { school: "Illinois", seed: 3, region: "South", ownerId: "ryan-brian", price: 10 },
  { school: "BYU", seed: 6, region: "West", ownerId: "ryan-brian", price: 10 },
  { school: "Saint Mary's", seed: 7, region: "South", ownerId: "ryan-brian", price: 4 },
  { school: "Missouri", seed: 10, region: "West", ownerId: "ryan-brian", price: 3 },
  { school: "Akron", seed: 12, region: "Midwest", ownerId: "ryan-brian", price: 4 },
  { school: "California Baptist", seed: 13, region: "East", ownerId: "ryan-brian", price: 1 },
  { school: "Hawai'i", seed: 13, region: "West", ownerId: "ryan-brian", price: 2 },
  { school: "Kennesaw State", seed: 14, region: "West", ownerId: "ryan-brian", price: 1 },
  { school: "Furman", seed: 15, region: "East", ownerId: "ryan-brian", price: 1 },

  // ── Mike A. / Gregg ────────────────────────────────────────────────────────
  { school: "Houston", seed: 2, region: "South", ownerId: "mikea-gregg", price: 36 },
  { school: "Iowa State", seed: 2, region: "Midwest", ownerId: "mikea-gregg", price: 23 },
  { school: "Virginia", seed: 3, region: "Midwest", ownerId: "mikea-gregg", price: 18 },
  { school: "Utah State", seed: 9, region: "West", ownerId: "mikea-gregg", price: 7 },
  { school: "TCU", seed: 9, region: "East", ownerId: "mikea-gregg", price: 5 },
  { school: "Texas", seed: 11, region: "West", ownerId: "mikea-gregg", price: 3 },
  { school: "Tennessee State", seed: 15, region: "Midwest", ownerId: "mikea-gregg", price: 1 },

  // ── Josh / Gabe ────────────────────────────────────────────────────────────
  { school: "Duke", seed: 1, region: "East", ownerId: "josh-gabe", price: 40 },
  { school: "Arkansas", seed: 4, region: "West", ownerId: "josh-gabe", price: 13 },
  { school: "Kansas", seed: 4, region: "East", ownerId: "josh-gabe", price: 10 },
  { school: "Tennessee", seed: 6, region: "Midwest", ownerId: "josh-gabe", price: 8 },
  { school: "Saint Louis", seed: 9, region: "Midwest", ownerId: "josh-gabe", price: 5 },
  { school: "Miami (OH)", seed: 11, region: "Midwest", ownerId: "josh-gabe", price: 2 },
  { school: "McNeese", seed: 12, region: "South", ownerId: "josh-gabe", price: 1 },
  { school: "Penn", seed: 14, region: "South", ownerId: "josh-gabe", price: 10 },
  { school: "Queens", seed: 15, region: "West", ownerId: "josh-gabe", price: 1 },
  { school: "Prairie View A&M", seed: 16, region: "South", ownerId: "josh-gabe", price: 1 },
  { school: "Howard", seed: 16, region: "Midwest", ownerId: "josh-gabe", price: 1 },
];

// ─── Demo / fallback games — March 19 completed + March 20 live/upcoming ──────
// Home/away names use OFFICIAL ESPN display names so lookupOwner() always resolves.
// Regions are official 2026 NCAA bracket regions.
const demoGames = [
  // ══ MARCH 19 — ALL FINAL ══════════════════════════════════════════════════

  // EAST REGION
  { id: "e1", round: "R64", region: "East", home: "Duke Blue Devils", homeSeed: 1, away: "Siena Saints", awaySeed: 16, homeScore: 71, awayScore: 65, status: "Final" },
  { id: "e2", round: "R64", region: "East", home: "Michigan State Spartans", homeSeed: 3, away: "North Dakota State Bison", awaySeed: 14, homeScore: 92, awayScore: 67, status: "Final" },
  { id: "e3", round: "R64", region: "East", home: "Ohio State Buckeyes", homeSeed: 8, away: "TCU Horned Frogs", awaySeed: 9, homeScore: 64, awayScore: 66, status: "Final" },
  { id: "e4", round: "R64", region: "East", home: "Louisville Cardinals", homeSeed: 6, away: "South Florida Bulls", awaySeed: 11, homeScore: 83, awayScore: 79, status: "Final" },

  // SOUTH REGION
  { id: "s1", round: "R64", region: "South", home: "Illinois Fighting Illini", homeSeed: 3, away: "Pennsylvania Quakers", awaySeed: 14, homeScore: 105, awayScore: 70, status: "Final" },
  { id: "s2", round: "R64", region: "South", home: "Houston Cougars", homeSeed: 2, away: "Idaho Vandals", awaySeed: 15, homeScore: 78, awayScore: 47, status: "Final" },
  { id: "s3", round: "R64", region: "South", home: "Nebraska Cornhuskers", homeSeed: 4, away: "Troy Trojans", awaySeed: 13, homeScore: 76, awayScore: 47, status: "Final" },
  { id: "s4", round: "R64", region: "South", home: "Vanderbilt Commodores", homeSeed: 5, away: "McNeese Cowboys", awaySeed: 12, homeScore: 78, awayScore: 68, status: "Final" },
  { id: "s5", round: "R64", region: "South", home: "North Carolina Tar Heels", homeSeed: 6, away: "VCU Rams", awaySeed: 11, homeScore: 78, awayScore: 82, status: "Final" },
  { id: "s6", round: "R64", region: "South", home: "Saint Mary's Gaels", homeSeed: 7, away: "Texas A&M Aggies", awaySeed: 10, homeScore: 50, awayScore: 63, status: "Final" },

  // WEST REGION
  { id: "w1", round: "R64", region: "West", home: "Gonzaga Bulldogs", homeSeed: 3, away: "Kennesaw State Owls", awaySeed: 14, homeScore: 73, awayScore: 64, status: "Final" },
  { id: "w2", round: "R64", region: "West", home: "Arkansas Razorbacks", homeSeed: 4, away: "Hawai'i Rainbow Warriors", awaySeed: 13, homeScore: 97, awayScore: 78, status: "Final" },
  { id: "w3", round: "R64", region: "West", home: "Wisconsin Badgers", homeSeed: 5, away: "High Point Panthers", awaySeed: 12, homeScore: 82, awayScore: 83, status: "Final" },
  { id: "w4", round: "R64", region: "West", home: "BYU Cougars", homeSeed: 6, away: "Texas Longhorns", awaySeed: 11, homeScore: 71, awayScore: 79, status: "Final" },

  // MIDWEST REGION
  { id: "m1", round: "R64", region: "Midwest", home: "Michigan Wolverines", homeSeed: 1, away: "Howard Bison", awaySeed: 16, homeScore: 101, awayScore: 80, status: "Final" },
  { id: "m2", round: "R64", region: "Midwest", home: "Georgia Bulldogs", homeSeed: 8, away: "Saint Louis Billikens", awaySeed: 9, homeScore: 77, awayScore: 102, status: "Final" },

  // ══ MARCH 20 — LIVE & UPCOMING ══════════════════════════════════════════

  // WEST REGION (live)
  { id: "w5", round: "R64", region: "West", home: "Arizona Wildcats", homeSeed: 1, away: "Long Island University Sharks", awaySeed: 16, homeScore: 53, awayScore: 29, status: "Live", clock: "Halftime" },
  { id: "w6", round: "R64", region: "West", home: "Miami Hurricanes", homeSeed: 7, away: "Missouri Tigers", awaySeed: 10, homeScore: null, awayScore: null, status: "Upcoming" },
  { id: "w7", round: "R64", region: "West", home: "Villanova Wildcats", homeSeed: 8, away: "Utah State Aggies", awaySeed: 9, homeScore: null, awayScore: null, status: "Upcoming" },
  { id: "w8", round: "R64", region: "West", home: "Purdue Boilermakers", homeSeed: 2, away: "Queens University Royals", awaySeed: 15, homeScore: null, awayScore: null, status: "Upcoming" },

  // MIDWEST REGION (live/upcoming)
  { id: "m3", round: "R64", region: "Midwest", home: "Virginia Cavaliers", homeSeed: 3, away: "Wright State Raiders", awaySeed: 14, homeScore: 35, awayScore: 43, status: "Live", clock: "Halftime" },
  { id: "m4", round: "R64", region: "Midwest", home: "Texas Tech Red Raiders", homeSeed: 5, away: "Akron Zips", awaySeed: 12, homeScore: 82, awayScore: 66, status: "Final" },
  { id: "m5", round: "R64", region: "Midwest", home: "Kentucky Wildcats", homeSeed: 7, away: "Santa Clara Broncos", awaySeed: 10, homeScore: 89, awayScore: 84, status: "Final" },
  { id: "m6", round: "R64", region: "Midwest", home: "Iowa State Cyclones", homeSeed: 2, away: "Tennessee State Tigers", awaySeed: 15, homeScore: null, awayScore: null, status: "Upcoming" },
  { id: "m7", round: "R64", region: "Midwest", home: "Alabama Crimson Tide", homeSeed: 4, away: "Hofstra Pride", awaySeed: 13, homeScore: null, awayScore: null, status: "Upcoming" },
  { id: "m8", round: "R64", region: "Midwest", home: "Tennessee Volunteers", homeSeed: 6, away: "Miami (OH) RedHawks", awaySeed: 11, homeScore: null, awayScore: null, status: "Upcoming" },

  // SOUTH REGION (upcoming)
  { id: "s7", round: "R64", region: "South", home: "Clemson Tigers", homeSeed: 8, away: "Iowa Hawkeyes", awaySeed: 9, homeScore: null, awayScore: null, status: "Upcoming" },
  { id: "s8", round: "R64", region: "South", home: "Florida Gators", homeSeed: 1, away: "Prairie View A&M Panthers", awaySeed: 16, homeScore: null, awayScore: null, status: "Upcoming" },

  // EAST REGION (upcoming)
  { id: "e5", round: "R64", region: "East", home: "St. John's Red Storm", homeSeed: 5, away: "Northern Iowa Panthers", awaySeed: 12, homeScore: null, awayScore: null, status: "Upcoming" },
  { id: "e6", round: "R64", region: "East", home: "UCLA Bruins", homeSeed: 7, away: "UCF Knights", awaySeed: 10, homeScore: null, awayScore: null, status: "Upcoming" },
  { id: "e7", round: "R64", region: "East", home: "Kansas Jayhawks", homeSeed: 4, away: "California Baptist Lancers", awaySeed: 13, homeScore: null, awayScore: null, status: "Upcoming" },
  { id: "e8", round: "R64", region: "East", home: "UConn Huskies", homeSeed: 2, away: "Furman Paladins", awaySeed: 15, homeScore: null, awayScore: null, status: "Upcoming" },
];

// ─── ESPN official display name → our short ledger key ───────────────────────
// Covers both the live ESPN API feed AND the demoGames official names above.
const ESPN_NAME_MAP = {
  // Duke
  "duke blue devils": "Duke",
  // Siena
  "siena saints": "Siena",
  // Michigan State
  "michigan state spartans": "Michigan State",
  // North Dakota State
  "north dakota state bison": "North Dakota State",
  "north dakota st. bison": "North Dakota State",
  // Ohio State
  "ohio state buckeyes": "Ohio State",
  // TCU
  "tcu horned frogs": "TCU",
  // Louisville
  "louisville cardinals": "Louisville",
  // South Florida
  "south florida bulls": "South Florida",
  "usf bulls": "South Florida",
  // Illinois
  "illinois fighting illini": "Illinois",
  // Penn / Pennsylvania
  "pennsylvania quakers": "Penn",
  "penn quakers": "Penn",
  // Houston
  "houston cougars": "Houston",
  // Idaho
  "idaho vandals": "Idaho",
  // Nebraska
  "nebraska cornhuskers": "Nebraska",
  // Troy
  "troy trojans": "Troy",
  // Vanderbilt
  "vanderbilt commodores": "Vanderbilt",
  // McNeese
  "mcneese cowboys": "McNeese",
  "mcneese state cowboys": "McNeese",
  // North Carolina
  "north carolina tar heels": "North Carolina",
  "unc tar heels": "North Carolina",
  // VCU
  "vcu rams": "VCU",
  // Saint Mary's
  "saint mary's gaels": "Saint Mary's",
  "saint mary's (ca) gaels": "Saint Mary's",
  "saint mary's": "Saint Mary's",
  // Texas A&M
  "texas a&m aggies": "Texas A&M",
  // Gonzaga
  "gonzaga bulldogs": "Gonzaga",
  // Kennesaw State
  "kennesaw state owls": "Kennesaw State",
  // Arkansas
  "arkansas razorbacks": "Arkansas",
  // Hawai'i
  "hawai'i rainbow warriors": "Hawai'i",
  "hawaii rainbow warriors": "Hawai'i",
  // Wisconsin
  "wisconsin badgers": "Wisconsin",
  // High Point
  "high point panthers": "High Point",
  // BYU
  "byu cougars": "BYU",
  // Texas
  "texas longhorns": "Texas",
  // Michigan
  "michigan wolverines": "Michigan",
  // Howard
  "howard bison": "Howard",
  // Georgia
  "georgia bulldogs": "Georgia",
  // Saint Louis
  "saint louis billikens": "Saint Louis",
  // Arizona
  "arizona wildcats": "Arizona",
  // LIU / Long Island University
  "long island university sharks": "LIU",
  "liu sharks": "LIU",
  "long island university": "LIU",
  // Miami (FL)
  "miami hurricanes": "Miami (FL)",
  "miami (fl) hurricanes": "Miami (FL)",
  // Miami (OH)
  "miami redhawks": "Miami (OH)",
  "miami (oh) redhawks": "Miami (OH)",
  // Missouri
  "missouri tigers": "Missouri",
  // Villanova
  "villanova wildcats": "Villanova",
  // Utah State
  "utah state aggies": "Utah State",
  // Purdue
  "purdue boilermakers": "Purdue",
  // Queens
  "queens university royals": "Queens",
  "queens royals": "Queens",
  "queens (nc) royals": "Queens",
  // Virginia
  "virginia cavaliers": "Virginia",
  // Wright State
  "wright state raiders": "Wright State",
  // Texas Tech
  "texas tech red raiders": "Texas Tech",
  // Akron
  "akron zips": "Akron",
  // Kentucky
  "kentucky wildcats": "Kentucky",
  // Santa Clara
  "santa clara broncos": "Santa Clara",
  // Iowa State
  "iowa state cyclones": "Iowa State",
  // Tennessee State
  "tennessee state tigers": "Tennessee State",
  // Alabama
  "alabama crimson tide": "Alabama",
  // Hofstra
  "hofstra pride": "Hofstra",
  // Tennessee
  "tennessee volunteers": "Tennessee",
  // Clemson
  "clemson tigers": "Clemson",
  // Iowa
  "iowa hawkeyes": "Iowa",
  // Florida
  "florida gators": "Florida",
  // Prairie View A&M
  "prairie view a&m panthers": "Prairie View A&M",
  // St. John's
  "st. john's red storm": "St. John's",
  "st. john's": "St. John's",
  // Northern Iowa
  "northern iowa panthers": "Northern Iowa",
  // UCLA
  "ucla bruins": "UCLA",
  // UCF
  "ucf knights": "UCF",
  // Kansas
  "kansas jayhawks": "Kansas",
  // California Baptist
  "california baptist lancers": "California Baptist",
  "cal baptist lancers": "California Baptist",
  // UConn
  "connecticut huskies": "UConn",
  "uconn huskies": "UConn",
  // Furman
  "furman paladins": "Furman",
  // Michigan State (duplicate for safety)
  "msu spartans": "Michigan State",
};

// Normalize any name ESPN sends into our canonical ledger name
function normalizeName(raw) {
  if (!raw) return "";
  const lower = raw.trim().toLowerCase();
  return ESPN_NAME_MAP[lower] || raw.trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ownerName(ownerId) {
  return fantasyTeams.find((f) => f.id === ownerId)?.name || "Unassigned";
}
function fantasyTeamName(teamId) {
  return fantasyTeams.find((team) => team.id === teamId)?.name || "League";
}
function roundPoints(round) { return ROUND_POINTS[round] ?? 0; }

function getWinner(game) {
  if (game.homeScore == null || game.awayScore == null) return null;
  if (Number(game.homeScore) === Number(game.awayScore)) return null;
  return Number(game.homeScore) > Number(game.awayScore)
    ? { school: game.home, seed: game.homeSeed }
    : { school: game.away, seed: game.awaySeed };
}

function getLoser(game) {
  if (game.homeScore == null || game.awayScore == null) return null;
  if (Number(game.homeScore) === Number(game.awayScore)) return null;
  return Number(game.homeScore) < Number(game.awayScore)
    ? { school: game.home, seed: game.homeSeed }
    : { school: game.away, seed: game.awaySeed };
}

function scoreGame(game) {
  const winner = getWinner(game);
  if (!winner || game.status !== "Final") return 0;
  return roundPoints(game.round);
}

// Case-insensitive + ESPN-normalized owner lookup
function buildOwnerMap() {
  const map = {};
  ownedTeams.forEach(t => {
    map[t.school.toLowerCase()] = t.ownerId;
  });
  return map;
}
const _ownerMapLower = buildOwnerMap();
function lookupOwner(schoolName) {
  const normalized = normalizeName(schoolName).toLowerCase();
  return _ownerMapLower[normalized] || null;
}

function requiresAuctionOwner(game) {
  return Boolean(game);
}

// Returns sorted standings; wins are derived entirely from demoGames/live feed.
function standingsFromGames(games) {
  const byTeam = Object.fromEntries(
    fantasyTeams.map((t) => [t.id, { ...t, spent: 0, points: 0, wins: 0, schools: [] }])
  );
  ownedTeams.forEach((row) => {
    byTeam[row.ownerId].spent += row.price;
    byTeam[row.ownerId].schools.push(row);
  });
  games.forEach((game) => {
    if (game.status !== "Final") return;
    const winner = getWinner(game);
    if (!winner) return;
    const canonicalName = normalizeName(winner.school);
    const owned = ownedTeams.find((t) => t.school.toLowerCase() === canonicalName.toLowerCase());
    if (!owned) return;
    byTeam[owned.ownerId].points += scoreGame(game);
    byTeam[owned.ownerId].wins += 1;
  });
  return Object.values(byTeam)
    .map((t) => ({
      ...t,
      remaining: t.budget - t.spent,
      roi: t.spent > 0 ? (t.points / t.spent).toFixed(2) : "0.00",
    }))
    .sort((a, b) => b.points - a.points || a.spent - b.spent);
}

function isSchoolAlive(school, games) {
  const key = school.toLowerCase();
  return !games.some(g =>
    g.status === "Final" && (
      (normalizeName(g.home).toLowerCase() === key && Number(g.homeScore) < Number(g.awayScore)) ||
      (normalizeName(g.away).toLowerCase() === key && Number(g.awayScore) < Number(g.homeScore))
    )
  );
}

const REGION_SEED_ORDER = [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
const FINAL_FOUR_REGION_PAIRS = [["East", "South"], ["West", "Midwest"]];

function sortOwnedSchools(schools, games) {
  return schools.slice().sort((a, b) => {
    const aAlive = isSchoolAlive(a.school, games);
    const bAlive = isSchoolAlive(b.school, games);
    if (aAlive !== bAlive) return aAlive ? -1 : 1;
    return a.seed - b.seed || a.school.localeCompare(b.school);
  });
}

function buildTeamMetaMap(games) {
  const meta = new Map();

  const addTeam = (schoolName, seed, region) => {
    const school = normalizeName(schoolName);
    if (!school) return;
    const existing = meta.get(school) || {};
    meta.set(school, {
      school,
      seed: seed ?? existing.seed ?? null,
      region: region || existing.region || null,
    });
  };

  ownedTeams.forEach((team) => addTeam(team.school, team.seed, team.region));
  games.forEach((game) => {
    addTeam(game.home, game.homeSeed, game.region);
    addTeam(game.away, game.awaySeed, game.region);
  });

  return meta;
}

function buildAliveSlotMap(games, teamMeta) {
  const slotMap = {};

  teamMeta.forEach((team) => {
    if (!team.region || team.seed == null || !isSchoolAlive(team.school, games)) return;
    const slotKey = `${team.region}:${team.seed}`;
    if (!slotMap[slotKey]) slotMap[slotKey] = [];
    slotMap[slotKey].push(team.school);
  });

  return slotMap;
}

function createLeafNode(region, seed, slotMap) {
  return {
    kind: "leaf",
    regions: [region],
    seeds: [seed],
    contenders: slotMap[`${region}:${seed}`] || [],
  };
}

function createMatchNode(left, right, round, regions) {
  return {
    kind: "match",
    round,
    left,
    right,
    regions,
    seeds: [...new Set([...left.seeds, ...right.seeds])],
  };
}

function buildRegionTree(region, slotMap) {
  const leaves = REGION_SEED_ORDER.map((seed) => createLeafNode(region, seed, slotMap));
  const r64 = Array.from({ length: 8 }, (_, index) => createMatchNode(leaves[index * 2], leaves[index * 2 + 1], "R64", [region]));
  const r32 = Array.from({ length: 4 }, (_, index) => createMatchNode(r64[index * 2], r64[index * 2 + 1], "R32", [region]));
  const s16 = Array.from({ length: 2 }, (_, index) => createMatchNode(r32[index * 2], r32[index * 2 + 1], "S16", [region]));
  return createMatchNode(s16[0], s16[1], "E8", [region]);
}

function buildTournamentTree(slotMap) {
  const regionChampions = {
    East: buildRegionTree("East", slotMap),
    South: buildRegionTree("South", slotMap),
    West: buildRegionTree("West", slotMap),
    Midwest: buildRegionTree("Midwest", slotMap),
  };

  const semifinals = FINAL_FOUR_REGION_PAIRS.map(([leftRegion, rightRegion]) =>
    createMatchNode(regionChampions[leftRegion], regionChampions[rightRegion], "F4", [leftRegion, rightRegion])
  );

  return createMatchNode(semifinals[0], semifinals[1], "CH", ["East", "South", "West", "Midwest"]);
}

function nodeCanContainSchool(node, school, teamMeta) {
  const team = teamMeta.get(normalizeName(school));
  return Boolean(team && node.regions.includes(team.region) && node.seeds.includes(team.seed));
}

function findExistingGameForNode(node, games, teamMeta) {
  if (node.kind !== "match") return null;

  return games.find((game) => {
    if (game.round !== node.round) return false;
    if (node.regions.length === 1 && game.region !== node.regions[0]) return false;
    return nodeCanContainSchool(node, game.home, teamMeta) && nodeCanContainSchool(node, game.away, teamMeta);
  }) || null;
}

function solveNodeForOwner(node, ownerId, games, teamMeta) {
  if (node.kind === "leaf") {
    return Object.fromEntries(node.contenders.map((school) => [school, 0]));
  }

  const existingGame = findExistingGameForNode(node, games, teamMeta);
  if (existingGame?.status === "Final") {
    const winner = normalizeName(getWinner(existingGame)?.school || "");
    return winner ? { [winner]: 0 } : {};
  }

  const leftResults = solveNodeForOwner(node.left, ownerId, games, teamMeta);
  const rightResults = solveNodeForOwner(node.right, ownerId, games, teamMeta);
  const leftEntries = Object.entries(leftResults);
  const rightEntries = Object.entries(rightResults);

  if (leftEntries.length === 0) return rightResults;
  if (rightEntries.length === 0) return leftResults;

  const results = {};

  leftEntries.forEach(([leftWinner, leftPoints]) => {
    rightEntries.forEach(([rightWinner, rightPoints]) => {
      const basePoints = leftPoints + rightPoints;
      const leftTotal = basePoints + (lookupOwner(leftWinner) === ownerId ? roundPoints(node.round) : 0);
      const rightTotal = basePoints + (lookupOwner(rightWinner) === ownerId ? roundPoints(node.round) : 0);

      results[leftWinner] = Math.max(results[leftWinner] ?? 0, leftTotal);
      results[rightWinner] = Math.max(results[rightWinner] ?? 0, rightTotal);
    });
  });

  return results;
}

function ownerRemainingCeilings(games) {
  const teamMeta = buildTeamMetaMap(games);
  const slotMap = buildAliveSlotMap(games, teamMeta);
  const tree = buildTournamentTree(slotMap);

  return Object.fromEntries(
    fantasyTeams.map((team) => {
      const results = solveNodeForOwner(tree, team.id, games, teamMeta);
      return [team.id, Math.max(0, ...Object.values(results))];
    })
  );
}

function tournamentPointsRemaining(games) {
  const awardedPoints = games
    .filter((game) => game.status === "Final")
    .reduce((sum, game) => sum + scoreGame(game), 0);
  return TOTAL_TOURNAMENT_POINTS - awardedPoints;
}

function formatGameDateTime(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    timeZone: LEAGUE_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatCommentTime(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    timeZone: LEAGUE_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatLeagueTime(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    timeZone: LEAGUE_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatLeagueDateKey(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", {
    timeZone: LEAGUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatLeagueDateLabel(dateValue) {
  if (!dateValue) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue))) {
    const [year, month, day] = String(dateValue).split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], {
    timeZone: LEAGUE_TIME_ZONE,
    month: "short",
    day: "numeric",
  });
}

function gamesOnLeagueDate(games, dateKey) {
  return games.filter((game) => formatLeagueDateKey(game.date) === dateKey);
}

function ownerPotentialPointsOnDate(ownerId, games, dateKey) {
  return gamesOnLeagueDate(games, dateKey).reduce((sum, game) => {
    const homeOwner = lookupOwner(game.home);
    const awayOwner = lookupOwner(game.away);
    if (homeOwner !== ownerId && awayOwner !== ownerId) return sum;
    return sum + roundPoints(game.round);
  }, 0);
}

function ownerActualPointsOnDate(ownerId, games, dateKey) {
  return gamesOnLeagueDate(games, dateKey).reduce((sum, game) => {
    if (game.status !== "Final") return sum;
    const winner = getWinner(game);
    if (!winner) return sum;
    return lookupOwner(winner.school) === ownerId ? sum + scoreGame(game) : sum;
  }, 0);
}

function findLatestCompletedDateKey(games) {
  const dateKeys = [...new Set(games.map((game) => formatLeagueDateKey(game.date)).filter(Boolean))].sort();
  const completedKeys = dateKeys.filter((dateKey) => {
    const dayGames = gamesOnLeagueDate(games, dateKey);
    return dayGames.length > 0 && dayGames.every((game) => game.status === "Final");
  });
  return completedKeys[completedKeys.length - 1] || "";
}

function findNextScheduledDateKey(games, afterDateKey) {
  return [...new Set(games.map((game) => formatLeagueDateKey(game.date)).filter(Boolean))]
    .sort()
    .find((dateKey) => dateKey > afterDateKey) || "";
}

function recapHeadline(leader, runnerUp, gap) {
  if (!leader) return "Nobody grabbed the wheel today.";
  if (!runnerUp) return `${leader.name} is basically drinking alone at the top.`;
  if (gap <= 0) return `It's a dead heat and everybody's already talking too much.`;
  if (gap <= 2) return `${leader.name} is in front, but it's still close enough for grown men to start barking.`;
  if (gap <= 5) return `${leader.name} leaves the day on top while the rest of the room mutters into its beer.`;
  return `${leader.name} put a boot on the league's throat today.`;
}

function buildDailyRecapNotification(games, recapDateKey) {
  if (!recapDateKey) return null;

  const standings = standingsFromGames(games);
  const nextDateKey = findNextScheduledDateKey(games, recapDateKey);
  const leader = standings[0] || null;
  const runnerUp = standings[1] || null;
  const gap = leader && runnerUp ? leader.points - runnerUp.points : 0;

  const leaderboardLines = standings.slice(0, 3).map((team, index) =>
    `${index + 1}. ${team.name} ${team.points} pts`
  );
  const remainingLines = standings.map((team) =>
    `${team.name}: ${team.schools.filter((school) => isSchoolAlive(school.school, games)).length} alive`
  );
  const todayLines = standings.map((team) => {
    const actual = ownerActualPointsOnDate(team.id, games, recapDateKey);
    const potential = ownerPotentialPointsOnDate(team.id, games, recapDateKey);
    return `${team.name}: +${actual} actual, +${potential} in play`;
  });
  const tomorrowLines = nextDateKey
    ? standings.map((team) => `${team.name}: +${ownerPotentialPointsOnDate(team.id, games, nextDateKey)} potential`)
    : ["No games on deck tomorrow."];

  return {
    id: `recap:${recapDateKey}`,
    kind: "dailyRecap",
    title: `${formatLeagueDateLabel(recapDateKey)} Recap`,
    body: recapHeadline(leader, runnerUp, gap),
    createdAt: `${recapDateKey.slice(0, 4)}-${recapDateKey.slice(4, 6)}-${recapDateKey.slice(6, 8)}T23:59:00.000Z`,
    read: false,
    sections: [
      { title: "Leaderboard", lines: leaderboardLines },
      { title: "Schools Remaining", lines: remainingLines },
      { title: "Today", lines: todayLines },
      { title: nextDateKey ? `${formatLeagueDateLabel(nextDateKey)} Outlook` : "Next Up", lines: tomorrowLines },
    ],
  };
}

function buildDailyRecapNotifications(games) {
  const dateKeys = [...new Set(games.map((game) => formatLeagueDateKey(game.date)).filter(Boolean))].sort();
  const completedKeys = dateKeys.filter((dateKey) => {
    const dayGames = gamesOnLeagueDate(games, dateKey);
    return dayGames.length > 0 && dayGames.every((game) => game.status === "Final");
  });
  return completedKeys
    .map((dateKey) => buildDailyRecapNotification(games, dateKey))
    .filter(Boolean);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMentionLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function nameInitials(value) {
  const words = normalizeMentionLabel(value).split(" ").filter(Boolean);
  if (words.length === 0) return "?";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() || "").join("");
}

function buildMentionEntities(comments, commentUserName = "") {
  const seenUsers = new Set();
  const userEntities = [];

  [commentUserName, ...comments.map((comment) => comment.authorName)].forEach((name) => {
    const label = normalizeMentionLabel(name);
    const key = label.toLowerCase();
    if (!label || seenUsers.has(key)) return;
    seenUsers.add(key);
    userEntities.push({
      key: `user:${key}`,
      label,
      type: "user",
    });
  });

  return userEntities;
}

function findMentionSuggestions(message, entities) {
  const match = message.match(/(?:^|\s)@([^@\n]{0,40})$/);
  if (!match) return [];
  const query = match[1].trim().toLowerCase();
  return entities
    .filter((entity) => !query || entity.label.toLowerCase().includes(query))
    .slice(0, 6);
}

function applyMentionSuggestion(message, label) {
  return message.replace(/(^|\s)@[^@\n]{0,40}$/, (_whole, prefix) => `${prefix}@${label} `);
}

function commentMentionsUser(message, userName) {
  const cleanUserName = normalizeMentionLabel(userName);
  if (!cleanUserName) return false;

  const pattern = new RegExp(`(^|\\s)@${escapeRegex(cleanUserName)}(?=$|[\\s.,!?;:])`, "i");
  return pattern.test(String(message || ""));
}

function renderCommentMessage(text, mentionEntities) {
  const content = String(text || "");
  if (!content) return null;

  const tokens = mentionEntities
    .map((entity) => ({ ...entity, token: `@${entity.label}` }))
    .sort((a, b) => b.token.length - a.token.length);

  if (tokens.length === 0) return content;

  const pattern = new RegExp(tokens.map((entity) => escapeRegex(entity.token)).join("|"), "gi");
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const matchedText = match[0];
    const entity = tokens.find((item) => item.token.toLowerCase() === matchedText.toLowerCase());
    if (entity) {
      parts.push(
        <span
          key={`${matchedText}-${match.index}`}
          style={{
            display: "inline-block",
            padding: "1px 8px",
            borderRadius: 999,
            background: "#e0f2fe",
            color: "#0369a1",
            fontWeight: 800,
            margin: "0 2px",
          }}
        >
          {matchedText}
        </span>
      );
    } else {
      parts.push(matchedText);
    }
    lastIndex = match.index + matchedText.length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts;
}

// ─── Team colour palette (one per fantasy team) ───────────────────────────────
const TEAM_COLORS = {
  "mike-bob": { bg: "#dbeafe", accent: "#1d4ed8", text: "#1e3a8a" },
  "solomon-brenden": { bg: "#dcfce7", accent: "#15803d", text: "#14532d" },
  "dan-chris": { bg: "#fef3c7", accent: "#b45309", text: "#78350f" },
  "ryan-brian": { bg: "#fee2e2", accent: "#dc2626", text: "#7f1d1d" },
  "mikea-gregg": { bg: "#ede9fe", accent: "#7c3aed", text: "#4c1d95" },
  "josh-gabe": { bg: "#ffedd5", accent: "#ea580c", text: "#9a3412" },
};

function teamColor(id) {
  return TEAM_COLORS[id] || { bg: "#f1f5f9", accent: "#475569", text: "#0f172a" };
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  const theme = useTheme();
  return <div style={{ background: theme.surface, color: theme.text, borderRadius: 20, padding: 20, boxShadow: theme.shadow, border: `1px solid ${theme.border}`, ...style }}>{children}</div>;
}

function StatCard({ title, value, sub, accent }) {
  const theme = useTheme();
  return (
    <Card style={{ borderTop: accent ? `4px solid ${accent}` : undefined }}>
      <div style={{ color: theme.muted, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6, lineHeight: 1, color: theme.text }}>{value}</div>
      <div style={{ color: theme.subtleText, fontSize: 12, marginTop: 6 }}>{sub}</div>
    </Card>
  );
}

function Badge({ children, color, textColor }) {
  const theme = useTheme();
  return (
    <span style={{ background: color || theme.surfaceStrong, color: textColor || theme.muted, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function BudgetBar({ spent, budget }) {
  const theme = useTheme();
  const pct = Math.min(100, Math.round((spent / budget) * 100));
  const color = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: theme.muted, marginBottom: 4 }}>
        <span>${spent} spent</span><span>${budget - spent} left</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: theme.surfaceStrong }}>
        <div style={{ height: 6, borderRadius: 999, width: `${pct}%`, background: color, transition: "width .4s" }} />
      </div>
    </div>
  );
}

function OwnershipBoard({ games, teams = fantasyTeams, filter = "all", search = "", isMobile = false }) {
  const theme = useTheme();
  const [expandedOutByTeam, setExpandedOutByTeam] = useState({});
  const query = search.trim().toLowerCase();
  const standingsByTeamId = useMemo(
    () => Object.fromEntries(standingsFromGames(games).map((team) => [team.id, team])),
    [games]
  );
  const teamMaxRemaining = useMemo(() => ownerRemainingCeilings(games), [games]);
  const columns = teams
    .filter((team) => filter === "all" || team.id === filter)
    .map((team) => {
      const allSchools = ownedTeams.filter((row) => row.ownerId === team.id);
      const schools = sortOwnedSchools(
        allSchools.filter((row) =>
          !query || [row.school, row.region, String(row.seed)].join(" ").toLowerCase().includes(query)
        ),
        games
      );
      const spent = allSchools.reduce((sum, school) => sum + school.price, 0);
      const aliveCount = allSchools.filter((school) => isSchoolAlive(school.school, games)).length;
      const currentPoints = standingsByTeamId[team.id]?.points ?? 0;
      const maxLeft = teamMaxRemaining[team.id] ?? 0;
      const totalPossible = currentPoints + maxLeft;
      return { team, schools, spent, aliveCount, currentPoints, maxLeft, totalPossible, totalTeams: allSchools.length };
    });

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(260px,1fr))",
      gap: 12,
      alignItems: "flex-start",
    }}>
      {columns.map(({ team, schools, spent, aliveCount, currentPoints, maxLeft, totalPossible, totalTeams }) => {
        const c = teamColor(team.id);
        const isDarkTheme = theme.pageBg === "#000000";
        const aliveSchools = schools.filter((school) => isSchoolAlive(school.school, games));
        const outSchools = schools.filter((school) => !isSchoolAlive(school.school, games));
        const showOut = Boolean(expandedOutByTeam[team.id]);
        return (
          <div key={team.id} style={{ minWidth: 0 }}>
            <div style={{ background: c.bg, border: `1.5px solid ${c.accent}20`, borderRadius: 16, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 15, color: c.text }}>{team.name}</div>
                  <div style={{ color: c.accent, fontSize: 11, marginTop: 1 }}>
                    {team.members.join(" · ")}
                  </div>
                </div>
                <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
                  <Badge color={c.accent} textColor="#fff">{totalTeams} teams</Badge>
                  <div style={{ color: c.text, fontSize: 11, fontWeight: 700 }}>{aliveCount} alive</div>
                </div>
              </div>
              <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 10,
              }}>
                <div style={{ background: theme.surface, borderRadius: 999, padding: "6px 10px", border: `1px solid ${c.accent}22`, display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontWeight: 900, fontSize: 14, color: c.accent }}>{currentPoints}</div>
                  <div style={{ fontSize: 10, color: theme.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>now</div>
                </div>
                <div style={{ background: theme.surface, borderRadius: 999, padding: "6px 10px", border: `1px solid ${c.accent}22`, display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: theme.text }}>+{maxLeft}</div>
                  <div style={{ fontSize: 10, color: theme.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>left</div>
                </div>
                <div style={{ background: theme.surface, borderRadius: 999, padding: "6px 10px", border: `1px solid ${c.accent}22`, display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ fontWeight: 900, fontSize: 13, color: c.accent }}>≤{totalPossible}</div>
                  <div style={{ fontSize: 10, color: theme.muted, textTransform: "uppercase", letterSpacing: ".04em" }}>total</div>
                </div>
                <div style={{ color: theme.muted, fontSize: 11, marginLeft: "auto", alignSelf: "center" }}>${spent} spent</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              {aliveSchools.map((school) => {
                const alive = isSchoolAlive(school.school, games);
                const schoolBg = alive
                  ? (isDarkTheme ? "#e5e7eb" : theme.surface)
                  : (isDarkTheme ? "#d4d4d8" : theme.surfaceAlt);
                const schoolText = alive
                  ? (isDarkTheme ? "#111827" : theme.text)
                  : (isDarkTheme ? "#334155" : theme.muted);
                const schoolMeta = alive
                  ? (isDarkTheme ? "#475569" : theme.subtleText)
                  : (isDarkTheme ? "#64748b" : theme.subtleText);
                const schoolBorder = alive ? `${c.accent}55` : (isDarkTheme ? "#a1a1aa" : theme.borderStrong);
                return (
                  <div key={school.school} style={{
                    background: schoolBg,
                    border: `1px solid ${schoolBorder}`,
                    borderRadius: 12,
                    padding: "8px 10px",
                    opacity: alive ? 1 : 0.82,
                    boxShadow: alive ? `inset 0 0 0 1px ${c.accent}22` : "none",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontWeight: 800,
                          fontSize: 13,
                          color: schoolText,
                          textDecoration: alive ? "none" : "line-through",
                          textDecorationThickness: "2px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}>
                          {school.school}
                        </div>
                        <div style={{ color: schoolMeta, fontSize: 10, marginTop: 1 }}>
                          {school.region} · {school.seed} seed · {alive ? "Alive" : "Out"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: 15, color: isDarkTheme ? "#111827" : c.accent }}>${school.price}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {outSchools.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedOutByTeam((current) => ({ ...current, [team.id]: !current[team.id] }))}
                    style={{
                      border: `1px solid ${theme.border}`,
                      background: isDarkTheme ? "#e5e7eb" : theme.surface,
                      color: isDarkTheme ? "#111827" : theme.muted,
                      borderRadius: 12,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 800,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    {showOut ? "Hide" : "Show"} Teams Out ({outSchools.length})
                  </button>
                  {showOut && outSchools.map((school) => (
                    <div key={school.school} style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: "8px 10px",
                      opacity: 0.68,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontWeight: 800,
                            fontSize: 13,
                            color: "#64748b",
                            textDecoration: "line-through",
                            textDecorationThickness: "2px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}>
                            {school.school}
                          </div>
                          <div style={{ color: "#94a3b8", fontSize: 10, marginTop: 1 }}>
                            {school.region} · {school.seed} seed · Out
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontWeight: 900, fontSize: 15, color: c.accent }}>${school.price}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {schools.length === 0 && (
                <div style={{ border: "1.5px dashed #e2e8f0", borderRadius: 14, padding: 16, color: "#94a3b8", textAlign: "center", fontSize: 13 }}>
                  No teams match
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeaderboardChat({
  comments,
  commentUserName,
  commentTeam,
  unreadCommentCount,
  commentsError,
  isMobile,
  onSubmitComment,
  onMarkCommentsRead,
  onCommentUserNameChange,
  onCommentTeamChange,
}) {
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const threadComments = comments;
  const cleanUserName = commentUserName.trim();
  const canPost = Boolean(cleanUserName);

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanMessage = message.trim();
    const authorName = cleanUserName;
    const authorTeamId = commentTeam?.id || null;

    if (!cleanUserName) {
      setSubmitError("Add your name before posting.");
      return;
    }
    if (!cleanMessage) {
      setSubmitError("Type a comment first.");
      return;
    }

    setSubmitError("");
    setIsSubmitting(true);

    try {
      await onSubmitComment({
        authorName,
        authorTeamId,
        teamId: null,
        message: cleanMessage,
      });
      setMessage("");
      onMarkCommentsRead();
    } catch (error) {
      setSubmitError(error.message || "Unable to post comment right now.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: isMobile ? "flex-start" : "center",
        flexDirection: isMobile ? "column" : "row",
        gap: 12,
        marginBottom: 14,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Leaderboard Chat</div>
            <Badge color="#e2e8f0" textColor="#475569">
              League chat
            </Badge>
            {unreadCommentCount > 0 && <Badge color="#fee2e2" textColor="#b91c1c">{unreadCommentCount} new</Badge>}
          </div>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
            League-wide reactions, game comments, and standings trash talk. Everyone sees the same thread.
          </div>
        </div>
        <button
          onClick={onMarkCommentsRead}
          style={{
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#0f172a",
            borderRadius: 999,
            padding: "10px 14px",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Mark read
        </button>
      </div>

      <div style={{
        border: "1px solid #e2e8f0",
        borderRadius: 16,
        padding: 14,
        background: "#f8fafc",
        maxHeight: 320,
        overflowY: "auto",
        display: "grid",
        gap: 10,
      }}>
        {threadComments.length > 0 ? threadComments.map((comment) => {
          const authorColor = comment.authorTeamId ? teamColor(comment.authorTeamId) : null;
          return (
            <div key={comment.id} style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 14,
              padding: "12px 14px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800, color: authorColor?.text || "#0f172a" }}>{comment.authorName}</div>
                  {comment.authorTeamId && (
                    <Badge color={authorColor.bg} textColor={authorColor.accent}>
                      {ownerName(comment.authorTeamId)}
                    </Badge>
                  )}
                  {comment.teamId && (
                    <Badge color="#e0f2fe" textColor="#0f766e">
                      {fantasyTeamName(comment.teamId)}
                    </Badge>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{formatCommentTime(comment.createdAt)}</div>
              </div>
              <div style={{ marginTop: 8, color: "#334155", fontSize: 14, lineHeight: 1.5 }}>{comment.message}</div>
            </div>
          );
        }) : (
          <div style={{ color: "#94a3b8", textAlign: "center", padding: "20px 12px", fontSize: 13 }}>
            No comments yet.
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.1fr 1fr", gap: 10 }}>
          <input
            value={commentUserName}
            onChange={(event) => onCommentUserNameChange(event.target.value)}
            placeholder="Your name"
            maxLength={40}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 14,
              background: "#fff",
            }}
          />
          <select
            value={commentTeam?.id || ""}
            onChange={(event) => onCommentTeamChange(event.target.value)}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 14,
              background: "#fff",
            }}
          >
            <option value="">Select your team</option>
            {fantasyTeams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Add a league-wide comment..."
          maxLength={400}
          rows={isMobile ? 4 : 3}
          style={{
            width: "100%",
            border: "1px solid #cbd5e1",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 14,
            background: "#fff",
            resize: "vertical",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", flexDirection: isMobile ? "column" : "row", gap: 10 }}>
          {(submitError || commentsError) ? (
            <div style={{ color: "#b91c1c", fontSize: 12 }}>
              {submitError || commentsError}
            </div>
          ) : <div />}
          <button
            type="submit"
            disabled={isSubmitting || !canPost}
            style={{
              border: "none",
              background: isSubmitting || !canPost ? "#cbd5e1" : "#0f172a",
              color: "#fff",
              borderRadius: 12,
              padding: "12px 16px",
              fontWeight: 800,
              cursor: isSubmitting || !canPost ? "default" : "pointer",
              minWidth: 130,
            }}
          >
            {isSubmitting ? "Posting..." : "Post comment"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function CommentsView({
  comments,
  commentUserName,
  commentTeam,
  commentClientId,
  unreadCommentCount,
  unreadMentionCount,
  commentsError,
  isMobile,
  onSubmitComment,
  onEditComment,
  onMarkCommentsRead,
}) {
  const [replyTargetId, setReplyTargetId] = useState("");
  const [editingCommentId, setEditingCommentId] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const replyTarget = comments.find((comment) => comment.id === replyTargetId) || null;
  const editingComment = comments.find((comment) => comment.id === editingCommentId) || null;

  useEffect(() => {
    if (replyTargetId && !comments.some((comment) => comment.id === replyTargetId)) {
      setReplyTargetId("");
    }
  }, [comments, replyTargetId]);

  useEffect(() => {
    if (editingCommentId && !comments.some((comment) => comment.id === editingCommentId)) {
      setEditingCommentId("");
    }
  }, [comments, editingCommentId]);

  function handleQuickReact(comment, emoji) {
    setReplyTargetId(comment.id);
    setEditingCommentId("");
    setDraftMessage((current) => {
      const cleanCurrent = String(current || "").trim();
      if (!cleanCurrent) return `${emoji} `;
      if (cleanCurrent.startsWith(emoji)) return current;
      return `${emoji} ${cleanCurrent}`;
    });
  }

  return (
    <div style={{ display: "grid", gap: 14, alignItems: "start" }}>
      <ChatThread
        comments={comments}
        commentUserName={commentUserName}
        commentTeam={commentTeam}
        commentClientId={commentClientId}
        unreadCommentCount={unreadCommentCount}
        unreadMentionCount={unreadMentionCount}
        isMobile={isMobile}
        onMarkCommentsRead={onMarkCommentsRead}
        onReply={(comment) => {
          setEditingCommentId("");
          setReplyTargetId(comment.id);
        }}
        onEdit={(comment) => {
          setReplyTargetId("");
          setEditingCommentId(comment.id);
          setDraftMessage(comment.message);
        }}
        onQuickReact={handleQuickReact}
      />
      <ChatComposer
        comments={comments}
        commentUserName={commentUserName}
        commentTeam={commentTeam}
        replyTarget={replyTarget}
        editingComment={editingComment}
        commentsError={commentsError}
        isMobile={isMobile}
        message={draftMessage}
        onMessageChange={setDraftMessage}
        onSubmitComment={onSubmitComment}
        onEditComment={onEditComment}
        onClearReply={() => setReplyTargetId("")}
        onClearEdit={() => setEditingCommentId("")}
      />
    </div>
  );
}

function CommentReplySnippet({ comment, isMobile, ownComment = false }) {
  const theme = useTheme();
  if (!comment) return null;
  const authorColor = comment.authorTeamId ? teamColor(comment.authorTeamId) : null;
  return (
    <div style={{
      background: ownComment ? "rgba(255,255,255,.14)" : theme.surfaceAlt,
      border: ownComment ? "1px solid rgba(255,255,255,.18)" : `1px solid ${theme.border}`,
      borderRadius: 9,
      padding: isMobile ? "6px 8px" : "7px 9px",
      marginBottom: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{
          background: ownComment ? "rgba(255,255,255,.18)" : (authorColor?.bg || theme.surfaceStrong),
          color: ownComment ? "#fff" : (authorColor?.text || theme.text),
          borderRadius: 999,
          padding: "3px 8px",
          fontWeight: 900,
          fontSize: 11,
          lineHeight: 1.1,
        }}>
          {comment.authorName}
        </div>
        <div style={{ fontSize: 10, color: ownComment ? "rgba(255,255,255,.72)" : theme.subtleText }}>{formatCommentTime(comment.createdAt)}</div>
      </div>
      <div style={{ marginTop: 3, color: ownComment ? "rgba(255,255,255,.86)" : theme.muted, fontSize: 11, lineHeight: 1.3 }}>{comment.message}</div>
    </div>
  );
}

function ChatComposer({
  comments,
  commentUserName,
  commentTeam,
  replyTarget,
  editingComment,
  commentsError,
  isMobile,
  message,
  onMessageChange,
  onSubmitComment,
  onEditComment,
  onClearReply,
  onClearEdit,
}) {
  const theme = useTheme();
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const cleanUserName = commentUserName.trim();
  const canPost = Boolean(cleanUserName);
  const composerExpanded = isFocused || Boolean(replyTarget) || Boolean(editingComment) || Boolean(String(message || "").trim());
  const mentionEntities = useMemo(
    () => buildMentionEntities(comments, commentUserName),
    [comments, commentUserName]
  );
  const mentionSuggestions = useMemo(
    () => findMentionSuggestions(message, mentionEntities),
    [message, mentionEntities]
  );
  const quickMentionUsers = useMemo(
    () => mentionEntities.filter((entity) => entity.label.toLowerCase() !== cleanUserName.toLowerCase()).slice(0, 6),
    [mentionEntities, cleanUserName]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanMessage = message.trim();
    const authorName = cleanUserName;
    const authorTeamId = commentTeam?.id || null;

    if (!cleanUserName) {
      setSubmitError("Add your name before posting.");
      return;
    }
    if (!cleanMessage) {
      setSubmitError("Type a comment first.");
      return;
    }

    setSubmitError("");
    setIsSubmitting(true);

    try {
      if (editingComment) {
        await onEditComment({
          commentId: editingComment.id,
          message: cleanMessage,
        });
      } else {
        await onSubmitComment({
          authorName,
          authorTeamId,
          teamId: null,
          replyToId: replyTarget?.id || null,
          message: cleanMessage,
        });
      }
      onMessageChange("");
      onClearReply();
      onClearEdit();
    } catch (error) {
      setSubmitError(error.message || (editingComment ? "Unable to edit comment right now." : "Unable to post comment right now."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{
      position: "sticky",
      bottom: 0,
      zIndex: 3,
      paddingTop: 8,
      paddingBottom: isMobile ? 8 : 10,
      background: "linear-gradient(180deg, rgba(248,250,252,0) 0%, rgba(248,250,252,.92) 24%, rgba(248,250,252,1) 100%)",
    }}>
      <Card style={{ padding: isMobile ? 8 : 10, borderRadius: 18, boxShadow: "0 10px 30px rgba(15,23,42,.10)" }}>
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 6 }}>
        {editingComment && (
          <div style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: 8, background: "#f8fafc" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#0f172a" }}>
                Editing your comment
              </div>
              <button
                type="button"
                onClick={onClearEdit}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#64748b",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {replyTarget && (
          <div style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: 8, background: "#f8fafc" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#0f172a" }}>
                Replying to {replyTarget.authorName}
              </div>
              <button
                type="button"
                onClick={onClearReply}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#64748b",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Cancel
              </button>
            </div>
            <div style={{ marginTop: 4, color: "#64748b", fontSize: 12, lineHeight: 1.35 }}>{replyTarget.message}</div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={editingComment ? "Edit your message" : replyTarget ? `Reply to ${replyTarget.authorName}...` : "Send a message"}
            maxLength={400}
            rows={composerExpanded ? (isMobile ? 3 : 2) : 1}
            style={{
              width: "100%",
              border: `1px solid ${theme.borderStrong}`,
              borderRadius: 999,
              padding: composerExpanded ? "10px 13px" : "9px 13px",
              fontSize: 13,
              lineHeight: 1.4,
              background: theme.inputBg,
              color: theme.inputText,
              resize: "none",
              minHeight: composerExpanded ? 64 : 38,
              maxHeight: 100,
            }}
          />
          <button
            type="submit"
            disabled={isSubmitting || !canPost}
            style={{
              border: "none",
              background: isSubmitting || !canPost ? "#cbd5e1" : "#0f172a",
              color: "#fff",
              borderRadius: 999,
              padding: "0 14px",
              fontWeight: 800,
              cursor: isSubmitting || !canPost ? "default" : "pointer",
              minWidth: 64,
              height: 38,
              fontSize: 12,
            }}
          >
            {isSubmitting ? "..." : editingComment ? "Save" : "Send"}
          </button>
        </div>

        {composerExpanded && mentionSuggestions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {mentionSuggestions.map((entity) => {
              return (
                <button
                  key={entity.key}
                  type="button"
                  onClick={() => onMessageChange(applyMentionSuggestion(message, entity.label))}
                  style={{
                    border: `1px solid ${theme.borderStrong}`,
                    background: theme.surfaceAlt,
                    color: "#1d4ed8",
                    borderRadius: 999,
                    padding: "5px 9px",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  @{entity.label}
                </button>
              );
            })}
          </div>
        )}

        {composerExpanded && mentionSuggestions.length === 0 && quickMentionUsers.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>Mention:</div>
            {quickMentionUsers.map((entity) => (
              <button
                key={entity.key}
                type="button"
                onClick={() => onMessageChange(`${String(message || "").trimEnd()} @${entity.label} `.trimStart())}
                style={{
                  border: "1px solid #cbd5e1",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  borderRadius: 999,
                  padding: "5px 9px",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                @{entity.label}
              </button>
            ))}
          </div>
        )}

        {(submitError || commentsError) && (
          <div style={{ color: "#b91c1c", fontSize: 11 }}>
            {submitError || commentsError}
          </div>
        )}
        </form>
      </Card>
    </div>
  );
}

function ChatThread({
  comments,
  commentUserName,
  commentTeam,
  commentClientId,
  unreadCommentCount,
  unreadMentionCount,
  isMobile,
  onMarkCommentsRead,
  onReply,
  onEdit,
  onQuickReact,
}) {
  const theme = useTheme();
  const [activeCommentId, setActiveCommentId] = useState("");
  const pressTimerRef = useRef(null);
  const orderedComments = useMemo(
    () => comments.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [comments]
  );
  const mentionEntities = useMemo(() => buildMentionEntities(orderedComments, commentUserName), [orderedComments, commentUserName]);
  const commentsById = useMemo(
    () => Object.fromEntries(orderedComments.map((comment) => [comment.id, comment])),
    [orderedComments]
  );

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) window.clearTimeout(pressTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (activeCommentId && !orderedComments.some((comment) => comment.id === activeCommentId)) {
      setActiveCommentId("");
    }
  }, [orderedComments, activeCommentId]);

  function clearPressTimer() {
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }

  function scheduleOpenActions(commentId) {
    clearPressTimer();
    pressTimerRef.current = window.setTimeout(() => {
      setActiveCommentId(commentId);
    }, 380);
  }

  function renderComment(comment) {
    const authorColor = comment.authorTeamId ? teamColor(comment.authorTeamId) : null;
    const replyTarget = comment.replyToId ? commentsById[comment.replyToId] : null;
    const isMentioned = commentMentionsUser(comment.message, commentUserName);
    const isOwnComment = Boolean(commentClientId && comment.clientId && comment.clientId === commentClientId);
    const bubbleBackground = isOwnComment ? "#2563eb" : theme.surface;
    const bubbleBorder = isOwnComment ? "1px solid #1d4ed8" : `1px solid ${isMentioned ? "#60a5fa" : authorColor ? `${authorColor.accent}33` : theme.border}`;
    const bubbleTextColor = isOwnComment ? "#fff" : theme.text;
    const avatarBackground = isOwnComment ? "#1d4ed8" : (authorColor?.accent || "#0f172a");
    const showActions = activeCommentId === comment.id;

    return (
      <div key={comment.id} style={{ display: "flex", justifyContent: isOwnComment ? "flex-end" : "flex-start" }}>
        <div style={{ width: isMobile ? "95%" : "76%", display: "grid", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: isOwnComment ? "flex-end" : "flex-start" }}>
            <div style={{ display: "flex", flexDirection: isOwnComment ? "row-reverse" : "row", alignItems: "center", gap: 7 }}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: avatarBackground,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 900,
                flexShrink: 0,
              }}>
                {nameInitials(comment.authorName)}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexDirection: isOwnComment ? "row-reverse" : "row", flexWrap: "wrap" }}>
                <div style={{
                  background: isOwnComment ? "rgba(37,99,235,.14)" : (authorColor?.bg || theme.surfaceStrong),
                  color: isOwnComment ? "#1d4ed8" : (authorColor?.text || theme.text),
                  borderRadius: 999,
                  padding: "3px 8px",
                  fontWeight: 900,
                  fontSize: 11,
                  lineHeight: 1.1,
                }}>
                  {comment.authorName}
                </div>
                <div style={{ fontSize: 10, color: theme.subtleText, lineHeight: 1.15 }}>{formatCommentTime(comment.createdAt)}</div>
                {comment.updatedAt && <div style={{ fontSize: 10, color: theme.subtleText, lineHeight: 1.15 }}>(edited)</div>}
              </div>
            </div>
          </div>

          <div
            onClick={() => setActiveCommentId((current) => current === comment.id ? "" : comment.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setActiveCommentId(comment.id);
            }}
            onPointerDown={() => scheduleOpenActions(comment.id)}
            onPointerUp={clearPressTimer}
            onPointerLeave={clearPressTimer}
            onPointerCancel={clearPressTimer}
            style={{
              background: bubbleBackground,
              border: bubbleBorder,
              borderLeft: isOwnComment ? bubbleBorder : `3px solid ${isMentioned ? "#2563eb" : authorColor?.accent || "#cbd5e1"}`,
              borderRadius: isOwnComment ? "16px 16px 6px 16px" : "16px 16px 16px 6px",
              padding: isMobile ? "8px 10px" : "9px 11px",
              boxShadow: isMentioned ? "0 0 0 3px rgba(96,165,250,.15)" : "none",
              cursor: "pointer",
            }}
          >
            {replyTarget && <CommentReplySnippet comment={replyTarget} isMobile={isMobile} ownComment={isOwnComment} />}
            {isMentioned && !isOwnComment && (
              <div style={{ marginBottom: 5 }}>
                <Badge color="#dbeafe" textColor="#1d4ed8">You were tagged</Badge>
              </div>
            )}
            <div style={{ color: bubbleTextColor, fontSize: 12, lineHeight: 1.35 }}>
              {renderCommentMessage(comment.message, mentionEntities)}
            </div>
          </div>

          {showActions && (
            <div style={{ display: "flex", justifyContent: isOwnComment ? "flex-end" : "flex-start", gap: 5, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => onReply(comment)}
                style={{
                  border: `1px solid ${theme.borderStrong}`,
                  background: theme.surface,
                  color: theme.text,
                  borderRadius: 999,
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Reply
              </button>
              {isOwnComment && (
                <button
                  type="button"
                  onClick={() => onEdit(comment)}
                  style={{
                    border: `1px solid ${theme.borderStrong}`,
                    background: theme.surface,
                    color: theme.text,
                    borderRadius: 999,
                    padding: "5px 10px",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Edit
                </button>
              )}
              {["👍", "😂", "🔥"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onQuickReact(comment, emoji)}
                  style={{
                    border: `1px solid ${theme.borderStrong}`,
                    background: theme.surface,
                    color: theme.text,
                    borderRadius: 999,
                    padding: "5px 10px",
                    fontSize: 14,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card style={{ padding: isMobile ? 10 : 12 }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: isMobile ? "flex-start" : "center",
        flexDirection: isMobile ? "column" : "row",
        gap: 10,
        marginBottom: 10,
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, fontSize: isMobile ? 16 : 17 }}>Trash Talk</div>
            {unreadMentionCount > 0 && <Badge color="#dbeafe" textColor="#1d4ed8">{unreadMentionCount} tag{unreadMentionCount === 1 ? "" : "s"}</Badge>}
            {unreadCommentCount > 0 && <Badge color="#fee2e2" textColor="#b91c1c">{unreadCommentCount} new</Badge>}
          </div>
        </div>
        <button
          onClick={onMarkCommentsRead}
          style={{
            border: `1px solid ${theme.borderStrong}`,
            background: theme.surface,
            color: theme.text,
            borderRadius: 999,
            padding: "8px 12px",
            fontWeight: 800,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Mark read
        </button>
      </div>

      <div style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: isMobile ? 8 : 10,
        background: theme.surfaceAlt,
        display: "grid",
        gap: 10,
        maxHeight: isMobile ? "none" : "72vh",
        overflowY: isMobile ? "visible" : "auto",
      }}>
        {orderedComments.length > 0 ? orderedComments.map((comment) => renderComment(comment)) : (
          <div style={{ color: theme.subtleText, textAlign: "center", padding: "20px 12px", fontSize: 13 }}>
            No comments yet.
          </div>
        )}
      </div>
    </Card>
  );
}

function RecentCommentsPreview({ comments, commentUserName, isMobile, onOpenComments }) {
  const theme = useTheme();
  const recentComments = useMemo(
    () => comments
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 2),
    [comments]
  );
  const mentionEntities = useMemo(() => buildMentionEntities(comments, commentUserName), [comments, commentUserName]);

  return (
    <Card style={{ padding: isMobile ? 12 : 14 }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        marginBottom: 10,
      }}>
        <div style={{ fontWeight: 900, fontSize: isMobile ? 15 : 16 }}>Latest Trash Talk</div>
        <button
          onClick={onOpenComments}
          style={{
            border: `1px solid ${theme.borderStrong}`,
            background: theme.surface,
            color: theme.text,
            borderRadius: 999,
            padding: "7px 11px",
            fontWeight: 800,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Open
        </button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {recentComments.length > 0 ? recentComments.map((comment) => {
          const authorColor = comment.authorTeamId ? teamColor(comment.authorTeamId) : null;
          return (
            <div key={comment.id} style={{
              background: theme.surfaceAlt,
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
              padding: isMobile ? "7px 9px" : "8px 10px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{
                  background: authorColor?.bg || theme.surfaceStrong,
                  color: authorColor?.text || theme.text,
                  borderRadius: 999,
                  padding: "3px 8px",
                  fontWeight: 900,
                  fontSize: 11,
                  lineHeight: 1.1,
                }}>
                  {comment.authorName}
                </div>
                <div style={{ fontSize: 9.5, color: theme.subtleText }}>{formatCommentTime(comment.createdAt)}</div>
              </div>
              <div style={{ marginTop: 5, color: theme.text, fontSize: 11.5, lineHeight: 1.28 }}>{renderCommentMessage(comment.message, mentionEntities)}</div>
            </div>
          );
        }) : (
          <div style={{ color: theme.subtleText, textAlign: "center", padding: "12px 10px", fontSize: 12 }}>
            No comments yet.
          </div>
        )}
      </div>
    </Card>
  );
}

function NotificationCenter({ notifications, unreadCount, isMobile, onMarkAllRead }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onWindowClick = () => setOpen(false);
    window.addEventListener("click", onWindowClick);
    return () => window.removeEventListener("click", onWindowClick);
  }, [open]);

  return (
    <div style={{ position: "relative" }} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          border: "1px solid #334155",
          background: "#111827",
          color: "#fff",
          borderRadius: 999,
          padding: "7px 12px",
          fontSize: 12,
          fontWeight: 800,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>Alerts</span>
        {unreadCount > 0 && (
          <span style={{ background: "#f97316", color: "#fff", borderRadius: 999, minWidth: 18, height: 18, display: "grid", placeItems: "center", fontSize: 10, padding: "0 5px" }}>
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: isMobile ? "fixed" : "absolute",
          top: isMobile ? 70 : "calc(100% + 8px)",
          right: isMobile ? 12 : 0,
          left: isMobile ? 12 : "auto",
          width: isMobile ? "auto" : 380,
          maxHeight: "70vh",
          overflowY: "auto",
          zIndex: 40,
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 18,
          boxShadow: theme.shadow,
          padding: 10,
          display: "grid",
          gap: 8,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "4px 4px 8px" }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: theme.text }}>Notifications</div>
              <div style={{ color: theme.muted, fontSize: 11 }}>League chatter, finals, lead swaps, and recaps.</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={onMarkAllRead}
                style={{
                  border: `1px solid ${theme.borderStrong}`,
                  background: theme.surface,
                  color: theme.text,
                  borderRadius: 999,
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Mark all read
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close alerts"
                style={{
                  border: `1px solid ${theme.borderStrong}`,
                  background: theme.surface,
                  color: theme.text,
                  borderRadius: 999,
                  width: 30,
                  height: 30,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                  fontWeight: 900,
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          </div>

          {notifications.length > 0 ? notifications.map((notification) => (
            <div
              key={notification.id}
              style={{
                border: `1px solid ${notification.read ? theme.border : "#fdba74"}`,
                background: notification.read ? theme.surface : (theme.pageBg === "#000000" ? "#1c1208" : "#fff7ed"),
                borderRadius: 14,
                padding: "10px 12px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: theme.text }}>{notification.title}</div>
                <div style={{ fontSize: 10, color: theme.subtleText, whiteSpace: "nowrap" }}>{formatCommentTime(notification.createdAt)}</div>
              </div>
              <div style={{ color: theme.muted, fontSize: 12, lineHeight: 1.45 }}>{notification.body}</div>
              {Array.isArray(notification.sections) && notification.sections.length > 0 && (
                <div style={{ display: "grid", gap: 6, marginTop: 2 }}>
                  {notification.sections.map((section) => (
                    <div key={section.title} style={{ background: theme.surfaceAlt, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "8px 9px" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: theme.muted, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>
                        {section.title}
                      </div>
                      <div style={{ display: "grid", gap: 3 }}>
                        {section.lines.map((line) => (
                          <div key={line} style={{ fontSize: 11, color: theme.text, lineHeight: 1.35 }}>{line}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )) : (
            <div style={{ color: theme.subtleText, textAlign: "center", padding: "18px 10px", fontSize: 12 }}>
              No notifications yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function Tabs({ value, onChange, isMobile }) {
  const theme = useTheme();
  const tabs = ["Standings", "Live Bracket", "Trash Talk", "Ownership", "Analysis", "Settings"];
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [value]);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        style={{
          border: `1px solid ${theme.headerBorder || theme.borderStrong}`,
          background: theme.headerSurface || theme.buttonBg,
          color: "#fff",
          borderRadius: 999,
          width: 40,
          height: 40,
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
        }}
        aria-label="Open navigation"
      >
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ width: 16, height: 2, background: "#fff", borderRadius: 999, display: "block" }} />
          <span style={{ width: 16, height: 2, background: "#fff", borderRadius: 999, display: "block" }} />
          <span style={{ width: 16, height: 2, background: "#fff", borderRadius: 999, display: "block" }} />
        </div>
      </button>
      {menuOpen && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          minWidth: isMobile ? 200 : 220,
          zIndex: 20,
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 16,
          boxShadow: theme.shadow,
          padding: 8,
          display: "grid",
          gap: 6,
        }}>
          {tabs.filter((tab) => tab !== "Standings").map((tab) => {
            const active = value === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onChange(tab)}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "none",
                  background: active ? theme.navActiveBg : theme.surfaceAlt,
                  color: active ? theme.navActiveText : theme.text,
                  fontWeight: 700,
                  fontSize: 14,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Standings ────────────────────────────────────────────────────────────────
const RANK_MEDALS = ["🥇", "🥈", "🥉"];

function StandingsView({
  games,
  isMobile,
  isTablet,
  comments,
  commentUserName,
  onOpenComments,
  onOpenOwnership,
}) {
  const theme = useTheme();
  const standings = useMemo(() => standingsFromGames(games), [games]);
  const teamMaxRemaining = useMemo(() => ownerRemainingCeilings(games), [games]);
  const maxPts = standings[0]?.points || 1;
  const averageSeedForRemaining = (team) => {
    const remainingSeeds = team.schools
      .filter((school) => isSchoolAlive(school.school, games))
      .map((school) => Number(school.seed))
      .filter((seed) => Number.isFinite(seed));
    if (!remainingSeeds.length) return "—";
    const average = remainingSeeds.reduce((sum, seed) => sum + seed, 0) / remainingSeeds.length;
    return Number.isInteger(average) ? String(average) : average.toFixed(1);
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <RecentCommentsPreview comments={comments} commentUserName={commentUserName} isMobile={isMobile} onOpenComments={onOpenComments} />

      <Card>
        {isMobile ? (
          <div style={{ display: "grid", gap: 10 }}>
            {standings.map((team, i) => {
              const c = teamColor(team.id);
              const barW = maxPts > 0 ? Math.round((team.points / maxPts) * 100) : 0;
              const teamsBought = team.schools.length;
              const teamsRemaining = team.schools.filter((school) => isSchoolAlive(school.school, games)).length;
              const pointsRemaining = teamMaxRemaining[team.id] ?? 0;
              const averageSeedRemaining = averageSeedForRemaining(team);
              return (
                <div
                  key={team.id}
                  onClick={() => onOpenOwnership(team.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenOwnership(team.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    border: `1px solid ${c.accent}33`,
                    borderRadius: 14,
                    padding: 11,
                    background: c.bg,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{RANK_MEDALS[i] || <span style={{ color: theme.muted, fontWeight: 800 }}>#{i + 1}</span>}</div>
                      <div style={{ fontWeight: 900, fontSize: 15, color: c.text, lineHeight: 1.15 }}>{team.name}</div>
                      <div style={{ color: c.accent, fontSize: 11, lineHeight: 1.2, marginTop: 2 }}>{team.members.join(" · ")}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 24, color: c.accent, lineHeight: 1 }}>{team.points}</div>
                      <div style={{ color: c.text, fontSize: 11, marginTop: 3 }}>{team.wins} wins</div>
                    </div>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: theme.surfaceStrong, overflow: "hidden", marginTop: 9 }}>
                    <div style={{ height: 6, borderRadius: 999, width: `${barW}%`, background: c.accent, transition: "width .4s" }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "6px 10px", marginTop: 9, fontSize: 11.5, color: c.text }}>
                    <div><strong>Bought:</strong> {teamsBought}</div>
                    <div><strong>Remain:</strong> <span style={{ color: teamsRemaining === 0 ? "#ef4444" : "#16a34a" }}>{teamsRemaining}</span></div>
                    <div><strong>Pts Left:</strong> +{pointsRemaining}</div>
                    <div><strong>Avg Seed:</strong> {averageSeedRemaining}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ color: theme.subtleText, textTransform: "uppercase", fontSize: 11, letterSpacing: ".06em" }}>
                  <th style={{ padding: "0 0 12px", textAlign: "left" }}>Rank</th>
                  <th style={{ padding: "0 0 12px", textAlign: "left" }}>Team</th>
                  <th style={{ padding: "0 0 12px", textAlign: "center" }}>Pts</th>
                  <th style={{ padding: "0 0 12px", textAlign: "center" }}>Wins</th>
                  <th style={{ padding: "0 0 12px", textAlign: "left", minWidth: 140 }}>Progress</th>
                  <th style={{ padding: "0 0 12px", textAlign: "right" }}>Bought</th>
                  <th style={{ padding: "0 0 12px", textAlign: "right" }}>Remaining</th>
                  <th style={{ padding: "0 0 12px", textAlign: "right" }}>Pts Left</th>
                  <th style={{ padding: "0 0 12px", textAlign: "right" }}>Avg Seed</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((team, i) => {
                  const c = teamColor(team.id);
                  const barW = maxPts > 0 ? Math.round((team.points / maxPts) * 100) : 0;
                  const teamsBought = team.schools.length;
                  const teamsRemaining = team.schools.filter((school) => isSchoolAlive(school.school, games)).length;
                  const pointsRemaining = teamMaxRemaining[team.id] ?? 0;
                  const averageSeedRemaining = averageSeedForRemaining(team);
                  return (
                    <tr
                      key={team.id}
                      onClick={() => onOpenOwnership(team.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenOwnership(team.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      style={{
                        borderTop: `1px solid ${theme.border}`,
                        cursor: "pointer",
                        transition: "background .15s",
                      }}
                    >
                      <td style={{ padding: "12px 8px 12px 0", fontSize: 20 }}>
                        {RANK_MEDALS[i] || <span style={{ color: theme.subtleText, fontWeight: 700 }}>{i + 1}</span>}
                      </td>
                      <td style={{ padding: "12px 16px 12px 0" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 9, height: 9, borderRadius: "50%", background: c.accent, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 15, color: theme.text }}>{team.name}</div>
                            <div style={{ color: theme.subtleText, fontSize: 11 }}>{team.members.join(" · ")}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: "center", fontWeight: 900, fontSize: 22, color: c.accent }}>{team.points}</td>
                      <td style={{ textAlign: "center", color: theme.muted, fontWeight: 600 }}>{team.wins}</td>
                      <td style={{ paddingRight: 20 }}>
                        <div style={{ height: 6, borderRadius: 999, background: theme.surfaceStrong, overflow: "hidden" }}>
                          <div style={{ height: 6, borderRadius: 999, width: `${barW}%`, background: c.accent, transition: "width .4s" }} />
                        </div>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{teamsBought}</td>
                      <td style={{ textAlign: "right", color: teamsRemaining === 0 ? "#ef4444" : "#22c55e", fontWeight: 700 }}>{teamsRemaining}</td>
                      <td style={{ textAlign: "right", color: theme.muted, fontWeight: 700 }}>+{pointsRemaining}</td>
                      <td style={{ textAlign: "right", fontWeight: 800, color: averageSeedRemaining === "—" ? theme.subtleText : theme.text }}>
                        {averageSeedRemaining}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Live Bracket ─────────────────────────────────────────────────────────────
function LiveBracketView({ games, source, updatedAt, error, isMobile, isTablet }) {
  const theme = useTheme();
  const [statusFilter, setStatusFilter] = useState("Live");
  const statuses = ["Live", "Upcoming", "Final", "All"];

  const filtered = games.filter((g) =>
    statusFilter === "All" || g.status === statusFilter
  );
  const currentSlateGames = games.filter((game) => game.status === "Live" || game.status === "Upcoming");
  const roundSourceGames = currentSlateGames.length > 0 ? currentSlateGames : filtered;
  const shownRounds = [...new Set(roundSourceGames.map((game) => roundLabels[game.round] || game.round))];
  const roundSummary = shownRounds.length === 1
    ? `Round: ${shownRounds[0]}`
    : shownRounds.length > 1
      ? `Rounds: ${shownRounds.join(" · ")}`
      : "";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, flexDirection: isMobile ? "column" : "row" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {statuses.map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: "7px 14px", borderRadius: 10,
              border: `1px solid ${s === "Live" ? "#fecaca" : s === "Final" ? "#bbf7d0" : theme.border}`,
              background: statusFilter === s
                ? (s === "Live" ? "#ef4444" : s === "Final" ? "#22c55e" : "#0f172a")
                : theme.surface,
              color: statusFilter === s ? "#fff" : theme.muted,
              fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}>{s}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: theme.subtleText, fontSize: 12 }}>
          {roundSummary && (
            <Badge color={theme.surfaceStrong} textColor={theme.muted}>{roundSummary}</Badge>
          )}
          <span>{filtered.length} games shown</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill,minmax(290px,1fr))", gap: 12 }}>
        {filtered.map((game) => {
          const isDarkTheme = theme.pageBg === "#000000";
          const winner = getWinner(game);
          const isLive = game.status === "Live";
          const isFinal = game.status === "Final";
          const pts = roundPoints(game.round);
          const scheduledTip = formatGameDateTime(game.date);
          const watchLabel = Array.isArray(game.broadcasts) && game.broadcasts.length > 0 ? game.broadcasts.join(" · ") : "";

          const homeOwnerId = lookupOwner(game.home);
          const awayOwnerId = lookupOwner(game.away);
          const homeC = homeOwnerId ? teamColor(homeOwnerId) : null;
          const awayC = awayOwnerId ? teamColor(awayOwnerId) : null;
          const pointsLabel = isFinal
            ? (winner && (homeOwnerId || awayOwnerId) ? `+${pts} pts awarded` : `${pts} pts unowned`)
            : `${pts} pts at stake`;

          return (
            <Card key={game.id} style={{
              outline: isLive ? "2px solid #ef4444" : "none",
              outlineOffset: 2,
              padding: isMobile ? 10 : 12,
              background: isDarkTheme ? "#050505" : theme.surface,
            }}>
              <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Badge color={theme.surfaceAlt} textColor={theme.muted}>{game.region || "—"}</Badge>
                  </div>
                  <div style={{
                    background: isFinal ? "#f0fdf4" : isLive ? "#fef2f2" : theme.surfaceAlt,
                    color: isFinal ? "#16a34a" : isLive ? "#ef4444" : "#64748b",
                    borderRadius: 999, padding: "3px 8px", fontWeight: 800, fontSize: 11,
                  }}>
                    {pointsLabel}
                  </div>
                </div>
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  padding: "6px 8px",
                  borderRadius: 10,
                  background: theme.surfaceAlt,
                  border: `1px solid ${theme.border}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {isLive && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#ef4444", fontWeight: 700, fontSize: 11 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse 1.2s infinite" }} />
                        {game.clock || "LIVE"}
                      </span>
                    )}
                    {isFinal && <Badge color="#dcfce7" textColor="#16a34a">✓ Final</Badge>}
                    {!isLive && !isFinal && <Badge color={theme.surfaceStrong} textColor={theme.subtleText}>Upcoming</Badge>}
                  </div>
                  <div style={{ display: "grid", gap: 1, justifyItems: "end" }}>
                    {scheduledTip && (
                      <div style={{ fontSize: 10, color: "#0f766e", fontWeight: 700 }}>
                        {scheduledTip}
                      </div>
                    )}
                    {watchLabel && (
                      <div style={{ fontSize: 10, color: theme.muted }}>
                        <span style={{ fontWeight: 700 }}>Watch:</span> {watchLabel}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {[
                { n: game.home, display: normalizeName(game.home), s: game.homeScore, seed: game.homeSeed, ownerId: homeOwnerId, c: homeC },
                { n: game.away, display: normalizeName(game.away), s: game.awayScore, seed: game.awaySeed, ownerId: awayOwnerId, c: awayC },
              ].map((team) => {
                const winnerNorm = winner ? normalizeName(winner.school).toLowerCase() : "";
                const isW = winnerNorm === team.display.toLowerCase();
                const rowBg = isW && (isFinal || isLive)
                  ? (team.c?.bg || "#f0fdf4")
                  : (isDarkTheme ? "#e5e7eb" : "#f8fafc");
                const rowBorder = isW
                  ? `1.5px solid ${team.c?.accent || "#22c55e"}`
                  : `1px solid ${team.c?.accent ? `${team.c.accent}44` : theme.borderStrong}`;
                const rowTextColor = isW
                  ? (team.c?.text || "#0f172a")
                  : (isDarkTheme ? "#0f172a" : theme.text);
                const rowSubtleColor = isW
                  ? (team.c?.accent || "#475569")
                  : (isDarkTheme ? "#475569" : theme.subtleText);
                return (
                  <div key={team.n} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: rowBg, border: rowBorder,
                    borderRadius: 11, padding: isMobile ? "7px 9px" : "8px 10px", marginBottom: 6,
                    gap: 8,
                    color: rowTextColor,
                    boxShadow: isW ? "none" : "inset 0 0 0 1px rgba(255,255,255,.08)",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: isMobile ? 13 : 14, display: "flex", alignItems: "center", gap: 5, minWidth: 0, color: rowTextColor, lineHeight: 1.1 }}>
                        <span style={{ fontSize: 10, color: rowSubtleColor, fontWeight: 700, flexShrink: 0 }}>#{team.seed}</span>
                        {team.display}
                        {isW && isFinal && <span style={{ fontSize: 11, color: team.c?.accent || "#16a34a", fontWeight: 700 }}>✓</span>}
                      </div>
                      <div style={{ marginTop: 3 }}>
                        <span style={{
                          display: "inline-flex",
                          alignItems: "center",
                          background: isW ? "rgba(255,255,255,.45)" : (isDarkTheme ? "#f8fafc" : theme.surface),
                          color: team.ownerId ? (isW ? team.c?.text || "#0f172a" : team.c?.accent || "#334155") : rowSubtleColor,
                          border: `1px solid ${isW ? `${team.c?.accent || "#22c55e"}33` : (isDarkTheme ? "#cbd5e1" : theme.border)}`,
                          borderRadius: 999,
                          padding: "2px 6px",
                          fontSize: 9.5,
                          fontWeight: 800,
                          lineHeight: 1.1,
                        }}>
                          {team.ownerId ? ownerName(team.ownerId) : "Unowned"}
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
                      <div style={{ fontSize: isMobile ? 20 : 22, fontWeight: 900, color: isW ? (team.c?.text || "#0f172a") : theme.text, lineHeight: 1 }}>
                        {team.s ?? (isFinal ? "—" : "")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", color: theme.subtleText, padding: 60, fontSize: 15 }}>
            No games match these filters.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Ownership ────────────────────────────────────────────────────────────────
function OwnershipView({ games, isMobile, filter, onFilterChange }) {
  const theme = useTheme();
  const [search, setSearch] = useState("");

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 220px", gap: 12 }}>
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  Search school, region, or seed…"
          style={{ padding: "12px 16px", borderRadius: 12, border: `1px solid ${theme.border}`, fontSize: 14, outline: "none", background: theme.inputBg, color: theme.inputText }}
        />
        <select value={filter} onChange={(e) => onFilterChange(e.target.value)}
          style={{ padding: "12px 16px", borderRadius: 12, border: `1px solid ${theme.border}`, fontSize: 14, background: theme.inputBg, color: theme.inputText }}>
          <option value="all">All teams</option>
          {fantasyTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <OwnershipBoard games={games} filter={filter} search={search} isMobile={isMobile} />
    </div>
  );
}

// ─── Analysis ─────────────────────────────────────────────────────────────────
function AnalysisView({ games, isMobile, isTablet }) {
  const theme = useTheme();
  // Use lookupOwner (ESPN-normalized) instead of raw map — fixes empty owner columns
  const standings = useMemo(() => standingsFromGames(games), [games]);
  const totalSpent = ownedTeams.reduce((sum, team) => sum + team.price, 0);
  const totalPts = standings.reduce((sum, team) => sum + team.points, 0);

  function renderOwnerCell(ownerId, emptyLabel = "—") {
    if (!ownerId) {
      return <span style={{ color: theme.subtleText }}>{emptyLabel}</span>;
    }
    const colors = teamColor(ownerId);
    return isMobile
      ? <span style={{ color: colors.accent, fontWeight: 700, fontSize: 11, lineHeight: 1.2 }}>{ownerName(ownerId)}</span>
      : <Badge color={colors.bg} textColor={colors.accent}>{ownerName(ownerId)}</Badge>;
  }

  // Live games with point implications
  const liveRows = games.filter(g => g.status === "Live").map((g) => {
    const homeOwner = lookupOwner(g.home);
    const awayOwner = lookupOwner(g.away);
    const leading = (g.homeScore != null && g.awayScore != null && Number(g.homeScore) >= Number(g.awayScore)) ? g.home : g.away;
    const trailing = leading === g.home ? g.away : g.home;
    const leadOwner = lookupOwner(leading);
    const pts = roundPoints(g.round);
    return { game: g, homeOwner, awayOwner, leading, trailing, leadOwner, pts };
  });

  // Upcoming potential swings (non-final, non-live)
  const upcomingRows = games.filter(g => g.status !== "Final" && g.status !== "Live").map(g => ({
    game: g,
    homeOwner: lookupOwner(g.home),
    awayOwner: lookupOwner(g.away),
    pts: roundPoints(g.round),
  }));

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card style={{ padding: isMobile ? 9 : 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Analysis Snapshot</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 11 : 12, minWidth: isMobile ? 440 : "auto" }}>
            <thead>
              <tr style={{ color: theme.subtleText, textTransform: "uppercase", fontSize: 10, letterSpacing: ".05em" }}>
                <th style={{ textAlign: "left", paddingBottom: 7 }}>Metric</th>
                <th style={{ textAlign: "left", paddingBottom: 7 }}>Value</th>
                <th style={{ textAlign: "left", paddingBottom: 7 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: "Teams",
                  value: fantasyTeams.length,
                  detail: "6-group format",
                },
                {
                  label: "Schools Owned",
                  value: ownedTeams.length,
                  detail: "Across all rosters",
                },
                {
                  label: "Total Auction $",
                  value: `$${totalSpent}`,
                  detail: "Sum paid at auction",
                },
                {
                  label: "Points Scored",
                  value: totalPts,
                  detail: "From completed games",
                },
                {
                  label: "Live Games",
                  value: liveRows.length,
                  detail: liveRows.length ? `${liveRows.reduce((sum, row) => sum + row.pts, 0)} pts in motion` : "None right now",
                },
                {
                  label: "Leader",
                  value: standings[0]?.name || "—",
                  detail: `${standings[0]?.points || 0} pts`,
                },
                {
                  label: "Gap to 1st",
                  value: standings.length > 1 ? `${standings[0].points - standings[1].points} pts` : "—",
                  detail: standings[1] ? `${standings[1].name} is 2nd` : "",
                },
                {
                  label: "Upcoming Pts",
                  value: upcomingRows.reduce((sum, row) => sum + row.pts, 0),
                  detail: `${upcomingRows.length} games remaining`,
                },
              ].map((row) => (
                <tr key={row.label} style={{ borderTop: `1px solid ${theme.borderStrong}` }}>
                  <td style={{ padding: isMobile ? "7px 0" : "8px 0", fontWeight: 700, color: theme.muted }}>{row.label}</td>
                  <td style={{ padding: isMobile ? "7px 10px 7px 0" : "8px 12px 8px 0", fontWeight: 900, color: theme.text }}>{row.value}</td>
                  <td style={{ padding: isMobile ? "7px 0" : "8px 0", color: theme.muted }}>{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* live games */}
      {liveRows.length > 0 && (
        <Card style={{ padding: isMobile ? 9 : 16 }}>
          <div style={{ fontWeight: 800, fontSize: isMobile ? 15 : 17, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
            Live — Points in Motion
          </div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 12 : 13, minWidth: isMobile ? 540 : "auto" }}>
          <thead>
            <tr style={{ color: theme.subtleText, textTransform: "uppercase", fontSize: 10 }}>
              <th style={{ textAlign: "left", paddingBottom: 8 }}>Matchup</th>
              <th style={{ textAlign: "left", paddingBottom: 8 }}>Score</th>
              <th style={{ textAlign: "left", paddingBottom: 8 }}>Leader</th>
              <th style={{ textAlign: "left", paddingBottom: 8 }}>Other</th>
              <th style={{ textAlign: "center", paddingBottom: 8 }}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {liveRows.map(({ game, leading, trailing, leadOwner, pts }) => {
              const trailingOwner = lookupOwner(trailing);
              return (
                <tr key={game.id} style={{ borderTop: `1px solid ${theme.borderStrong}` }}>
                  <td style={{ padding: isMobile ? "9px 0" : "12px 0", fontWeight: 700, lineHeight: 1.25, color: theme.text }}>{normalizeName(game.home)} vs {normalizeName(game.away)}</td>
                  <td style={{ color: "#ef4444", fontWeight: 700, whiteSpace: "nowrap" }}>{game.homeScore}–{game.awayScore} {game.clock}</td>
                  <td>{renderOwnerCell(leadOwner, "Unowned")}</td>
                  <td>{renderOwnerCell(trailingOwner, "Unowned")}</td>
                  <td style={{ textAlign: "center", fontWeight: 900, color: "#ef4444" }}>+{pts}</td>
                </tr>
              );
            })}
          </tbody>
          </table>
          </div>
        </Card>
      )}

      {/* projected standings after live games resolve */}
      <Card style={{ padding: isMobile ? 9 : 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Projected Standings (if current leaders hold)</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 11 : 12, minWidth: isMobile ? 430 : "auto" }}>
            <thead>
              <tr style={{ color: theme.subtleText, textTransform: "uppercase", fontSize: 10, letterSpacing: ".05em" }}>
                <th style={{ textAlign: "left", paddingBottom: 7 }}>Rank</th>
                <th style={{ textAlign: "left", paddingBottom: 7 }}>Team</th>
                <th style={{ textAlign: "right", paddingBottom: 7 }}>Now</th>
                <th style={{ textAlign: "right", paddingBottom: 7 }}>Live</th>
                <th style={{ textAlign: "right", paddingBottom: 7 }}>Proj</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((team, i) => {
                const c = teamColor(team.id);
                const liveBonus = liveRows
                  .filter((r) => r.leadOwner === team.id)
                  .reduce((s, r) => s + r.pts, 0);
                return (
                  <tr key={team.id} style={{ borderTop: `1px solid ${theme.borderStrong}` }}>
                    <td style={{ padding: isMobile ? "7px 6px 7px 0" : "8px 8px 8px 0", fontWeight: 800, color: theme.muted, whiteSpace: "nowrap" }}>
                      {RANK_MEDALS[i] || `#${i + 1}`}
                    </td>
                    <td style={{ padding: isMobile ? "7px 8px 7px 0" : "8px 12px 8px 0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.accent, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontWeight: 800, color: c.text, lineHeight: 1.2 }}>{team.name}</div>
                          <div style={{ color: theme.subtleText, fontSize: 10, lineHeight: 1.2 }}>{team.wins} wins confirmed</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: isMobile ? "7px 0" : "8px 0", textAlign: "right", fontWeight: 700, color: theme.muted }}>{team.points}</td>
                    <td style={{ padding: isMobile ? "7px 0 7px 10px" : "8px 0 8px 12px", textAlign: "right", fontWeight: 800, color: liveBonus > 0 ? "#16a34a" : theme.subtleText }}>
                      {liveBonus > 0 ? `+${liveBonus}` : "—"}
                    </td>
                    <td style={{ padding: isMobile ? "7px 0 7px 10px" : "8px 0 8px 12px", textAlign: "right", fontWeight: 900, color: c.accent }}>{team.points + liveBonus}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* upcoming games table */}
      {upcomingRows.length > 0 && (
        <Card style={{ padding: isMobile ? 9 : 16 }}>
          <div style={{ fontWeight: 800, fontSize: isMobile ? 15 : 17, marginBottom: 10 }}>Upcoming Games</div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: isMobile ? 12 : 13, minWidth: isMobile ? 540 : "auto" }}>
            <thead>
              <tr style={{ color: theme.subtleText, textTransform: "uppercase", fontSize: 10 }}>
                <th style={{ textAlign: "left", paddingBottom: 8 }}>Matchup</th>
                <th style={{ textAlign: "left", paddingBottom: 8 }}>Region</th>
                <th style={{ textAlign: "left", paddingBottom: 8 }}>Home</th>
                <th style={{ textAlign: "left", paddingBottom: 8 }}>Away</th>
                <th style={{ textAlign: "center", paddingBottom: 8 }}>Pts</th>
              </tr>
            </thead>
            <tbody>
              {upcomingRows.map(({ game, homeOwner, awayOwner, pts }) => (
                <tr key={game.id} style={{ borderTop: `1px solid ${theme.borderStrong}` }}>
                  <td style={{ padding: isMobile ? "9px 0" : "10px 0" }}>
                    <div style={{ fontWeight: 700, color: theme.text }}>{normalizeName(game.home)} vs {normalizeName(game.away)}</div>
                    <div style={{ fontSize: 10, color: theme.subtleText, marginTop: 2 }}>{roundLabels[game.round] || game.round}</div>
                  </td>
                  <td style={{ color: theme.muted }}>{game.region}</td>
                  <td>{renderOwnerCell(homeOwner)}</td>
                  <td>{renderOwnerCell(awayOwner)}</td>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>{pts}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Auction Intel (Solomon / Brenden only) ───────────────────────────────────
const TIER_COLORS = { A: "#fef9c3", B: "#dcfce7", C: "#dbeafe", D: "#f3e8ff", E: "#ffedd5", F: "#fee2e2" };
const TIER_TEXT = { A: "#713f12", B: "#14532d", C: "#1e3a8a", D: "#3b0764", E: "#7c2d12", F: "#7f1d1d" };

function AuctionIntelView({ isMobile, isTablet }) {
  const theme = useTheme();
  const scoringExamples = [
    { label: "Wins First Four (FF)", wins: "play-in game", total: 3 },
    { label: "Wins 1 game (R64)", wins: "1st round", total: 3 },
    { label: "Wins 2 games (R32)", wins: "1st + 2nd", total: 6 },
    { label: "Wins 3 games (S16)", wins: "1st + 2nd + 3rd", total: 10 },
    { label: "Wins 4 games (E8)", wins: "+ 4th round", total: 14 },
    { label: "Wins semi-final (F4)", wins: "+ semi", total: 19 },
    { label: "Champion", wins: "+ final", total: 25 },
  ];
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: responsiveColumns({ isMobile, isTablet, desktop: "1fr 1fr" }), gap: 16 }}>
        {/* tier table */}
        <Card>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 16 }}>Seed Tier Pricing Guide</div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? 680 : "auto" }}>
            <thead>
              <tr style={{ color: theme.subtleText, fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ textAlign: "left", paddingBottom: 10 }}>Tier</th>
                <th style={{ textAlign: "left", paddingBottom: 10 }}>Seeds</th>
                <th style={{ textAlign: "left", paddingBottom: 10 }}>Role</th>
                <th style={{ textAlign: "left", paddingBottom: 10 }}>Target Bid</th>
                <th style={{ textAlign: "center", paddingBottom: 10 }}>Max</th>
                <th style={{ textAlign: "center", paddingBottom: 10 }}>Exp. pts</th>
              </tr>
            </thead>
            <tbody>
              {auctionIntel.map((r) => (
                <tr key={r.tier} style={{ borderTop: `1px solid ${theme.borderStrong}` }}>
                  <td style={{ padding: "10px 8px 10px 0" }}>
                    <Badge color={TIER_COLORS[r.tier]} textColor={TIER_TEXT[r.tier]}>{r.tier}</Badge>
                  </td>
                  <td style={{ fontWeight: 700, color: theme.text }}>{r.seedRange}</td>
                  <td style={{ color: theme.muted }}>{r.role}</td>
                  <td style={{ color: theme.text, fontWeight: 600 }}>{r.target}</td>
                  <td style={{ textAlign: "center", color: "#ef4444", fontWeight: 700 }}>{r.max}</td>
                  <td style={{ textAlign: "center", color: "#16a34a", fontWeight: 700 }}>{r.expected}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>

        {/* scoring examples */}
        <Card>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 16 }}>Official Scoring Examples</div>
          <div style={{ display: "grid", gap: 10 }}>
            {scoringExamples.map((e) => (
              <div key={e.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: theme.surfaceAlt, border: `1px solid ${theme.borderStrong}`, borderRadius: 12, padding: "12px 16px" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: theme.text }}>{e.label}</div>
                  <div style={{ color: theme.subtleText, fontSize: 12 }}>{e.wins}</div>
                </div>
                <div style={{ fontWeight: 900, fontSize: 22, color: theme.text }}>{e.total}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, color: theme.subtleText, fontSize: 12, borderTop: `1px solid ${theme.borderStrong}`, paddingTop: 12 }}>
            Total points available across all tracked games since March 18: <strong>{TOTAL_TOURNAMENT_POINTS}</strong>
          </div>
        </Card>
      </div>

      {/* payout structure */}
      <Card>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 16 }}>Payout Structure — {NUM_GROUPS} Groups</div>
        <div style={{ display: "grid", gridTemplateColumns: responsiveColumns({ isMobile, isTablet, desktop: "repeat(3,1fr)" }), gap: 14 }}>
          {PAYOUTS.map((p) => (
            <div key={p.place} style={{ background: p.place === 1 ? "#fef9c3" : p.place === 2 ? "#f1f5f9" : "#fff7ed", borderRadius: 14, padding: 18, textAlign: "center", border: "1.5px solid #e2e8f0" }}>
              <div style={{ fontSize: 28 }}>{RANK_MEDALS[p.place - 1]}</div>
              <div style={{ fontWeight: 900, fontSize: 26, marginTop: 6 }}>${Math.round(TOTAL_POT * p.pct)}</div>
              <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>{(p.pct * 100).toFixed(1)}% of ${TOTAL_POT}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Private Team Notes (all other teams) ─────────────────────────────────────
function TeamNotesView({ team }) {
  const c = teamColor(team.id);
  const notes = team.privateNotes || [];
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card style={{ borderLeft: `4px solid ${c.accent}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ background: c.bg, borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🔒</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 20, color: c.text }}>{team.name} — Private Notes</div>
            <div style={{ color: "#94a3b8", fontSize: 13 }}>Only visible when signed in as this team</div>
          </div>
        </div>
      </Card>
      {notes.length === 0 ? (
        <Card>
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>No private notes yet</div>
            <div style={{ fontSize: 13 }}>Your team's private strategy notes will appear here.</div>
          </div>
        </Card>
      ) : (
        notes.map((note, i) => (
          <Card key={i} style={{ borderLeft: `3px solid ${c.accent}` }}>
            {note.title && <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8, color: c.text }}>{note.title}</div>}
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#334155" }}>{note.body}</div>
          </Card>
        ))
      )}
    </div>
  );
}

// ─── Private Gate (team selector + PIN) ───────────────────────────────────────
function PrivateGate({ onUnlock }) {
  const [selectedId, setSelectedId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  const handleUnlock = () => {
    const team = fantasyTeams.find(t => t.id === selectedId);
    if (!team) { setError("Please select your team."); return; }
    if (pin !== team.pin) { setError("Incorrect PIN. Try again."); setPin(""); return; }
    setError("");
    onUnlock(team);
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 40 }}>
      <Card style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 6 }}>Private Team Access</div>
        <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 24 }}>
          Select your team and enter your PIN to view private notes.
        </div>
        <div style={{ display: "grid", gap: 12, textAlign: "left" }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Your Team</label>
            <select
              value={selectedId}
              onChange={e => { setSelectedId(e.target.value); setError(""); setPin(""); }}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 14, background: "#f8fafc" }}
            >
              <option value="">— Select team —</option>
              {fantasyTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Team PIN</label>
            <input
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handleUnlock()}
              placeholder="4-digit PIN"
              maxLength={4}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${error ? "#ef4444" : "#e2e8f0"}`, fontSize: 14, background: "#f8fafc" }}
            />
          </div>
          {error && <div style={{ color: "#ef4444", fontSize: 13, fontWeight: 600 }}>{error}</div>}
          <button
            onClick={handleUnlock}
            style={{ padding: "12px", borderRadius: 12, border: "none", background: "#0f172a", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
          >
            Unlock →
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Private View Router ───────────────────────────────────────────────────────
function PrivateView({ activeTeam, onUnlock, isMobile, isTablet }) {
  if (!activeTeam) return <PrivateGate onUnlock={onUnlock} />;
  if (activeTeam.id === "solomon-brenden") return <AuctionIntelView isMobile={isMobile} isTablet={isTablet} />;
  return <TeamNotesView team={activeTeam} />;
}

function AccessSetupGate({ isMobile, onComplete }) {
  const theme = useTheme();
  const [roleType, setRoleType] = useState("member");
  const [selectedTeamId, setSelectedTeamId] = useState(fantasyTeams[0]?.id || "");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [accessPin, setAccessPin] = useState("");
  const [devicePin, setDevicePin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const teamOptions = fantasyTeams.map((team) => ({
    id: team.id,
    label: team.name,
    accounts: leagueMemberAccounts.filter((account) => account.teamId === team.id),
  }));
  const visibleAccounts = roleType === "admin"
    ? adminAccounts
    : (teamOptions.find((team) => team.id === selectedTeamId)?.accounts || []);

  useEffect(() => {
    setSelectedAccountId(visibleAccounts[0]?.id || "");
  }, [roleType, selectedTeamId]);

  async function handleContinue() {
    const account = accountById(selectedAccountId);
    const cleanPin = devicePin.trim();

    if (!account) {
      setError("Select your team and name first.");
      return;
    }
    if (!/^\d{4,8}$/.test(accessPin.trim())) {
      setError(`${roleType === "admin" ? "Admin" : "Team"} access code must be 4 to 8 digits.`);
      return;
    }
    if (!/^\d{4,8}$/.test(cleanPin)) {
      setError("Create a 4 to 8 digit PIN for this device.");
      return;
    }
    if (cleanPin !== confirmPin.trim()) {
      setError("Your new PIN confirmation does not match.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await onComplete({
        accountId: account.id,
        accessPin: accessPin.trim(),
        devicePin: cleanPin,
      });
    } catch (submitError) {
      setError(submitError.message || "Unable to enter the app right now.");
      setAccessPin("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 16 : 28 }}>
      <Card style={{ width: "100%", maxWidth: 520, padding: isMobile ? 18 : 24, borderRadius: 24 }}>
        <div style={{ display: "grid", gap: 8, marginBottom: 22 }}>
          <div style={{ fontSize: 30, lineHeight: 1 }}>🏀</div>
          <div style={{ fontWeight: 900, fontSize: isMobile ? 24 : 28, color: theme.text }}>League Access</div>
          <div style={{ color: theme.muted, fontSize: 14, lineHeight: 1.5 }}>
            Pick your team and your name, enter the team access code once, then create your own PIN for this device. After that, future unlocks on this device use only your PIN.
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              ["member", "Team Member"],
              ["admin", "Admin"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setRoleType(value);
                  setError("");
                }}
                style={{
                  border: `1px solid ${roleType === value ? theme.navActiveBg : theme.borderStrong}`,
                  background: roleType === value ? theme.navActiveBg : theme.buttonBg,
                  color: roleType === value ? theme.navActiveText : theme.buttonText,
                  borderRadius: 999,
                  padding: "10px 14px",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {roleType === "member" && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: theme.subtleText, display: "block", marginBottom: 6 }}>
                Team
              </label>
              <select
                value={selectedTeamId}
                onChange={(event) => {
                  setSelectedTeamId(event.target.value);
                  setError("");
                }}
                style={{ width: "100%", border: `1px solid ${theme.borderStrong}`, borderRadius: 14, padding: "12px 14px", fontSize: 14, background: theme.inputBg, color: theme.inputText }}
              >
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>{team.label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: theme.subtleText, display: "block", marginBottom: 6 }}>
              {roleType === "admin" ? "Admin Profile" : "Your Name"}
            </label>
            <select
              value={selectedAccountId}
              onChange={(event) => {
                setSelectedAccountId(event.target.value);
                setError("");
              }}
              style={{ width: "100%", border: `1px solid ${theme.borderStrong}`, borderRadius: 14, padding: "12px 14px", fontSize: 14, background: theme.inputBg, color: theme.inputText }}
            >
              <option value="">Select profile</option>
              {visibleAccounts.map((account) => (
                <option key={account.id} value={account.id}>{accountLabel(account)}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: theme.subtleText, display: "block", marginBottom: 6 }}>
              {roleType === "admin" ? "Admin Access Code" : "Team Access Code"}
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={accessPin}
              onChange={(event) => {
                setAccessPin(event.target.value.replace(/\D/g, "").slice(0, 8));
                setError("");
              }}
              placeholder="Required once"
              style={{ width: "100%", border: `1px solid ${theme.borderStrong}`, borderRadius: 14, padding: "12px 14px", fontSize: 14, background: theme.inputBg, color: theme.inputText }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: theme.subtleText, display: "block", marginBottom: 6 }}>
                Create Your PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                value={devicePin}
                onChange={(event) => {
                  setDevicePin(event.target.value.replace(/\D/g, "").slice(0, 8));
                  setError("");
                }}
                placeholder="Required"
                style={{ width: "100%", border: `1px solid ${theme.borderStrong}`, borderRadius: 14, padding: "12px 14px", fontSize: 14, background: theme.inputBg, color: theme.inputText }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: theme.subtleText, display: "block", marginBottom: 6 }}>
                Confirm Your PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                value={confirmPin}
                onChange={(event) => {
                  setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 8));
                  setError("");
                }}
                placeholder="Required"
                style={{ width: "100%", border: `1px solid ${theme.borderStrong}`, borderRadius: 14, padding: "12px 14px", fontSize: 14, background: theme.inputBg, color: theme.inputText }}
              />
            </div>
          </div>

          <div style={{ color: theme.subtleText, fontSize: 12, lineHeight: 1.5 }}>
            Only saved league members and admin profiles can enter. The team/admin access code is checked by the server once, and the PIN you create is what unlocks this device after that.
          </div>

          {error && <div style={{ color: "#dc2626", fontSize: 13, fontWeight: 700 }}>{error}</div>}

          <button
            type="button"
            onClick={handleContinue}
            style={{
              border: "none",
              background: theme.navActiveBg,
              color: theme.navActiveText,
              borderRadius: 16,
              padding: "13px 16px",
              fontWeight: 900,
              fontSize: 14,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
            disabled={loading}
          >
            {loading ? "Checking League Access..." : "Enter App"}
          </button>
        </div>
      </Card>
    </div>
  );
}

function AccessUnlockGate({ isMobile, profile, onUnlock, onReset }) {
  const theme = useTheme();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  function handleUnlock() {
    const storedPin = getStoredValue(ACCESS_DEVICE_PIN_STORAGE_KEY, "");
    if (pin.trim() !== storedPin) {
      setError("Wrong device PIN.");
      setPin("");
      return;
    }
    setError("");
    onUnlock();
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 16 : 28 }}>
      <Card style={{ width: "100%", maxWidth: 420, padding: isMobile ? 18 : 24, borderRadius: 24 }}>
        <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
          <div style={{ fontSize: 28, lineHeight: 1 }}>🔐</div>
          <div style={{ fontWeight: 900, fontSize: isMobile ? 22 : 26, color: theme.text }}>Welcome back</div>
          <div style={{ color: theme.muted, fontSize: 14 }}>
            Signed in on this device as <strong>{profile.name}</strong>{profile.teamId ? ` · ${ownerName(profile.teamId)}` : " · Admin"}.
          </div>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, "").slice(0, 8));
              setError("");
            }}
            onKeyDown={(event) => event.key === "Enter" && handleUnlock()}
            placeholder="Enter device PIN"
            style={{ width: "100%", border: `1px solid ${theme.borderStrong}`, borderRadius: 14, padding: "12px 14px", fontSize: 14, background: theme.inputBg, color: theme.inputText }}
          />
          {error && <div style={{ color: "#dc2626", fontSize: 13, fontWeight: 700 }}>{error}</div>}
          <button
            type="button"
            onClick={handleUnlock}
            style={{ border: "none", background: theme.navActiveBg, color: theme.navActiveText, borderRadius: 16, padding: "13px 16px", fontWeight: 900, fontSize: 14, cursor: "pointer" }}
          >
            Unlock
          </button>
          <button
            type="button"
            onClick={onReset}
            style={{ border: `1px solid ${theme.borderStrong}`, background: theme.surfaceAlt, color: theme.text, borderRadius: 16, padding: "12px 16px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}
          >
            Use a different profile
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function AdminView({
  source,
  games,
  isMobile,
  isTablet,
  accessProfile,
  hasDevicePin,
  onDevicePinSave,
  onDevicePinRemove,
  onSignOut,
  themeName,
  onThemeChange,
  textSize,
  onTextSizeChange,
  notificationSettings,
  onNotificationSettingChange,
}) {
  const theme = useTheme();
  const standings = useMemo(() => standingsFromGames(games), [games]);
  const unowned = games.filter(g =>
    requiresAuctionOwner(g) && (!lookupOwner(g.home) || !lookupOwner(g.away))
  );

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", gap: 12, flexDirection: isMobile ? "column" : "row", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Account</div>
            <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
              This phone is signed in with one saved league identity. Trash Talk uses it automatically.
            </div>
          </div>
          {accessProfile && (
            <Badge color={accessProfile.teamId ? teamColor(accessProfile.teamId).bg : "#e2e8f0"} textColor={accessProfile.teamId ? teamColor(accessProfile.teamId).accent : "#334155"}>
              {accessProfile.name} · {accessProfile.teamId ? ownerName(accessProfile.teamId) : "Admin"}
            </Badge>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1.1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "#94a3b8", display: "block", marginBottom: 6 }}>
              Signed In As
            </label>
            <div style={{ width: "100%", border: `1px solid ${theme.borderStrong}`, borderRadius: 12, padding: "12px 14px", fontSize: 14, background: theme.surfaceAlt, color: theme.text, fontWeight: 700 }}>
              {accessProfile ? `${accessProfile.name}${accessProfile.teamId ? ` · ${ownerName(accessProfile.teamId)}` : " · Admin"}` : "Not signed in"}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "#94a3b8", display: "block", marginBottom: 6 }}>
              Your PIN
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  const nextPin = window.prompt(hasDevicePin ? "Enter a new 4-8 digit PIN for this device" : "Create a 4-8 digit PIN for this device");
                  if (!nextPin) return;
                  onDevicePinSave(nextPin);
                }}
                style={{
                  border: `1px solid ${theme.borderStrong}`,
                  background: theme.buttonBg,
                  color: theme.buttonText,
                  borderRadius: 999,
                  padding: "10px 14px",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {hasDevicePin ? "Change PIN" : "Set PIN"}
              </button>
              {hasDevicePin && (
                <button
                  type="button"
                  onClick={onDevicePinRemove}
                  style={{
                    border: `1px solid ${theme.borderStrong}`,
                    background: theme.surfaceAlt,
                    color: theme.text,
                    borderRadius: 999,
                    padding: "10px 14px",
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Remove PIN
                </button>
              )}
              <button
                type="button"
                onClick={onSignOut}
                style={{
                  border: `1px solid ${theme.borderStrong}`,
                  background: "#fee2e2",
                  color: "#991b1b",
                  borderRadius: 999,
                  padding: "10px 14px",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, color: "#94a3b8", fontSize: 12 }}>
          The saved league identity lives on this device. The PIN you create is what unlocks this phone or browser after your first approved login.
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 14 }}>Display</div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "#64748b", fontSize: 13 }}>
            Adjust text size for this device.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ color: theme.muted, fontSize: 13 }}>
              Theme
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {Object.entries(APP_THEMES).map(([key, option]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onThemeChange(key)}
                  style={{
                    border: `1px solid ${themeName === key ? theme.navActiveBg : theme.borderStrong}`,
                    background: themeName === key ? theme.navActiveBg : theme.buttonBg,
                    color: themeName === key ? theme.navActiveText : theme.buttonText,
                    borderRadius: 999,
                    padding: "9px 14px",
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(TEXT_SIZE_OPTIONS).map(([key, option]) => (
              <button
                key={key}
                type="button"
                onClick={() => onTextSizeChange(key)}
                style={{
                  border: `1px solid ${textSize === key ? "#0f172a" : "#cbd5e1"}`,
                  background: textSize === key ? "#0f172a" : "#fff",
                  color: textSize === key ? "#fff" : "#334155",
                  borderRadius: 999,
                  padding: "9px 14px",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 14 }}>Notifications</div>
        <div style={{ display: "grid", gap: 10 }}>
          {[
            ["comments", "Trash Talk Messages", "Every new comment from the league-wide feed."],
            ["mentions", "Mentions", "Only when somebody tags your user name."],
            ["leadChanges", "Lead Changes", "When first place changes hands."],
            ["gameFinals", "Game Finals", "When a tracked game goes final."],
            ["dailyRecap", "Daily Recap", "One end-of-day recap with points, alive schools, and next-day upside."],
          ].map(([key, label, help]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, border: `1px solid ${theme.borderStrong}`, borderRadius: 14, padding: "12px 14px", background: theme.surfaceAlt }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>{label}</div>
                <div style={{ color: theme.muted, fontSize: 12, marginTop: 2 }}>{help}</div>
              </div>
              <button
                type="button"
                onClick={() => onNotificationSettingChange(key, !notificationSettings[key])}
                style={{
                  border: "none",
                  background: notificationSettings[key] ? "#0f172a" : "#cbd5e1",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "8px 12px",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                  minWidth: 64,
                }}
              >
                {notificationSettings[key] ? "On" : "Off"}
              </button>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: responsiveColumns({ isMobile, isTablet, desktop: "1fr 1fr" }), gap: 16 }}>
        <Card>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>System Status</div>
          {[
            ["Live Feed", source === "Live" ? "✅ Connected" : "⚠️  Demo mode"],
            ["Auto Refresh", "✅  Every 15 seconds"],
            ["Ownership Ledger", `✅  ${ownedTeams.length} auctioned teams loaded`],
            ["Scoring Engine", "✅  Official 2026 rules"],
            ["Payout Calc", `✅  $${TOTAL_POT} pot configured`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${theme.borderStrong}`, fontSize: 14 }}>
              <span style={{ color: theme.muted }}>{k}</span>
              <span style={{ fontWeight: 700, color: theme.text }}>{v}</span>
            </div>
          ))}
        </Card>

        <Card>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 14 }}>Roster Spend Summary</div>
          {standings.map((team) => {
            const c = teamColor(team.id);
            return (
              <div key={team.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  <span style={{ color: c.text }}>{team.name}</span>
                  <span style={{ color: c.accent }}>${team.spent} / $100</span>
                </div>
                <BudgetBar spent={team.spent} budget={team.budget} />
              </div>
            );
          })}
        </Card>
      </div>

      {unowned.length > 0 && (
        <Card style={{ borderLeft: "4px solid #f59e0b" }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>⚠️  Schools in Feed Not in Ownership Ledger</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[...new Set(
              unowned.flatMap(g => [
                !lookupOwner(g.home) ? normalizeName(g.home) : null,
                !lookupOwner(g.away) ? normalizeName(g.away) : null,
              ].filter(Boolean))
            )].map(s => <Badge key={s} color="#fef9c3" textColor="#713f12">{s}</Badge>)}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
export default function App() {
  const { isMobile, isTablet } = useResponsiveLayout();
  const [tab, setTab] = useState("Standings");
  const [ownershipFilter, setOwnershipFilter] = useState("all");
  const [games, setGames] = useState(demoGames);
  const [source, setSource] = useState("Demo");
  const [updatedAt, setUpdatedAt] = useState(new Date().toISOString());
  const [error, setError] = useState("");
  const [comments, setComments] = useState([]);
  const [commentsError, setCommentsError] = useState("");
  const [lastSeenCommentAt, setLastSeenCommentAt] = useState(() => getStoredValue(COMMENT_LAST_SEEN_STORAGE_KEY, ""));
  const [accessProfile, setAccessProfile] = useState(() =>
    normalizeAccessProfile(getStoredJson(ACCESS_PROFILE_STORAGE_KEY, null))
  );
  const [authChecked, setAuthChecked] = useState(false);
  const [accessUnlocked, setAccessUnlocked] = useState(() => {
    const storedPin = getStoredValue(ACCESS_DEVICE_PIN_STORAGE_KEY, "");
    return !storedPin || getSessionValue(ACCESS_UNLOCKED_SESSION_KEY, "") === "true";
  });
  const [notificationSettings, setNotificationSettings] = useState(() => ({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...getStoredJson(NOTIFICATION_SETTINGS_STORAGE_KEY, {}),
  }));
  const [textSize, setTextSize] = useState(() => {
    const stored = getStoredValue(TEXT_SIZE_STORAGE_KEY, "medium");
    return TEXT_SIZE_OPTIONS[stored] ? stored : "medium";
  });
  const [themeName, setThemeName] = useState(() => {
    const stored = getStoredValue(THEME_STORAGE_KEY, "light");
    return APP_THEMES[stored] ? stored : "light";
  });
  const [notifications, setNotifications] = useState(() => {
    const stored = getStoredJson(NOTIFICATIONS_STORAGE_KEY, []);
    return Array.isArray(stored) ? stored : [];
  });
  const [commentClientId] = useState(() => {
    const existing = getStoredValue(COMMENT_CLIENT_ID_STORAGE_KEY, "");
    if (existing) return existing;
    const created = createClientId();
    setStoredValue(COMMENT_CLIENT_ID_STORAGE_KEY, created);
    return created;
  });
  const commentsHydratedRef = useRef(false);
  const previousCommentIdsRef = useRef(new Set());
  const gamesHydratedRef = useRef(false);
  const previousGameStatusRef = useRef({});
  const previousLeaderIdRef = useRef("");
  const commentUserName = accessProfile?.name || "";
  const commentTeam = accessProfile?.teamId ? fantasyTeams.find((team) => team.id === accessProfile.teamId) || null : null;
  const clearLocalAccess = ({ clearDevicePin = true } = {}) => {
    setAccessProfile(null);
    setAccessUnlocked(false);
    setTab("Standings");
    setOwnershipFilter("all");
    if (clearDevicePin) setStoredValue(ACCESS_DEVICE_PIN_STORAGE_KEY, "");
    setStoredValue(ACCESS_PROFILE_STORAGE_KEY, "");
    setSessionValue(ACCESS_UNLOCKED_SESSION_KEY, "");
  };
  const apiFetch = async (endpoint, options = {}) => {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    });

    if (response.status === 401) {
      clearLocalAccess();
      throw new Error("League session expired. Log in again.");
    }

    return response;
  };
  const handleOpenOwnership = (teamId) => {
    setOwnershipFilter(teamId || "all");
    setTab("Ownership");
  };
  const handleOpenComments = () => {
    setTab("Trash Talk");
  };
  const completeAccessSetup = async ({ accountId, accessPin, devicePin }) => {
    const res = await apiFetch("/api/access/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, accessPin }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Unable to verify league access.");
    }

    const normalized = normalizeAccessProfile(data.profile);
    if (!normalized) throw new Error("League access profile is invalid.");
    setAccessProfile(normalized);
    setAccessUnlocked(true);
    try {
      localStorage.setItem(ACCESS_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
    } catch {}
    setStoredValue(ACCESS_DEVICE_PIN_STORAGE_KEY, devicePin);
    setSessionValue(ACCESS_UNLOCKED_SESSION_KEY, "true");
  };
  const unlockAccess = () => {
    setAccessUnlocked(true);
    setSessionValue(ACCESS_UNLOCKED_SESSION_KEY, "true");
  };
  const resetAccessProfile = async () => {
    try {
      await apiFetch("/api/access/logout", { method: "POST" });
    } catch {
      // Ignore logout transport failures and still clear local state.
    }
    clearLocalAccess();
  };
  const saveDevicePin = (nextPin) => {
    const cleanPin = String(nextPin || "").replace(/\D/g, "").slice(0, 8);
    if (!/^\d{4,8}$/.test(cleanPin)) {
      window.alert("PIN must be 4 to 8 digits.");
      return;
    }
    setStoredValue(ACCESS_DEVICE_PIN_STORAGE_KEY, cleanPin);
    setAccessUnlocked(true);
    setSessionValue(ACCESS_UNLOCKED_SESSION_KEY, "true");
  };
  const removeDevicePin = () => {
    setStoredValue(ACCESS_DEVICE_PIN_STORAGE_KEY, "");
    setAccessUnlocked(true);
    setSessionValue(ACCESS_UNLOCKED_SESSION_KEY, "true");
  };
  const updateNotificationSettings = (key, value) => {
    setNotificationSettings((current) => {
      const next = { ...current, [key]: value };
      try {
        localStorage.setItem(NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const updateTextSize = (value) => {
    if (!TEXT_SIZE_OPTIONS[value]) return;
    setTextSize(value);
    setStoredValue(TEXT_SIZE_STORAGE_KEY, value);
  };
  const updateThemeName = (value) => {
    if (!APP_THEMES[value]) return;
    setThemeName(value);
    setStoredValue(THEME_STORAGE_KEY, value);
  };
  const addNotification = (notification) => {
    setNotifications((current) => {
      if (current.some((entry) => entry.id === notification.id)) return current;
      const next = [{ ...notification, read: false }, ...current].slice(0, 40);
      try {
        localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const markAllNotificationsRead = () => {
    setNotifications((current) => {
      const next = current.map((notification) => ({ ...notification, read: true }));
      try {
        localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const upsertComments = (incoming) => {
    setComments((current) => mergeCommentList(current, incoming));
  };

  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/access/session`, { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (res.ok) {
          const normalized = normalizeAccessProfile(data.profile);
          if (normalized) {
            setAccessProfile(normalized);
            try {
              localStorage.setItem(ACCESS_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
            } catch {}
          } else {
            clearLocalAccess();
          }
        } else {
          clearLocalAccess();
        }
      } catch {
        if (!mounted) return;
        clearLocalAccess({ clearDevicePin: false });
      } finally {
        if (mounted) setAuthChecked(true);
      }
    };

    restoreSession();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authChecked || !accessProfile) return;
    let mounted = true;
    const load = async () => {
      try {
        const res = await apiFetch("/api/league-state");
        const data = await res.json();
        if (!mounted) return;
        setGames(Array.isArray(data.games) && data.games.length ? data.games : demoGames);
        setSource(data.source || "Live");
        setUpdatedAt(data.updatedAt || new Date().toISOString());
        setError("");
      } catch (loadError) {
        if (!mounted) return;
        setGames(demoGames);
        setSource("Demo");
        setUpdatedAt(new Date().toISOString());
        setError(loadError.message === "League session expired. Log in again."
          ? loadError.message
          : "Live feed unavailable — showing March 19 results");
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { mounted = false; clearInterval(id); };
  }, [authChecked, accessProfile]);

  useEffect(() => {
    if (!authChecked || !accessProfile) return;
    let mounted = true;
    const loadComments = async () => {
      try {
        const res = await apiFetch("/api/comments");
        const data = await res.json();
        if (!mounted) return;
        setComments(
          sortCommentsAscending(
            (Array.isArray(data.comments) ? data.comments : [])
              .map(normalizeCommentRecord)
              .filter(Boolean)
          )
        );
        setCommentsError("");
      } catch (loadError) {
        if (!mounted) return;
        setCommentsError(loadError.message === "League session expired. Log in again."
          ? loadError.message
          : "Chat unavailable right now.");
      }
    };

    loadComments();
    const id = setInterval(loadComments, COMMENT_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [authChecked, accessProfile]);

  const standings = useMemo(() => standingsFromGames(games), [games]);
  const headerLeaderboard = standings.slice(0, 6);
  const headerSlateGames = games.filter((game) => game.status === "Live" || game.status === "Upcoming");
  const headerRoundGames = headerSlateGames.length > 0 ? headerSlateGames : games;
  const headerRounds = [...new Set(headerRoundGames.map((game) => roundLabels[game.round] || game.round).filter(Boolean))];
  const headerRoundSummary = headerRounds.length === 1
    ? headerRounds[0]
    : headerRounds.length > 1
      ? headerRounds.join(" · ")
      : "Tournament";
  const textScale = TEXT_SIZE_OPTIONS[textSize]?.scale || 1;
  const theme = APP_THEMES[themeName] || APP_THEMES.light;
  const unreadComments = comments.filter((comment) =>
    comment.createdAt > lastSeenCommentAt && comment.clientId !== commentClientId
  );
  const unreadCommentCount = unreadComments.length;
  const unreadMentionCount = unreadComments.filter((comment) =>
    commentMentionsUser(comment.message, commentUserName)
  ).length;
  const unreadNotificationCount = notifications.filter((notification) => !notification.read).length;
  const hasDevicePin = Boolean(getStoredValue(ACCESS_DEVICE_PIN_STORAGE_KEY, ""));

  useEffect(() => {
    if (!commentsHydratedRef.current) {
      commentsHydratedRef.current = true;
      previousCommentIdsRef.current = new Set(comments.map((comment) => comment.id));
      return;
    }

    const newComments = comments.filter((comment) => !previousCommentIdsRef.current.has(comment.id));
    newComments.forEach((comment) => {
      if (comment.clientId === commentClientId) return;
      if (notificationSettings.comments) {
        addNotification({
          id: `comment:${comment.id}`,
          kind: "comment",
          title: `${comment.authorName} said something`,
          body: comment.message,
          createdAt: comment.createdAt,
        });
      }
      if (notificationSettings.mentions && commentMentionsUser(comment.message, commentUserName)) {
        addNotification({
          id: `mention:${comment.id}:${normalizeMentionLabel(commentUserName).toLowerCase()}`,
          kind: "mention",
          title: `${comment.authorName} tagged you`,
          body: comment.message,
          createdAt: comment.createdAt,
        });
      }
    });
    previousCommentIdsRef.current = new Set(comments.map((comment) => comment.id));
  }, [comments, commentClientId, commentUserName, notificationSettings.comments, notificationSettings.mentions]);

  useEffect(() => {
    const currentStatuses = Object.fromEntries(games.map((game) => [game.id, game.status]));
    const currentLeaderId = standings[0]?.id || "";
    const recapNotifications = buildDailyRecapNotifications(games);

    if (!gamesHydratedRef.current) {
      gamesHydratedRef.current = true;
      previousGameStatusRef.current = currentStatuses;
      previousLeaderIdRef.current = currentLeaderId;
      if (notificationSettings.dailyRecap) {
        recapNotifications.forEach((notification) => addNotification(notification));
      }
      return;
    }

    if (notificationSettings.gameFinals) {
      games.forEach((game) => {
        const previousStatus = previousGameStatusRef.current[game.id];
        if (game.status === "Final" && previousStatus && previousStatus !== "Final") {
          const winner = getWinner(game);
          const winnerOwnerId = winner ? lookupOwner(winner.school) : null;
          addNotification({
            id: `game-final:${game.id}`,
            kind: "gameFinal",
            title: `Final: ${normalizeName(game.home)} ${game.homeScore} - ${game.awayScore} ${normalizeName(game.away)}`,
            body: winnerOwnerId
              ? `${ownerName(winnerOwnerId)} bags +${scoreGame(game)} and starts chirping.`
              : `${roundLabels[game.round] || game.round} is in the books.`,
            createdAt: new Date().toISOString(),
          });
        }
      });
    }

    if (notificationSettings.leadChanges && previousLeaderIdRef.current && currentLeaderId && previousLeaderIdRef.current !== currentLeaderId) {
      addNotification({
        id: `lead:${currentLeaderId}:${standings[0]?.points || 0}:${games.filter((game) => game.status === "Final").length}`,
        kind: "leadChange",
        title: `New leader: ${standings[0].name}`,
        body: `${standings[0].name} moved into first with ${standings[0].points} pts. Somebody else just got knocked out of the good chair.`,
        createdAt: new Date().toISOString(),
      });
    }

    if (notificationSettings.dailyRecap) {
      recapNotifications.forEach((notification) => addNotification(notification));
    }

    previousGameStatusRef.current = currentStatuses;
    previousLeaderIdRef.current = currentLeaderId;
  }, [games, standings, notificationSettings.dailyRecap, notificationSettings.gameFinals, notificationSettings.leadChanges]);

  const markCommentsRead = () => {
    const latestSeen = comments[comments.length - 1]?.createdAt || new Date().toISOString();
    setLastSeenCommentAt(latestSeen);
    setStoredValue(COMMENT_LAST_SEEN_STORAGE_KEY, latestSeen);
  };

  useEffect(() => {
    if (tab !== "Trash Talk" || comments.length === 0) return;
    markCommentsRead();
  }, [tab, comments.length]);

  const handleSubmitComment = async ({ authorName, authorTeamId, teamId, replyToId, message }) => {
    const res = await apiFetch("/api/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replyToId,
        message,
        clientId: commentClientId,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Unable to post comment.");

    upsertComments(data.comment);
    setCommentsError("");
  };

  const handleEditComment = async ({ commentId, message }) => {
    const res = await apiFetch(`/api/comments/${commentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        clientId: commentClientId,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Unable to edit comment.");

    upsertComments(data.comment);
    setCommentsError("");
  };

  if (!authChecked) {
    return (
      <ThemeContext.Provider value={theme}>
        <>
          <style>{`
            * { box-sizing: border-box; }
            body { margin: 0; background: ${theme.pageBg}; color: ${theme.text}; font-family: 'Inter', system-ui, sans-serif; }
          `}</style>
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 16 : 28 }}>
            <Card style={{ width: "100%", maxWidth: 380, padding: 22, borderRadius: 24, textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🔒</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: theme.text }}>Checking League Access</div>
            </Card>
          </div>
        </>
      </ThemeContext.Provider>
    );
  }

  if (!accessProfile) {
    return (
      <ThemeContext.Provider value={theme}>
        <>
          <style>{`
            * { box-sizing: border-box; }
            body { margin: 0; background: ${theme.pageBg}; color: ${theme.text}; font-family: 'Inter', system-ui, sans-serif; }
            button, select, input, textarea { font-family: inherit; }
          `}</style>
          <AccessSetupGate isMobile={isMobile} onComplete={completeAccessSetup} />
        </>
      </ThemeContext.Provider>
    );
  }

  if (hasDevicePin && !accessUnlocked) {
    return (
      <ThemeContext.Provider value={theme}>
        <>
          <style>{`
            * { box-sizing: border-box; }
            body { margin: 0; background: ${theme.pageBg}; color: ${theme.text}; font-family: 'Inter', system-ui, sans-serif; }
            button, select, input, textarea { font-family: inherit; }
          `}</style>
          <AccessUnlockGate isMobile={isMobile} profile={accessProfile} onUnlock={unlockAccess} onReset={resetAccessProfile} />
        </>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
    <>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        * { box-sizing: border-box; }
        body { margin: 0; background: ${theme.pageBg}; color: ${theme.text}; font-family: 'Inter', system-ui, sans-serif; }
        button { font-family: inherit; }
        select, input, textarea { font-family: inherit; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-track { background: ${theme.pageBg}; }
        ::-webkit-scrollbar-thumb { background: ${theme.borderStrong}; border-radius: 999px; }
      `}</style>

      <div style={{ minHeight: "100vh", padding: isMobile ? "12px" : "24px 20px", background: theme.pageBg, color: theme.text }}>
        <div style={{ zoom: textScale, fontSize: `${Math.round(textScale * 100)}%` }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gap: 20 }}>

          {/* ── Header ── */}
          <div style={{ background: theme.headerBg, borderRadius: 18, padding: isMobile ? "12px" : "14px 16px", color: theme.text === "#e2e8f0" ? "#fff" : "#fff" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "center", flexWrap: "wrap", gap: 10, flexDirection: isMobile ? "column" : "row" }}>
                <div style={{ background: theme.headerSurface, color: theme.headerMuted, borderRadius: 999, padding: "7px 12px", fontSize: 12, border: `1px solid ${theme.headerBorder}`, fontWeight: 800, width: "fit-content" }}>
                  {`Round: ${headerRoundSummary}`}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", width: isMobile ? "100%" : "auto", justifyContent: isMobile ? "space-between" : "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setTab("Standings")}
                    style={{
                      border: `1px solid ${theme.headerBorder}`,
                      background: theme.headerSurface,
                      color: "#fff",
                      borderRadius: 999,
                      padding: "7px 12px",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("Trash Talk")}
                    style={{
                      border: `1px solid ${theme.headerBorder}`,
                      background: theme.headerSurface,
                      color: "#fff",
                      borderRadius: 999,
                      padding: "7px 12px",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Trash Talk
                  </button>
                  <NotificationCenter
                    notifications={notifications}
                    unreadCount={unreadNotificationCount}
                    isMobile={isMobile}
                    onMarkAllRead={markAllNotificationsRead}
                  />
                  <Tabs value={tab} onChange={setTab} isMobile={isMobile} />
                  {error && (
                    <div style={{ background: "#fef3c7", color: "#92400e", borderRadius: 999, padding: "7px 12px", fontSize: 12 }}>
                      ⚠️ {error}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ background: theme.headerSurface, border: `1px solid ${theme.headerBorder}`, borderRadius: 14, padding: "8px 10px", overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: isMobile ? 320 : 520, borderCollapse: "collapse", color: "#e2e8f0", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: theme.headerMuted, textTransform: "uppercase", fontSize: 10, letterSpacing: ".05em" }}>
                      <th style={{ textAlign: "left", paddingBottom: 6 }}>#</th>
                      <th style={{ textAlign: "left", paddingBottom: 6 }}>Team</th>
                      <th style={{ textAlign: "right", paddingBottom: 6 }}>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headerLeaderboard.map((team, index) => (
                      <tr key={team.id} style={{ borderTop: `1px solid ${theme.headerBorder}` }}>
                        <td style={{ padding: "6px 6px 6px 0", fontWeight: 900, whiteSpace: "nowrap" }}>
                          {RANK_MEDALS[index] || `#${index + 1}`}
                        </td>
                        <td style={{ padding: "6px 10px 6px 0", fontWeight: 700 }}>{team.name}</td>
                        <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 900, color: "#f8fafc" }}>{team.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Views ── */}
          {tab === "Standings" && (
            <StandingsView
              games={games}
              isMobile={isMobile}
              isTablet={isTablet}
              comments={comments}
              commentUserName={commentUserName}
              onOpenComments={handleOpenComments}
              onOpenOwnership={handleOpenOwnership}
            />
          )}
          {tab === "Live Bracket" && <LiveBracketView games={games} source={source} updatedAt={updatedAt} error={error} isMobile={isMobile} isTablet={isTablet} />}
          {tab === "Ownership" && (
            <OwnershipView
              games={games}
              isMobile={isMobile}
              filter={ownershipFilter}
              onFilterChange={setOwnershipFilter}
            />
          )}
          {tab === "Analysis" && <AnalysisView games={games} isMobile={isMobile} isTablet={isTablet} />}
          {tab === "Trash Talk" && (
            <CommentsView
              comments={comments}
              commentUserName={commentUserName}
              commentTeam={commentTeam}
              commentClientId={commentClientId}
              unreadCommentCount={unreadCommentCount}
              unreadMentionCount={unreadMentionCount}
              commentsError={commentsError}
              isMobile={isMobile}
              onSubmitComment={handleSubmitComment}
              onEditComment={handleEditComment}
              onMarkCommentsRead={markCommentsRead}
            />
          )}
          {tab === "Settings" && (
            <AdminView
              source={source}
              games={games}
              isMobile={isMobile}
              isTablet={isTablet}
              accessProfile={accessProfile}
              hasDevicePin={hasDevicePin}
              onDevicePinSave={saveDevicePin}
              onDevicePinRemove={removeDevicePin}
              onSignOut={resetAccessProfile}
              themeName={themeName}
              onThemeChange={updateThemeName}
              textSize={textSize}
              onTextSizeChange={updateTextSize}
              notificationSettings={notificationSettings}
              onNotificationSettingChange={updateNotificationSettings}
            />
          )}
        </div>
        </div>
      </div>
    </>
    </ThemeContext.Provider>
  );
}
