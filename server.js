const express = require("express");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const axios = require("axios");
const cors = require("cors");
const cheerio = require("cheerio");

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());
app.use(express.json());
// Render (and most PaaS hosts) assign the listen port via $PORT at runtime.
const PORT = process.env.PORT || 3011;

const PUPPETEER_LAUNCH_OPTIONS = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    // Containers default to a tiny /dev/shm, which crashes Chrome without this.
    "--disable-dev-shm-usage",
  ],
};

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});
// AtCoder's affiliation search does a case-sensitive substring match, so a
// single query (and especially the wrong casing) misses students who typed
// their affiliation differently. We fan out over the common variants and
// re-verify every result row ourselves (see AUST_PATTERN in the route below)
// since the search also happily returns unrelated schools like "HAUST"/"BAUST".
const AUST_AFFILIATIONS = ["AUST", "aust", "Ahsanullah", "ahsanullah"];

const RATINGS_URL = (affiliation) =>
  `https://atcoder.jp/ranking?f.Country=&f.UserScreenName=&f.Affiliation=${encodeURIComponent(
    affiliation
  )}&f.BirthYearLowerBound=0&f.BirthYearUpperBound=9999&f.RatingLowerBound=0&f.RatingUpperBound=9999&f.HighestRatingLowerBound=0&f.HighestRatingUpperBound=9999&f.CompetitionsLowerBound=0&f.CompetitionsUpperBound=9999&f.WinsLowerBound=0&f.WinsUpperBound=9999&contestType=algo`;

const ITEMS_PER_PAGE = 400;
const INSTITUTION_ENCODED =
  "Ahsanullah%20University%20of%20Science%20and%20Technology";

// ---------------- STANDINGS ----------------
app.get("/codechef_standings", async (req, res) => {
  try {
    const inputCode = req.query.code;
    if (!inputCode) {
      return res.status(400).json({ error: "Missing code query parameter" });
    }

    const DIVISIONS = [
      { code: `START${inputCode}A`, divNum: 1 },
      { code: `START${inputCode}B`, divNum: 2 },
      { code: `START${inputCode}C`, divNum: 3 },
      { code: `START${inputCode}D`, divNum: 4 },
    ];

    const browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);

    let allStandings = [];
    try {
      for (const { code, divNum } of DIVISIONS) {
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
        );

        const url = `https://www.codechef.com/rankings/${code}?filterBy=Institution%3D${INSTITUTION_ENCODED}&itemsPerPage=${ITEMS_PER_PAGE}&order=asc&page=1&sortBy=rank`;

        /*console.log(
          `Fetching Div ${divNum} - Page 1 - Institution: ${decodeURIComponent(
            INSTITUTION_ENCODED
          )}`
        );*/

        await page.goto(url, { waitUntil: "networkidle2" });
        await page.waitForSelector("table");

        const standingsPage = await page.evaluate((divNum) => {
          const rows = document.querySelectorAll("table tbody tr");
          const data = [];

          rows.forEach((row) => {
            const cols = row.querySelectorAll("td");

            if (cols.length >= 3) {
              let rank = cols[0]?.innerText.trim().split("\n").pop() || "";

              let username = "";
              let rating = "";

              const usernameCell = cols[1];
              const usernameSpan =
                usernameCell.querySelector("a") ||
                usernameCell.querySelector("span") ||
                usernameCell;

              const usernameRaw = usernameSpan.textContent.trim();

              const match = usernameRaw.match(/^(\d+★)?\s*(.*)$/);
              if (match) {
                rating = match[1] || "";
                username = match[2].trim();
              } else {
                username = usernameRaw;
              }

              let totalScore = cols[2]?.innerText.trim().split("\n").pop() || "";

              if (rank && username && totalScore) {
                data.push({
                  Div: divNum,
                  rank,
                  username,
                  rating,
                  totalScore,
                });
              }
            }
          });

          return data;
        }, divNum);

        await page.close();
        allStandings = allStandings.concat(standingsPage);
      }
    } finally {
      await browser.close();
    }

    res.json({ standings: allStandings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch standings" });
  }
});

