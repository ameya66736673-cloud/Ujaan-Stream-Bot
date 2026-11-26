
const ADMIN_USERS = ["raj-m5l4n", "gm_variant_chess"]; // <-- Allowed to edit AI memory and manage the queue
const MAX_QUEUE_SIZE = 5; // Maximum players allowed in the queue at a time
const STREAMER_CHESS_USERNAME = "devilopyt"; // <-- Optional: put the streamer's Chess.com username here in lowercase
const MAX_CHAT_LENGTH = 195; // Safe buffer under YouTube Live Chat's 200-character limit
const API_TIMEOUT_MS = 4000; // Prevent slow external APIs from timing out chat bots

const STREAM_MEMORY = `
- Platform: YouTube Chess Stream playing on Chess.com
- Rules: Keep answers friendly, accurate, and under 2 sentences (max 190 characters).
`;

// ============================================================================
// UTILITY HELPERS
// ============================================================================

/**
 * Performs a fetch request with an abort timeout so slow third-party APIs
 * (Chess.com / Wikipedia) never hang chat bot responses.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Truncates text cleanly to fit YouTube Live Chat's 200-character limit.
 */
function truncateForChat(text, maxLen = MAX_CHAT_LENGTH) {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  const sliced = cleaned.slice(0, maxLen - 3);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? sliced.slice(0, lastSpace) : sliced) + "...";
}

/**
 * Validates that a Chess.com username has allowed characters and length.
 */
function isValidChessUsername(name) {
  return /^[a-zA-Z0-9_-]{3,25}$/.test(name);
}

/**
 * Verifies that a username both matches Chess.com formatting rules
 * and actually exists on Chess.com via the public API.
 */
