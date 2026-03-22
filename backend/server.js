const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "32kb" }));
const frontendDistDir = path.join(__dirname, "..", "frontend", "dist");

const COMMENTS_DIR = path.join(__dirname, "data");
const COMMENTS_FILE = path.join(COMMENTS_DIR, "comments.json");
const comments = [];
let nextCommentId = 1;
const PORT = Number(process.env.PORT) || 4000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SESSION_COOKIE_NAME = "league_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 180;
const SESSION_SECRET = process.env.ACCESS_SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev-only-league-session-secret");
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
const fantasyTeams = [
  { id: "mike-bob", name: "Mike / Bob", members: ["Mike W.", "Bob"] },
  { id: "solomon-brenden", name: "Solomon / Brenden", members: ["Solomon", "Brenden"] },
  { id: "dan-chris", name: "Dan / Chris", members: ["Dan", "Chris"] },
  { id: "ryan-brian", name: "Ryan / Brian", members: ["Ryan", "Brian"] },
  { id: "mikea-gregg", name: "Mike A / Gregg", members: ["Mike A.", "Gregg"] },
  { id: "josh-gabe", name: "Josh / Gabe", members: ["Josh", "Gabe"] },
];
const adminAccounts = [
  { id: "admin-ariel", name: "Ariel", role: "admin", teamId: null },
  { id: "admin-commissioner", name: "Commissioner", role: "admin", teamId: null },
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
const accountMap = new Map(leagueAccessAccounts.map((account) => [account.id, account]));

const teamNameMap = {
  "Connecticut Huskies": "UConn",
  "Miami Hurricanes": "Miami (FL)",
  "Texas A&M Aggies": "Texas A&M",
  "St. John's Red Storm": "St. John's",
  "Saint Mary's Gaels": "Saint Mary's",
  "Hawai'i Rainbow Warriors": "Hawai'i",
  "Prairie View A&M Panthers": "Prairie View A&M",
};

function normalizeSchoolName(name) {
  return teamNameMap[name] || name;
}

function roundFromCompetition(comp) {
  const t = `${comp?.notes?.[0]?.headline || ""} ${comp?.status?.type?.detail || ""}`.toLowerCase();
  if (t.includes("first four")) return "FF";
  if (t.includes("first round") || t.includes("1st round")) return "R64";
  if (t.includes("second round") || t.includes("2nd round")) return "R32";
  if (t.includes("regional semifinal")) return "S16";
  if (t.includes("regional final")) return "E8";
  if (t.includes("sweet 16")) return "S16";
  if (t.includes("elite 8")) return "E8";
  if (t.includes("final four") || t.includes("national semifinal")) return "F4";
  if (t.includes("championship")) return "CH";
  return "R64";
}

function regionFromCompetition(comp) {
  const headline = comp?.notes?.[0]?.headline || "";
  const match = headline.match(/\b(East|West|South|Midwest)\b/i);
  return match ? match[1] : "Tournament";
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function buildDateKeys(startDate, endDate = new Date()) {
  const keys = [];
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    keys.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cookieSerialize(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const index = chunk.indexOf("=");
        if (index < 0) return [chunk, ""];
        return [chunk.slice(0, index), decodeURIComponent(chunk.slice(index + 1))];
      })
  );
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signValue(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function buildSessionToken(profile) {
  const payload = {
    accountId: profile.accountId,
    name: profile.name,
    role: profile.role,
    teamId: profile.teamId || null,
    issuedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${signValue(encoded)}`;
}

function verifySessionToken(token) {
  if (!token || !SESSION_SECRET) return null;
  const [encoded, signature] = String(token).split(".");
  if (!encoded || !signature) return null;
  const expected = signValue(encoded);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (!payload || typeof payload !== "object") return null;
    if (!payload.accountId || payload.expiresAt < Date.now()) return null;
    const account = accountMap.get(payload.accountId);
    if (!account) return null;
    return {
      accountId: account.id,
      name: account.name,
      role: account.role,
      teamId: account.teamId || null,
    };
  } catch {
    return null;
  }
}

function sessionCookieOptions() {
  return {
    maxAge: SESSION_TTL_MS,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
  };
}

function setSessionCookie(res, profile) {
  res.setHeader("Set-Cookie", cookieSerialize(SESSION_COOKIE_NAME, buildSessionToken(profile), sessionCookieOptions()));
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    cookieSerialize(SESSION_COOKIE_NAME, "", {
      maxAge: 0,
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
    })
  );
}

function currentSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  return verifySessionToken(cookies[SESSION_COOKIE_NAME]);
}

function requireAuth(req, res, next) {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ error: "League login required." });
    return;
  }
  req.auth = session;
  next();
}

function loginProfileForAccount(account) {
  return {
    accountId: account.id,
    name: account.name,
    role: account.role,
    teamId: account.teamId || null,
  };
}

function broadcastNamesFromCompetition(comp) {
  const names = new Set();

  (comp?.broadcasts || []).forEach((broadcast) => {
    (broadcast?.names || []).forEach((name) => {
      const clean = cleanText(name, 64);
      if (clean) names.add(clean);
    });
  });

  (comp?.geoBroadcasts || []).forEach((broadcast) => {
    const clean = cleanText(broadcast?.media?.shortName, 64);
    if (clean) names.add(clean);
  });

  return [...names];
}

function normalizeCommentRecord(record) {
  if (!record || typeof record !== "object") return null;
  return {
    id: String(record.id),
    message: cleanText(record.message, 400),
    authorName: cleanText(record.author_name ?? record.authorName, 40) || "Guest",
    authorTeamId: cleanText(record.author_team_id ?? record.authorTeamId, 64) || null,
    teamId: cleanText(record.team_id ?? record.teamId, 64) || null,
    clientId: cleanText(record.client_id ?? record.clientId, 64) || null,
    replyToId: cleanText(record.reply_to_id ?? record.replyToId, 64) || null,
    createdAt: record.created_at ?? record.createdAt ?? new Date().toISOString(),
    updatedAt: record.updated_at ?? record.updatedAt ?? null,
  };
}

async function listComments(teamId = null) {
  if (supabase) {
    let query = supabase
      .from("comments")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(250);

    if (teamId) query = query.eq("team_id", teamId);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalizeCommentRecord).filter(Boolean);
  }

  const filtered = teamId ? comments.filter((comment) => comment.teamId === teamId) : comments;
  return filtered.slice(-250).map(normalizeCommentRecord).filter(Boolean);
}

async function createComment(commentInput) {
  if (supabase) {
    const { data, error } = await supabase
      .from("comments")
      .insert({
        message: commentInput.message,
        author_name: commentInput.authorName,
        author_team_id: commentInput.authorTeamId,
        team_id: commentInput.teamId,
        client_id: commentInput.clientId,
        reply_to_id: commentInput.replyToId,
      })
      .select()
      .single();
    if (error) throw error;
    return normalizeCommentRecord(data);
  }

  const comment = {
    id: String(nextCommentId++),
    message: commentInput.message,
    authorName: commentInput.authorName,
    authorTeamId: commentInput.authorTeamId,
    teamId: commentInput.teamId,
    clientId: commentInput.clientId,
    replyToId: commentInput.replyToId,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };

  comments.push(comment);
  if (comments.length > 500) comments.shift();
  await saveCommentsToDisk();
  return normalizeCommentRecord(comment);
}

async function updateComment(commentId, clientId, message) {
  if (supabase) {
    const { data: existing, error: selectError } = await supabase
      .from("comments")
      .select("id, client_id")
      .eq("id", commentId)
      .single();

    if (selectError) {
      if (selectError.code === "PGRST116") return { notFound: true };
      throw selectError;
    }
    if (!existing || cleanText(existing.client_id, 64) !== clientId) return { forbidden: true };

    const { data, error } = await supabase
      .from("comments")
      .update({
        message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", commentId)
      .select()
      .single();

    if (error) throw error;
    return { comment: normalizeCommentRecord(data) };
  }

  const comment = comments.find((entry) => entry.id === commentId);
  if (!comment) return { notFound: true };
  if (cleanText(comment.clientId, 64) !== clientId) return { forbidden: true };

  comment.message = message;
  comment.updatedAt = new Date().toISOString();
  await saveCommentsToDisk();
  return { comment: normalizeCommentRecord(comment) };
}

async function loadCommentsFromDisk() {
  try {
    await fs.mkdir(COMMENTS_DIR, { recursive: true });
    const raw = await fs.readFile(COMMENTS_FILE, "utf8").catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
      await fs.writeFile(COMMENTS_FILE, "[]\n", "utf8");
      return "[]";
    });
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];

    comments.splice(
      0,
      comments.length,
      ...list.filter((comment) => comment && typeof comment === "object")
    );

    nextCommentId = comments.reduce((maxId, comment) => {
      const numericId = Number(comment.id);
      return Number.isFinite(numericId) ? Math.max(maxId, numericId + 1) : maxId;
    }, 1);
  } catch (error) {
    console.error("Failed to load persisted comments:", error);
  }
}

async function saveCommentsToDisk() {
  await fs.mkdir(COMMENTS_DIR, { recursive: true });
  const tempFile = `${COMMENTS_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(comments, null, 2)}\n`, "utf8");
  await fs.rename(tempFile, COMMENTS_FILE);
}

app.post("/api/access/login", (req, res) => {
  if (!SESSION_SECRET) {
    res.status(503).json({ error: "League access is not configured yet." });
    return;
  }

  const accountId = cleanText(req.body?.accountId, 80);
  const account = accountMap.get(accountId);

  if (!account) {
    res.status(401).json({ error: "That member profile is not allowed." });
    return;
  }

  const profile = loginProfileForAccount(account);
  setSessionCookie(res, profile);
  res.json({ profile });
});

app.get("/api/access/session", (req, res) => {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ error: "No active league session." });
    return;
  }
  res.json({ profile: session });
});

app.post("/api/access/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/comments", requireAuth, (req, res) => {
  const teamId = cleanText(req.query.teamId, 64) || null;
  listComments(teamId)
    .then((list) => {
      res.json({
        updatedAt: new Date().toISOString(),
        comments: list,
      });
    })
    .catch((error) => {
      console.error("Failed to list comments:", error);
      res.status(500).json({ error: "Unable to load comments right now." });
    });
});

app.post("/api/comments", requireAuth, async (req, res) => {
  const message = cleanText(req.body?.message, 400);
  const clientId = cleanText(req.body?.clientId, 64) || null;
  const replyToId = cleanText(req.body?.replyToId, 64) || null;

  if (!message) {
    res.status(400).json({ error: "Comment text is required." });
    return;
  }

  if (!clientId) {
    res.status(400).json({ error: "Client id is required." });
    return;
  }

  if (replyToId) {
    try {
      const availableComments = await listComments();
      if (!availableComments.find((comment) => comment.id === replyToId)) {
        res.status(400).json({ error: "Reply target no longer exists." });
        return;
      }
    } catch (error) {
      console.error("Failed to validate reply target:", error);
      res.status(500).json({ error: "Unable to post comment right now." });
      return;
    }
  }

  try {
    const comment = await createComment({
      message,
      authorName: req.auth.name,
      authorTeamId: req.auth.teamId || null,
      teamId: req.auth.teamId || null,
      clientId,
      replyToId,
    });

    res.status(201).json({ comment });
  } catch (error) {
    console.error("Failed to create comment:", error);
    res.status(500).json({ error: "Unable to post comment right now." });
  }
});

app.patch("/api/comments/:id", requireAuth, async (req, res) => {
  const commentId = cleanText(req.params.id, 64);
  const message = cleanText(req.body?.message, 400);
  const clientId = cleanText(req.body?.clientId, 64);

  if (!commentId) {
    res.status(400).json({ error: "Comment id is required." });
    return;
  }
  if (!clientId) {
    res.status(400).json({ error: "Client id is required." });
    return;
  }
  if (!message) {
    res.status(400).json({ error: "Updated comment text is required." });
    return;
  }

  try {
    const result = await updateComment(commentId, clientId, message);
    if (result.notFound) {
      res.status(404).json({ error: "Comment no longer exists." });
      return;
    }
    if (result.forbidden) {
      res.status(403).json({ error: "You can only edit your own comment on this device." });
      return;
    }
    res.json({ comment: result.comment });
  } catch (error) {
    console.error("Failed to update comment:", error);
    res.status(500).json({ error: "Unable to update comment right now." });
  }
});

app.get("/api/league-state", requireAuth, async (req, res) => {
  try {
    const dateKeys = buildDateKeys(new Date(2026, 2, 18));
    const payloads = await Promise.all(
      dateKeys.map(async (dateKey) => {
        const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&dates=${dateKey}`);
        return response.json();
      })
    );

    const events = payloads
      .flatMap((payload) => payload.events || [])
      .filter((event, index, allEvents) => allEvents.findIndex((candidate) => candidate.id === event.id) === index)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const games = events.map((event) => {
      const comp = event.competitions?.[0];
      const competitors = comp?.competitors || [];
      const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
      const away = competitors.find((c) => c.homeAway === "away") || competitors[1];

      return {
        id: event.id,
        date: event.date,
        round: roundFromCompetition(comp),
        region: regionFromCompetition(comp),
        home: normalizeSchoolName(home?.team?.displayName || home?.team?.shortDisplayName || "Home"),
        away: normalizeSchoolName(away?.team?.displayName || away?.team?.shortDisplayName || "Away"),
        homeSeed: Number(home?.seed || home?.curatedRank?.current || 0) || null,
        awaySeed: Number(away?.seed || away?.curatedRank?.current || 0) || null,
        homeScore: home?.score ?? null,
        awayScore: away?.score ?? null,
        broadcasts: broadcastNamesFromCompetition(comp),
        status: comp?.status?.type?.completed ? "Final" : (comp?.status?.type?.state === "in" ? "Live" : "Upcoming"),
        clock: comp?.status?.type?.shortDetail || ""
      };
    });

    res.json({
      source: "Live",
      updatedAt: new Date().toISOString(),
      games
    });
  } catch (err) {
    res.status(200).json({
      source: "Demo",
      updatedAt: new Date().toISOString(),
      games: []
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "ncaa-auction-backend" });
});

app.use(express.static(frontendDistDir));

app.get("*", async (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }

  try {
    await fs.access(path.join(frontendDistDir, "index.html"));
    res.sendFile(path.join(frontendDistDir, "index.html"));
  } catch {
    next();
  }
});

async function startServer() {
  if (!supabase) await loadCommentsFromDisk();
  app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
}

startServer().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