app.get("/codechef_ratings_all", async (req, res) => {
  const ITEMS_TO_FETCH = 500;
  const url = `https://www.codechef.com/ratings/all?filterBy=Institution%3D${INSTITUTION_ENCODED}&itemsPerPage=${ITEMS_TO_FETCH}&order=asc&page=1&sortBy=global_rank`;

  let browser = null;
  try {
    browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/114.0.0.0 Safari/537.36"
    );

    ///console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait until table rows appear
    await page.waitForFunction(
      () => {
        const rows = document.querySelectorAll("table tbody tr");
        return rows.length > 0;
      },
      { timeout: 15000 }
    );

    // Evaluate page and extract debug info + parsed fields
    const rowsDebug = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows.map((row, rowIndex) => {
        const cols = Array.from(row.querySelectorAll("td")).map((c) => ({
          innerText: c.innerText,
          innerHTML: c.innerHTML,
          className: c.className || null,
        }));

        // 1) Try to find username from a profile link (typical)
        let username = "";
        const profileLink =
          row.querySelector(
            'a[href*="/users/"], a[href*="/profile/"], a.username'
          ) || row.querySelector("a"); // fallback to any anchor
        if (profileLink) {
          username = profileLink.innerText.trim();
        } else {
          const textCandidates = row.innerText
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length && !/^#?\d+$/.test(s)); // remove pure numbers
          username =
            textCandidates.find(
              (t) => !/University|Institute|College|School/i.test(t)
            ) ||
            textCandidates[0] ||
            "";
          username = username.trim();
        }

        // 2) Extract star (like "3★" or "3 ★")
        let rating_star = "";
        const starMatch = row.innerText.match(/(\d+)\s*★/);
        if (starMatch) {
          rating_star = starMatch[1] + "★";
        } else {
          const starEl = row.querySelector(
            "span[class*='star'], i[class*='star'], .rating-star, .stars"
          );
          if (starEl && /★/.test(starEl.innerText)) {
            const m = starEl.innerText.match(/(\d+)\s*★/);
            rating_star = m ? m[1] + "★" : starEl.innerText.trim();
          } else {
            const tokenMatch = row.innerText.match(/(\d+★)/);
            rating_star = tokenMatch ? tokenMatch[1] : "";
          }
        }

        // 🔹 Remove star prefix from username if present
        if (rating_star && username.startsWith(rating_star)) {
          username = username.slice(rating_star.length).trim();
        }

        // 3) Global / Country / Rating digits from columns (keep raw values and parsed)
        const globalRaw = cols[1] ? cols[1].innerText.trim() : "";
        const globalMatch =
          globalRaw.match(/#\s*(\d+)/) || globalRaw.match(/(\d+)/);
        const global_rank = globalMatch ? globalMatch[1] : "";

        const countryRaw = cols[2] ? cols[2].innerText.trim() : "";
        const countryMatch =
          countryRaw.match(/#\s*(\d+)/) || countryRaw.match(/(\d+)/);
        const country_rank = countryMatch ? countryMatch[1] : "";

        const ratingRaw = cols[3] ? cols[3].innerText.trim() : "";
        const ratingMatch = ratingRaw.match(/(\d+)/);
        const rating_digit = ratingMatch ? ratingMatch[1] : "";

        return {
          rowIndex,
          cols,
          // parsed fields
          username,
          rating_star,
          global_raw: globalRaw,
          global_rank,
          country_raw: countryRaw,
          country_rank,
          rating_raw: ratingRaw,
          rating_digit,
          rowInnerText: row.innerText,
          rowInnerHTML: row.innerHTML,
        };
      });
    });

    /// console.log(`DEBUG: scraped ${rowsDebug.length} rows. Sample (first 3):`);
    /// console.log(JSON.stringify(rowsDebug.slice(0, 3), null, 2));

    // Convert debug rows to the desired simple shape
    const ratings = rowsDebug.map((r) => ({
      username: r.username,
      global_rank: r.global_rank,
      country_rank: r.country_rank,
      rating_digit: r.rating_digit,
      rating_star: r.rating_star,
    }));

    // Close browser and respond
    await browser.close();
    browser = null;

    res.json({ ratings_all: ratings, debug: rowsDebug });
  } catch (error) {
    ///console.error("Error scraping ratings_all:", error);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        ///console.error("Error closing browser after failure:", e);
      }
    }
    res.status(500).json({
      error: "Failed to fetch ratings_all",
      details: error && error.message ? error.message : String(error),
    });
  }
});
// Fetch AtCoder ratings for AUST
app.get("/atcoder_ratings_all", async (req, res) => {
  try {
    const browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);

    let combinedRatings = [];

    try {
      for (const affiliation of AUST_AFFILIATIONS) {
        const page = await browser.newPage();
        const url = RATINGS_URL(affiliation);

        ///console.log(`Scraping ratings for affiliation: ${affiliation}`);

        await page.goto(url, { waitUntil: "networkidle2" });
        await page.waitForSelector("table");

        const ratings = await page.evaluate(() => {
          // The filter sidebar on this page is also a <table>, so a plain
          // "table tbody tr" selector picks up its (blank) rows too. Anchoring
          // on the real ranking row's username link skips those for free, and
          // re-checking each row's own affiliation text (rather than trusting
          // AtCoder's case-sensitive substring search) keeps out unrelated
          // schools such as "HAUST" or "BAUST" that also contain "aust".
          const AUST_PATTERN = /\bahsanullah\b|\baust\b/i;
          const rows = Array.from(document.querySelectorAll("table tbody tr"));

          return rows
            .map((row) => {
              const usernameLink = row.querySelector("a.username");
              if (!usernameLink) return null;

              const affiliationEl = row.querySelector(".ranking-affiliation");
              const affiliation = affiliationEl
                ? affiliationEl.textContent.trim()
                : "";
              if (!AUST_PATTERN.test(affiliation)) return null;

              const cols = row.querySelectorAll("td");
              const username = usernameLink.textContent.trim();

              // Extract rating (usually last column, index 4)
              const rating = cols[4]?.innerText.trim() || "";

              return { username, rating };
            })
            .filter(Boolean);
        });

        combinedRatings = combinedRatings.concat(ratings);
        await page.close();
      }
    } finally {
      await browser.close();
    }

    // Remove duplicates by username, keep max rating
    const uniqueMap = new Map();
    for (const user of combinedRatings) {
      if (!uniqueMap.has(user.username)) {
        uniqueMap.set(user.username, user);
      } else {
        const existing = uniqueMap.get(user.username);
        if (parseInt(user.rating) > parseInt(existing.rating)) {
          uniqueMap.set(user.username, user);
        }
      }
    }

    const mergedRatings = Array.from(uniqueMap.values());

    res.json({ ratings_all_atcoder: mergedRatings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch Atcoder ratings" });
  }
});

app.get("/atcoder_standings", async (req, res) => {
  const contestId = req.query.contestId;
  const handlesParam = req.query.handles;

  if (!contestId) {
    return res
      .status(400)
      .json({ error: "Missing 'contestId' query parameter" });
  }

  if (!handlesParam) {
    return res.status(400).json({ error: "Missing 'handles' query parameter" });
  }

  const atcoderHandles = handlesParam
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  let fullContestName = "";
  const prefix = contestId.slice(0, 3).toLowerCase();
  const suffix = contestId.slice(3);

  if (prefix === "abc") {
    fullContestName = `AtCoder Beginner Contest ${suffix}`;
  } else if (prefix === "arc") {
    fullContestName = `AtCoder Regular Contest ${suffix}`;
  } else if (prefix === "ahc") {
    fullContestName = `AtCoder Heuristic Contest ${suffix}`;
  } else if (prefix === "agc") {
    fullContestName = `AtCoder Grand Contest ${suffix}`;
  } else {
    return res
      .status(400)
      .json({ error: "Invalid contestId prefix. Use abc, arc, or ahc." });
  }
  const results = [];

  try {
    const browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);

    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      );

      for (let handle of atcoderHandles) {
        try {
          const url = `https://atcoder.jp/users/${handle}/history`;
          ///console.log(`🔍 Scraping history for: ${handle}`);
          await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

          const contests = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("table tbody tr"));
            return rows.map((row) => {
              const cells = row.querySelectorAll("td");
              return {
                contestDate: cells[0]?.innerText.trim(), // Ignored later
                contestName: cells[1]?.innerText.trim(),
                rank: cells[2]?.innerText.trim(),
                performance: cells[3]?.innerText.trim(),
                newRating: cells[4]?.innerText.trim(),
                diff: cells[5]?.innerText.trim(),
              };
            });
          });

          const matched = contests.find((c) =>
            c.contestName.includes(fullContestName)
          );
          if (matched) {
            results.push({
              handle,
              contestName: matched.contestName,
              rank: matched.rank,
              performance: matched.performance,
              newRating: matched.newRating,
              diff: matched.diff,
            });
          }
        } catch (err) {
          console.error(`❌ Failed for ${handle}:`, err.message);
        }
      }
    } finally {
      await browser.close();
    }

    res.json({ contestId, fullContestName, results });
  } catch (err) {
    console.error("❌ Failed to launch browser for AtCoder standings:", err.message);
    res.status(500).json({ error: "Failed to fetch AtCoder standings" });
  }
});