async function verifyChessComUser(username) {
  if (!isValidChessUsername(username)) {
    return { valid: false, error: `Invalid Chess.com ID "${username}". Use 3-25 letters, numbers, _ or -.` };
  }
  try {
    const res = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}`,
      { headers: CHESS_HEADERS }
    );
    if (res.status === 404) {
      return { valid: false, error: `❌ Chess.com account "${username}" was not found. Check the spelling and try again.` };
    }
    if (!res.ok) {
      return { valid: false, error: `⚠️ Could not verify "${username}" on Chess.com right now. Please try again.` };
    }
    const data = await res.json();
    return { valid: true, username: data?.username || username };
  } catch (_) {
    return { valid: false, error: `⚠️ Chess.com verification timed out for "${username}". Please try again.` };
  }
}

// ============================================================================
// CHESS MODULE: Verified Knowledge Base + Chess.com API + Wikipedia REST API
// ============================================================================

const CHESS_FACTS_KB = `
[VERIFIED CHESS FACTS]
- Piece Values: Pawn=1, Knight=3, Bishop=3, Rook=5, Queen=9, King=invaluable.
- Special Rules:
  * Castling: King moves 2 squares toward a rook, rook jumps over king. Allowed only if neither piece has moved, squares between are empty, and king is not in, passing through, or landing in check.
  * En Passant: A pawn can capture an adjacent enemy pawn that just advanced 2 squares, only on the very next move.
  * Promotion: A pawn reaching the opposite back rank must promote to Queen, Rook, Bishop, or Knight.
- Draws: Stalemate (not in check, no legal moves), Threefold Repetition, 50-Move Rule (50 moves without pawn move or capture), Insufficient Material (K vs K, K+N vs K, K+B vs K), or Mutual Agreement.
- Time Controls: Bullet (<3 min), Blitz (3-10 min), Rapid (10-60 min), Classical (>60 min).
- FIDE Titles: GM (2500+ FIDE + 3 norms), IM (2400+), FM (2300+), CM (2200+); Women's: WGM (2300+), WIM (2200+), WFM (2100+), WCM (2000+).
- World Champions & Records: Reigning FIDE Classical World Champion is Gukesh Dommaraju (won in Dec 2024 at age 18, youngest undisputed champion; 2026 match vs Javokhir Sindarov). Magnus Carlsen holds the all-time highest FIDE rating (2882) and won the 2026 FIDE Freestyle Chess World Championship.
`;

const KNOWN_CHESS_PLAYERS = {
  magnus: "magnuscarlsen",
  carlsen: "magnuscarlsen",
  hikaru: "hikaru",
  nakamura: "hikaru",
  gotham: "gothamchess",
  gothamchess: "gothamchess",
  levy: "gothamchess",
  gukesh: "gukeshdommaraju",
  pragg: "rpraggnanandhaa",
  praggnanandhaa: "rpraggnanandhaa",
  arjun: "arjunerigaisi",
  erigaisi: "arjunerigaisi",
  nihal: "nihalsarin",
  vidit: "viditchess",
  fabiano: "fabianocaruana",
  caruana: "fabianocaruana",
  firouzja: "firouzja2003",
  alireza: "firouzja2003",
  anish: "anishgiri",
  giri: "anishgiri",
  danya: "danielnaroditsky",
  naroditsky: "danielnaroditsky",
  botez: "alexandrabotez",
  kramnik: "vladimirkramnik"
};

const CHESS_HEADERS = { "User-Agent": "StreamBot-ChessModule/1.0" };

function isChessQuestion(q) {
  return /\b(chess|elo|rating|ratings|peak|blitz|bullet|rapid|daily|puzzle|puzzles|opening|openings|gambit|defense|defence|sicilian|french|caro|italian|ruy|london|queen|king|rook|bishop|knight|pawn|mate|checkmate|stalemate|backrank|back[\s-]?rank|smothered|scholar|fool|legal'?s|fork|pin|skewer|discovered|windmill|zwischenzug|zugzwang|fianchetto|en[\s-]?passant|en[\s-]?prise|tempo|sacrifice|trap|variation|endgame|middlegame|castle|castling|promotion|draw|fide|gm|grandmaster|im|fm|champion|world champ|magnus|carlsen|hikaru|nakamura|gukesh|sindarov|ding|pragg|vishy|anand|kasparov|fischer|gotham|leaderboard|top players|game|games|win|won|lost|lose|streak|accuracy|tactic|tactics|theory|chess\.com)\b/i.test(q);
}

function extractTargetUsernames(question) {
  const qLower = question.toLowerCase();
  const targets = new Set();

  for (const [alias, chessUser] of Object.entries(KNOWN_CHESS_PLAYERS)) {
    const regex = new RegExp(`\\b${alias}\\b`, "i");
    if (regex.test(qLower)) {
      targets.add(chessUser);
    }
  }

  const explicitPatterns = [
    /(?:stats|rating|elo|peak|profile|games?)\s+(?:of|for)\s+@?([a-z0-9_-]{3,25})/gi,
    /@([a-z0-9_-]{3,25})/gi,
    /\b([a-z0-9_-]{3,25})'s\s+(?:stats|rating|elo|peak|blitz|bullet|rapid|game|games|opening)/gi
  ];

  const stopWords = new Set(["chess", "your", "his", "her", "my", "the", "a", "an", "this", "that", "streamer", "world", "fide"]);
  for (const pattern of explicitPatterns) {
    let match;
    while ((match = pattern.exec(question)) !== null) {
      const candidate = match[1].toLowerCase();
      if (!stopWords.has(candidate)) {
        targets.add(KNOWN_CHESS_PLAYERS[candidate] || candidate);
      }
    }
  }

  if (
    targets.size === 0 &&
    STREAMER_CHESS_USERNAME &&
    /\b(elo|rating|peak|blitz|bullet|rapid|last game|recent game|opening|puzzle|stats|record)\b/i.test(qLower)
  ) {
    targets.add(STREAMER_CHESS_USERNAME);
  }

  return Array.from(targets).slice(0, 2);
}

function formatModeStats(label, mode) {
  if (!mode) return null;
  const current = mode?.last?.rating;
  const best = mode?.best?.rating;
  const w = mode?.record?.win ?? 0;
  const l = mode?.record?.loss ?? 0;
  const d = mode?.record?.draw ?? 0;
  if (!current && !best) return null;
  return `${label}: ${current ?? "?"} (Peak ${best ?? current}, ${w}W/${l}L/${d}D)`;
}

function parseOpeningFromPgn(pgn) {
  if (!pgn) return null;
  const ecoUrlMatch = pgn.match(/\[ECOUrl\s+"https:\/\/www\.chess\.com\/openings\/([^"]+)"\]/i);
  if (ecoUrlMatch) {
    return ecoUrlMatch[1].split("?")[0].replace(/-/g, " ").slice(0, 45);
  }
  const ecoMatch = pgn.match(/\[ECO\s+"([^"]+)"\]/i);
  return ecoMatch ? `ECO ${ecoMatch[1]}` : null;
}

async function fetchRecentGamesSummary(username) {
  try {
    const archRes = await fetchWithTimeout(
      `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
      { headers: CHESS_HEADERS }
    );
    if (!archRes.ok) return null;
    const archData = await archRes.json();
    const archives = archData?.archives || [];
    if (archives.length === 0) return null;

    const latestUrl = archives[archives.length - 1];
    const gamesRes = await fetchWithTimeout(latestUrl, { headers: CHESS_HEADERS });
    if (!gamesRes.ok) return null;
    const gamesData = await gamesRes.json();
    const recent = (gamesData?.games || []).slice(-3).reverse();
    if (recent.length === 0) return null;

    const summaries = recent.map((g, idx) => {
      const isWhite = g.white?.username?.toLowerCase() === username.toLowerCase();
      const me = isWhite ? g.white : g.black;
      const opp = isWhite ? g.black : g.white;
      const color = isWhite ? "White" : "Black";
      const opening = parseOpeningFromPgn(g.pgn);
      const acc = isWhite ? g.accuracies?.white : g.accuracies?.black;
      const accStr = acc ? `, ${acc.toFixed(1)}% acc` : "";
      const openStr = opening ? `, ${opening}` : "";
      return `#${idx + 1} [${g.time_class} as ${color}] vs ${opp?.username || "?"} (${opp?.rating || "?"}): ${me?.result || "?"}${openStr}${accStr}`;
    });

    return `Recent Games: ${summaries.join(" | ")}`;
  } catch (_) {
    return null;
  }
}