app.get("/codeforces_ratings_all", async (req, res) => {
  try {
    const ORG_NAMES = [
      "Ahsanullah University of Science and Technology",
      "AUST",
    ];

    // Codeforces' own activeOnly=true flag is much stricter than "active in the
    // last few months" — empirically it only keeps users who competed in the
    // last few weeks, which cut AUST's list down to ~1/3 of its real size.
    // activeOnly=false (the default) still excludes truly retired accounts
    // while keeping everyone who has a current rating, which matches what we
    // actually want here.
    const apiUrl = `https://codeforces.com/api/user.ratedList?activeOnly=false`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.status !== "OK") {
      throw new Error("Codeforces API returned an error");
    }

    const result = data.result;

    // Filter and merge users from both organizations
    const mergedUsers = result
      .filter(
        (user) =>
          user.organization &&
          user.rank !== "-" &&
          ORG_NAMES.some(
            (org) =>
              user.organization.trim().toLowerCase() === org.toLowerCase()
          )
      )
      .map((u) => ({
        username: u.handle || "-",
        contestParticipated:
          u.contestCount != null ? String(u.contestCount) : "0",
        rating: u.rating != null ? String(u.rating) : "0",
        maxRating: u.maxRating != null ? String(u.maxRating) : "0",
        rankTitle: u.rank || "-",
        organization: u.organization || "",
        contribution: u.contribution != null ? u.contribution : 0,
        lastOnline: u.lastOnlineTimeSeconds
          ? new Date(u.lastOnlineTimeSeconds * 1000).toISOString()
          : null,
      }));

    res.json({ ratings_all_codeforces: mergedUsers });
  } catch (err) {
    console.error("❌ Error fetching Codeforces data:", err);
    res.status(500).json({
      error: "Failed to fetch Codeforces ratings",
      details: err.message,
    });
  }
});
app.get("/codeforces_inactive_included", async (req, res) => {
  try {
    const ORG_NAMES = [
      "Ahsanullah University of Science and Technology",
      "AUST",
    ];

    // Fetch all rated users from Codeforces API
    const apiUrl = `https://codeforces.com/api/user.ratedList?includeRetired=true`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.status !== "OK") {
      throw new Error("Codeforces API returned an error");
    }

    const result = data.result;

    // Filter and merge users from both organizations
    const mergedUsers = result
      .filter(
        (user) =>
          user.organization &&
          user.rank !== "-" &&
          ORG_NAMES.some(
            (org) =>
              user.organization.trim().toLowerCase() === org.toLowerCase()
          )
      )
      .map((u) => ({
        username: u.handle || "-",
        contestParticipated:
          u.contestCount != null ? String(u.contestCount) : "0",
        rating: u.rating != null ? String(u.rating) : "0",
        maxRating: u.maxRating != null ? String(u.maxRating) : "0",
        rankTitle: u.rank || "-",
        organization: u.organization || "",
        contribution: u.contribution != null ? u.contribution : 0,
        lastOnline: u.lastOnlineTimeSeconds
          ? new Date(u.lastOnlineTimeSeconds * 1000).toISOString()
          : null,
      }));

    res.json({ ratings_all_codeforces: mergedUsers });
  } catch (err) {
    console.error("❌ Error fetching Codeforces data:", err);
    res.status(500).json({
      error: "Failed to fetch Codeforces ratings",
      details: err.message,
    });
  }
});

const CODEFORCES_AUST_ORG_NAMES = [
  "Ahsanullah University of Science and Technology",
  "AUST",
];

app.get("/codeforces_standings/:contestId", async (req, res) => {
  const contestId = req.params.contestId;
  // Codeforces now rejects anonymous requests to non-gym contest.standings
  // that include any extra parameter (from/count/showUnofficial) with HTTP 400.
  // A bare contestId call already returns the full official standings.
  const url = `https://codeforces.com/api/contest.standings?contestId=${contestId}`;
  const ratedListUrl =
    "https://codeforces.com/api/user.ratedList?includeRetired=true";

  try {
    const [response, ratedListResponse] = await Promise.all([
      axios.get(url),
      axios.get(ratedListUrl),
    ]);
    const data = response.data;

    if (data.status !== "OK") {
      return res
        .status(404)
        .json({ error: "Contest not found or failed to fetch standings" });
    }

    const austSet = new Set();
    if (ratedListResponse.data.status === "OK") {
      for (const user of ratedListResponse.data.result) {
        if (
          user.organization &&
          CODEFORCES_AUST_ORG_NAMES.some(
            (org) => user.organization.trim().toLowerCase() === org.toLowerCase()
          )
        ) {
          austSet.add(user.handle.toLowerCase());
        }
      }
    }

    const rows = data.result.rows;
    const contestName = data.result.contest.name;
    const globalStandings = [];
    const austStandings = [];

    let austPointsSum = 0;
    let austCount = 0;

    for (const row of rows) {
      const handle = row.party.members[0].handle;
      const rank = row.rank;
      const points = row.points || 0;
      const penalty = row.penalty || null;
      const participant = { handle, rank, points, penalty };
      globalStandings.push(participant);

      if (austSet.has(handle.toLowerCase())) {
        austStandings.push(participant);
        austPointsSum += points;
        austCount++;
      }
    }

    const austAvg = austCount
      ? Number((austPointsSum / austCount).toFixed(2))
      : null;

    return res.json({
      contest_name: contestName,
      global_standings: globalStandings,
      aust_standings: austStandings,
      aust_avg: austAvg,
    });
  } catch (err) {
    console.error("Error fetching Codeforces standings:", err.message);
    return res
      .status(500)
      .json({ error: "Failed to fetch Codeforces standings" });
  }
});