async function fetchPlayerChessContext(username, includeGames) {
  const [profileRes, statsRes, gamesSummary] = await Promise.all([
    fetchWithTimeout(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`, { headers: CHESS_HEADERS }).catch(() => null),
    fetchWithTimeout(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`, { headers: CHESS_HEADERS }).catch(() => null),
    includeGames ? fetchRecentGamesSummary(username) : Promise.resolve(null)
  ]);

  if (!statsRes || !statsRes.ok) {
    return `Player "${username}" was not found on Chess.com.`;
  }

  const stats = await statsRes.json();
  const profile = profileRes && profileRes.ok ? await profileRes.json() : null;

  const title = profile?.title ? `${profile.title} ` : "";
  const name = profile?.name ? ` (${profile.name})` : "";
  const modes = [
    formatModeStats("Rapid", stats.chess_rapid),
    formatModeStats("Blitz", stats.chess_blitz),
    formatModeStats("Bullet", stats.chess_bullet),
    formatModeStats("Daily", stats.chess_daily)
  ].filter(Boolean);

  const puzzleBest = stats.puzzle_rush?.best?.score;
  const tacticsHighest = stats.tactics?.highest?.rating;
  if (tacticsHighest) modes.push(`Puzzles Peak: ${tacticsHighest}`);
  if (puzzleBest) modes.push(`Puzzle Rush Best: ${puzzleBest}`);

  const lines = [
    `Player ${title}${username}${name}: ${modes.length > 0 ? modes.join(" | ") : "No rated games yet"}`
  ];
  if (gamesSummary) lines.push(gamesSummary);

  return lines.join("\n");
}