async function scrapeCodeforces() {
  try {
    console.log("[Codeforces] Fetching with API...");

    const apiUrl = "https://codeforces.com/api/contest.list";
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (data.status !== "OK") {
      throw new Error("Codeforces API returned an error");
    }

    const contests = data.result
      .filter((contest) => contest.phase === "BEFORE")
      .map((contest) => {
        const contestId = contest.id;
        const contestName = contest.name.trim();
        const writers = [];

        const startTimeDate = new Date(contest.startTimeSeconds * 1000);

        // Get ISO string: "2025-11-07T19:00:00.000Z"
        let iso = startTimeDate.toISOString();

        // Remove milliseconds and replace T with space
        let startTime = iso.replace(/\.\d{3}Z$/, "+0000").replace("T", " ");

        ///console.log(startTime);
        // "2025-11-07 19:00:00+0000"

        const hours = Math.floor(contest.durationSeconds / 3600);
        const minutes = Math.floor((contest.durationSeconds % 3600) / 60);
        const length = `${hours.toString().padStart(2, "0")}:${minutes
          .toString()
          .padStart(2, "0")}`;

        const status = "Before Start";
        const now = Math.floor(Date.now() / 1000);
        const diff = contest.startTimeSeconds - now;

        let extra;
        if (diff <= 0) {
          extra = "Starting soon";
        } else {
          const days = Math.floor(diff / (24 * 3600));
          const hours = Math.floor((diff % (24 * 3600)) / 3600);
          const minutes = Math.floor((diff % 3600) / 60);

          let parts = [];
          if (days > 0) parts.push(`${days}d`);
          if (hours > 0) parts.push(`${hours}h`);
          if (minutes > 0) parts.push(`${minutes}m`);

          extra = "Starts in " + parts.join(" ");
        }

        return {
          platform: "Codeforces",
          contestId,
          contestName,
          writers,
          startTime,
          length,
          status,
          extra,
        };
      });

    console.log("[Codeforces] Contests fetched:", contests.length);
    return contests;
  } catch (error) {
    console.error("[Codeforces] Error:", error.message);
    return [];
  }
}

async function scrapeCodeChef() {
  try {
    console.log("[CodeChef] Fetching with Puppeteer...");
    const browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);

    let contests;
    try {
      const page = await browser.newPage();

      // Set user agent to look like a normal browser
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      );

      await page.goto("https://www.codechef.com/contests", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // Wait for the actual contest rows to render, not just the (empty) outer
      // container — CodeChef mounts the container first and fills rows in
      // asynchronously, so waiting on the container alone races with a 0-result read.
      try {
        await page.waitForSelector("div._data__container_14pun_533", {
          timeout: 15000,
        });
      } catch (e) {
        console.warn("[CodeChef] No contest rows appeared within timeout");
      }

      contests = await page.evaluate(() => {
        const contestsData = [];
        const container = document.querySelector(
          "div._dataTable__container_14pun_417"
        );
        if (!container) return contestsData;

        const contestGroups = container.querySelectorAll(
          "div._flex__container_14pun_528"
        );
        contestGroups.forEach((group) => {
          const contests = group.querySelectorAll(
            "div._data__container_14pun_533"
          );
          contests.forEach((contest) => {
            const anchor = contest.querySelector("a");
            const nameSpan = anchor ? anchor.querySelector("span") : null;
            const contestName = nameSpan ? nameSpan.innerText.trim() : null;
            const contestUrl = anchor ? anchor.href : null;

            const timerDiv = contest.querySelector(
              "div._timer__container_14pun_590"
            );
            let startTime = "";
            if (timerDiv) {
              const timeParts = Array.from(timerDiv.querySelectorAll("p"))
                .map((p) => p.innerText.trim())
                .join(" ");
              startTime = `Starts in ${timeParts}`;
            }

            if (contestName && startTime) {
              contestsData.push({
                platform: "CodeChef",
                contestName,
                startTime,
                contestUrl,
              });
            }
          });
        });

        return contestsData;
      });
    } finally {
      await browser.close();
    }

    console.log("[CodeChef] Contests fetched:", contests.length);
    return contests;
  } catch (error) {
    console.error("[CodeChef] Error:", error.message);
    return [];
  }
}

// AtCoder scraping (axios + cheerio)
async function scrapeAtCoder() {
  try {
    console.log("[AtCoder] Fetching...");
    const { data } = await axios.get("https://atcoder.jp/contests/");
    const $ = cheerio.load(data);
    const contests = [];

    $("h3").each((_, el) => {
      const heading = $(el).text().trim();

      if (heading === "Upcoming Contests") {
        const table = $(el).next("div").find("table");
        if (!table.length) {
          console.warn("[AtCoder] No table found after heading");
          return;
        }

        table.find("tbody tr").each((_, tr) => {
          const tds = $(tr).find("td");
          const rawName = tds.eq(1).text().trim();
          const cleanName = rawName
            .replace(
              /[^\x20-\x7E\u4e00-\u9fa5\u3040-\u309F\u30A0-\u30FF\u3000-\u303F\uFF00-\uFFEF]+/g,
              ""
            )
            .replace(/\s+/g, " ")
            .trim();

          const startTime = tds.eq(0).text().trim();

          if (cleanName && startTime) {
            contests.push({
              platform: "AtCoder",
              contestName: cleanName,
              startTime,
            });
          }
        });
      }
      if (heading === "Recent Contests") return false;
    });

    console.log("[AtCoder] Contests fetched:", contests.length);
    return contests;
  } catch (err) {
    console.error("[AtCoder] Error:", err.message);
    return [];
  }
}

app.get("/upcoming_contests", async (req, res) => {
  try {
    // Run scrapers in parallel for speed
    const [codeforcesContests, codechefContests, atcoderContests] =
      await Promise.all([
        scrapeCodeforces(),
        scrapeCodeChef(),
        scrapeAtCoder(),
      ]);

    const allContests = [
      ...codeforcesContests,
      ...codechefContests,
      ...atcoderContests,
    ];

    if (allContests.length === 0) {
      return res.status(500).json({ error: "No contests fetched" });
    }

    res.json({ contests: allContests });
  } catch (error) {
    console.error("General Error:", error.message);
    res.status(500).json({ error: "Failed to fetch upcoming contests" });
  }
});
// ----------- SERVER START -----------
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