async function fetchLeaderboardSummary() {
  try {
    const res = await fetchWithTimeout("https://api.chess.com/pub/leaderboards", { headers: CHESS_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const formatTop = (arr) =>
      (arr || []).slice(0, 5).map((p, i) => `#${i + 1} ${p.username} (${p.score})`).join(", ");
    return [
      `Chess.com Top Blitz: ${formatTop(data.live_blitz)}`,
      `Chess.com Top Bullet: ${formatTop(data.live_bullet)}`,
      `Chess.com Top Rapid: ${formatTop(data.live_rapid)}`
    ].join("\n");
  } catch (_) {
    return null;
  }
}

function extractWikiTopic(question) {
  return question
    .toLowerCase()
    .replace(/^(what is|what's|whats|who is|who's|explain|define|how does|how do|tell me about|meaning of|what are)\s+/i, "")
    .replace(/\b(a|an|the|in chess|chess|work|mean|means)\b/gi, " ")
    .replace(/[?!.,'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWikipediaChessFact(question, env) {
  try {
    const topic = extractWikiTopic(question);
    if (!topic || topic.length < 3) return null;

    const cacheKey = `wiki:${topic}`;
    if (env?.MEMORY) {
      const cached = await env.MEMORY.get(cacheKey).catch(() => null);
      if (cached) return cached;
    }

    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic + " chess")}&srlimit=1&format=json`;
    const searchRes = await fetchWithTimeout(searchUrl, { headers: CHESS_HEADERS });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const title = searchData?.query?.search?.[0]?.title;
    if (!title) return null;

    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    const summaryRes = await fetchWithTimeout(summaryUrl, { headers: CHESS_HEADERS });
    if (!summaryRes.ok) return null;

    const summaryData = await summaryRes.json();
    const extract = summaryData?.extract?.replace(/\s+/g, " ").trim();
    if (!extract) return null;

    const result = `[WIKIPEDIA: ${summaryData.title || title}]\n${extract.slice(0, 450)}`;
    if (env?.MEMORY) {
      await env.MEMORY.put(cacheKey, result, { expirationTtl: 604800 }).catch(() => {});
    }
    return result;
  } catch (_) {
    return null;
  }
}

async function buildChessContext(question, env) {
  if (!isChessQuestion(question)) return "";

  const qLower = question.toLowerCase();
  const usernames = extractTargetUsernames(question);
  const needsGames = /\b(last|recent|latest|previous|opening|openings|played|game|games|win|won|lost|lose|accuracy|streak)\b/i.test(qLower);
  const needsLeaderboard = /\b(leaderboard|leaderboards|top\s*\d*|#1|number one|highest rated|best on chess\.com)\b/i.test(qLower);
  const isConceptQuery = /\b(what is|what's|whats|who is|who's|explain|define|how does|how do|tell me about|meaning of|what are)\b/i.test(qLower) || usernames.length === 0;
  const isPureStatsQuery = /\b(rating|elo|peak|stats|last game|recent game|leaderboard)\b/i.test(qLower) && usernames.length > 0;

  const tasks = usernames.map((u) => fetchPlayerChessContext(u, needsGames));
  if (needsLeaderboard) tasks.push(fetchLeaderboardSummary());
  if (isConceptQuery && !isPureStatsQuery) tasks.push(fetchWikipediaChessFact(question, env));

  const liveResults = (await Promise.all(tasks)).filter(Boolean);
  const liveBlock = liveResults.length > 0 ? `[LIVE CHESS & WIKIPEDIA DATA]\n${liveResults.join("\n")}\n` : "";

  return `\n${CHESS_FACTS_KB}\n${liveBlock}`;
}

// ============================================================================
// CLOUDFLARE WORKER ENTRYPOINT
// ============================================================================

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const user = (url.searchParams.get("user") || "viewer").trim().toLowerCase().replace(/^@/, "");
      const remember = (url.searchParams.get("remember") || "").trim();
      const question = (url.searchParams.get("q") || "").trim();
      const cmd = (url.searchParams.get("cmd") || "").trim();
      const allowedAdmins = ADMIN_USERS.map((u) => u.toLowerCase().trim());

      // =========================================================
      // 1. AI MEMORY MANAGEMENT (!remember -- Admin Only)
      // =========================================================
      if (remember) {
        if (!allowedAdmins.includes(user)) {
          return new Response("Access denied: You do not have permission to edit permanent memory.");
        }
        if (!env || !env.MEMORY) {
          return new Response("Setup needed: Bind a KV Namespace named MEMORY in Cloudflare Settings -> Bindings.");
        }

        const lower = remember.toLowerCase();
        const existing = (await env.MEMORY.get("permanent_facts")) || "";
        const lines = existing ? existing.split("\n").filter(Boolean) : [];

        if (lower === "clear") {
          await env.MEMORY.delete("permanent_facts");
          return new Response("All permanent chat memory has been deleted.");
        }
        if (lower === "list" || lower === "show") {
          if (!lines.length) return new Response("No custom facts saved yet.");
          return new Response(
            truncateForChat("Saved facts: " + lines.map((l, i) => `[${i + 1}] ${l.replace(/^- /, "")}`).join(" | "))
          );
        }
        if (lower.startsWith("overwrite ")) {
          const newFact = remember.slice(10).trim();
          await env.MEMORY.put("permanent_facts", `- ${newFact}`);
          return new Response(truncateForChat(`Memory overwritten with: "${newFact}"`));
        }
        if (lower.startsWith("delete ") || lower.startsWith("remove ")) {
          const target = remember.replace(/^(delete|remove)\s+/i, "").trim();
          const idx = parseInt(target, 10) - 1;
          if (!isNaN(idx) && idx >= 0 && idx < lines.length) {
            const removed = lines.splice(idx, 1);
            await env.MEMORY.put("permanent_facts", lines.join("\n"));
            return new Response(truncateForChat(`Deleted fact [${idx + 1}]: "${removed[0].replace(/^- /, "")}"`));
          }
          const filtered = lines.filter((l) => !l.toLowerCase().includes(target.toLowerCase()));
          await env.MEMORY.put("permanent_facts", filtered.join("\n"));
          return new Response(`Deleted facts matching "${target}".`);
        }

        lines.push(`- ${remember}`);
        await env.MEMORY.put("permanent_facts", lines.join("\n"));
        return new Response(truncateForChat(`Saved fact [${lines.length}]: "${remember}"`));
      }

      // =========================================================
      // 2. AI CHATBOT (!ask & !hello via ?q=...)
      // =========================================================
      if (question) {
        if (!env || !env.AI) {
          return new Response("Setup needed: Add a Workers AI binding named AI in Cloudflare Settings -> Bindings.");
        }

        const [extraFacts, savedHistory, chessContext] = await Promise.all([
          env.MEMORY ? env.MEMORY.get("permanent_facts").then((v) => v || "").catch(() => "") : Promise.resolve(""),
          env.MEMORY ? env.MEMORY.get(`chat:${user}`).catch(() => null) : Promise.resolve(null),
          buildChessContext(question, env)
        ]);

        let history = [];
        if (savedHistory) {
          try {
            history = JSON.parse(savedHistory);
          } catch (_) {}
        }

        const chessInstruction = chessContext
          ? "\nFor chess questions, rely strictly on [VERIFIED CHESS FACTS] and [LIVE CHESS & WIKIPEDIA DATA] below--do not invent ratings, game results, or rules."
          : "";

        const messages = [
          {
            role: "system",
            content: `You are a helpful YouTube chat bot. Use these stream facts when relevant:\n${STREAM_MEMORY}\n${extraFacts}${chessContext}${chessInstruction}\nYou are replying to viewer "${user}". Reply in plain text only, under 190 characters, with no line breaks.`
          },
          ...history,
          { role: "user", content: question }
        ];

        const aiRes = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          messages,
          max_tokens: 90
        });

        const rawReply = aiRes?.response || aiRes?.choices?.[0]?.message?.content || "No answer generated.";
        const reply = truncateForChat(rawReply, MAX_CHAT_LENGTH);

        if (env.MEMORY) {
          try {
            const updated = [...history, { role: "user", content: question }, { role: "assistant", content: reply }].slice(-6);
            await env.MEMORY.put(`chat:${user}`, JSON.stringify(updated), { expirationTtl: 86400 });
          } catch (_) {}
        }

        return new Response(reply);
      }

      // =========================================================
      // 3. SAVED CHESS.COM IDs & VIEWER QUEUE
      // =========================================================
      if (!env || !env.MEMORY) {
        return new Response("Setup needed: Bind a KV Namespace named MEMORY in Cloudflare Settings -> Bindings.");
      }

      const rawState = await env.MEMORY.get("viewer_queue");
      const state = rawState ? JSON.parse(rawState) : { isOpen: true, list: [] };

      const cleanArg = (val) => {
        const cleaned = (val || "").trim().replace(/^@/, "");
        // Ignore unreplaced Streamlabs/Nightbot placeholders like {1}, {1:2}, or $(1)
        if (!cleaned || /^\{[^}]+\}$/.test(cleaned) || /^\$\([^)]+\)$/.test(cleaned)) return "";
        return cleaned;
      };

      const parts = (cmd || "list").split(/\s+/).filter(Boolean);
      const action = (parts[0] || "list").toLowerCase();
      const arg = cleanArg(parts[1]);
      const arg2 = cleanArg(parts[2]);

      const saveState = async () => {
        await env.MEMORY.put("viewer_queue", JSON.stringify(state));
      };

      // Save or view a viewer's Chess.com ID from chat:
      // - Viewer: !setid <chess_id> (or !link <chess_id>)
      // - Viewer check: !myid (or !setid with no args)
      // - Admin for another user: !setid <chat_user> <chess_id>
      if (["setid", "link", "chessid", "myid"].includes(action)) {
        if (action === "myid" || !arg) {
          const saved = await env.MEMORY.get(`chessid:${user}`);
          return new Response(
            saved
              ? `♟️ ${user}, your saved Chess.com ID is: ${saved}. Just type !join to enter the queue!`
              : `${user}, you don't have a saved Chess.com ID yet. Use !setid <chess.com_username> to save it.`
          );
        }

        // Admin setting another viewer's Chess.com ID: !setid <targetUser> <chessId>
        let targetUser = user;
        let chessId = arg;
        if (arg2) {
          if (!allowedAdmins.includes(user)) {
            return new Response("Access denied: Only admins can save a Chess.com ID for another viewer.");
          }
          targetUser = arg.toLowerCase();
          chessId = arg2;
        }

        const check = await verifyChessComUser(chessId);
        if (!check.valid) {
          return new Response(check.error);
        }

        await env.MEMORY.put(`chessid:${targetUser}`, check.username);

        // If the user is already in the queue, update their queued Chess.com ID immediately
        const queuedIdx = state.list.findIndex((p) => p.twitch === targetUser);
        if (queuedIdx !== -1) {
          state.list[queuedIdx].chess = check.username;
          await saveState();
        }

        return new Response(
          `✅ Saved Chess.com ID for ${targetUser}: ${check.username}. Next time, just type !join!`
        );
      }

      // Join the queue: !join (uses saved Chess.com ID) OR !join <chess.com_username> (verifies & saves it)
      if (action === "join") {
        if (!state.isOpen) return new Response("The playing queue is currently closed!");
        const existingIdx = state.list.findIndex((p) => p.twitch === user);

        if (existingIdx === -1 && state.list.length >= MAX_QUEUE_SIZE) {
          return new Response(`⚠️ Queue is full (${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE})! Wait for !next to open a spot.`);
        }

        const savedId = await env.MEMORY.get(`chessid:${user}`);
        let chessName = savedId;
        let newlySaved = false;

        // If an explicit Chess.com username was provided (ignoring Streamlabs auto-filled chat username),
        // verify it on Chess.com before saving to KV memory and adding to the queue.
        if (arg && arg.toLowerCase() !== user) {
          const check = await verifyChessComUser(arg);
          if (!check.valid) {
            return new Response(check.error);
          }
          chessName = check.username;
          if (!savedId || savedId.toLowerCase() !== chessName.toLowerCase()) {
            await env.MEMORY.put(`chessid:${user}`, chessName);
            newlySaved = true;
          }
        } else if (!chessName) {
          // Never fall back to the viewer's YouTube username as a Chess.com ID
          return new Response(
            `❌ ${user}, you don't have a saved Chess.com ID yet. Use !join <chess.com_username> to join & save it.`
          );
        }

        const savedTip = newlySaved ? " ID saved! Next time just type !join." : "";

        if (existingIdx !== -1) {
          state.list[existingIdx].chess = chessName;
          await saveState();
          return new Response(
            truncateForChat(
              `${user} is already in the queue at #${existingIdx + 1}/${MAX_QUEUE_SIZE} (Chess.com: ${chessName}).${savedTip}`
            )
          );
        }

        state.list.push({ twitch: user, chess: chessName });
        await saveState();
        return new Response(
          truncateForChat(
            `✅ ${user} joined #${state.list.length}/${MAX_QUEUE_SIZE} (Chess.com: ${chessName})!${savedTip}`
          )
        );
      }

      // Leave the queue: !leave
      if (action === "leave") {
        const idx = state.list.findIndex((p) => p.twitch === user);
        if (idx === -1) return new Response(`${user}, you are not currently in the queue.`);
        state.list.splice(idx, 1);
        await saveState();
        return new Response(`👋 ${user} has left the playing queue (${state.list.length}/${MAX_QUEUE_SIZE}).`);
      }

      // Admin-only: Pop and remove the #1 player (!next or !queue next)
      if (action === "next") {
        if (!allowedAdmins.includes(user)) {
          return new Response("Access denied: Only admins can advance the queue.");
        }
        if (!state.list.length) return new Response("The playing queue is currently empty!");

        const nextPlayer = state.list.shift();
        await saveState();
        const upNext = state.list[0]
          ? ` | Up next: @${state.list[0].twitch} (${state.list.length}/${MAX_QUEUE_SIZE})`
          : ` | Queue is now empty (0/${MAX_QUEUE_SIZE})`;
        return new Response(
          truncateForChat(`♟️ Up now: ${nextPlayer.twitch} (Chess.com: ${nextPlayer.chess})!${upNext}`)
        );
      }

      // Admin-only: Clear, Open, Close, or Remove a specific user
      if (["clear", "open", "close", "remove", "kick"].includes(action)) {
        if (!allowedAdmins.includes(user)) {
          return new Response("Access denied: Only admins can manage the queue.");
        }
        if (action === "clear") {
          state.list = [];
          await saveState();
          return new Response(`🗑️ The playing queue has been cleared (0/${MAX_QUEUE_SIZE}).`);
        }
        if (action === "open") {
          state.isOpen = true;
          await saveState();
          return new Response("🟢 Queue is OPEN! Use !setid <chess_id> then !join to enter.");
        }
        if (action === "close") {
          state.isOpen = false;
          await saveState();
          return new Response("🔴 The playing queue is now CLOSED.");
        }
        if (action === "remove" || action === "kick") {
          if (!arg) return new Response("Usage: !queue remove <username>");
          const target = arg.toLowerCase();
          const before = state.list.length;
          state.list = state.list.filter((p) => p.twitch !== target && p.chess.toLowerCase() !== target);
          await saveState();
          return new Response(
            state.list.length < before
              ? `Removed ${arg} from the queue (${state.list.length}/${MAX_QUEUE_SIZE}).`
              : `Player "${arg}" was not found in the queue.`
          );
        }
      }

      // Default: Show the current queue (!queue or !queue list)
      if (!state.list.length) {
        return new Response(`Queue is empty (0/${MAX_QUEUE_SIZE} -- ${state.isOpen ? "OPEN, type !join to play" : "CLOSED"}).`);
      }

      const preview = state.list
        .map((p, i) => `#${i + 1} ${p.twitch}${p.chess !== p.twitch ? ` (${p.chess})` : ""}`)
        .join(" | ");
      return new Response(truncateForChat(`📋 Queue (${state.list.length}/${MAX_QUEUE_SIZE}): ${preview}`));
    } catch (err) {
      return new Response(`Worker error: ${err.message}`);
    }
  }
};
