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
const PORT = process.env.PORT || 3000;
const AUST_AFFILIATIONS = [
  "Ahsanullah University Of Science and Technology",
  "AUST",
];

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

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    let allStandings = [];

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

    await browser.close();
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
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

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
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    let combinedRatings = [];

    for (const affiliation of AUST_AFFILIATIONS) {
      const page = await browser.newPage();
      const url = RATINGS_URL(affiliation);

      ///console.log(`Scraping ratings for affiliation: ${affiliation}`);

      await page.goto(url, { waitUntil: "networkidle2" });
      await page.waitForSelector("table");

      const ratings = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("table tbody tr"));
        return rows
          .map((row) => {
            const cols = row.querySelectorAll("td");
            if (cols.length < 4) return null;

            // Extract username
            const rawUsername = cols[1].innerText.trim() || "";
            const username = rawUsername.split("\n")[0].trim() || "";

            // Extract rating (usually last column, index 4)
            const rating = cols[4]?.innerText.trim() || "";

            return { username, rating };
          })
          .filter(Boolean);
      });

      combinedRatings = combinedRatings.concat(ratings);
      await page.close();
    }

    await browser.close();

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
  } else {
    return res
      .status(400)
      .json({ error: "Invalid contestId prefix. Use abc, arc, or ahc." });
  }
  const results = [];

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

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

  await browser.close();

  res.json({ contestId, fullContestName, results });
});

app.get("/codeforces_ratings_all", async (req, res) => {
  const ORG_IDS = [463, 291];

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    let allRatings = [];

    for (const orgId of ORG_IDS) {
      ///console.log(`📥 Scraping Codeforces org ID: ${orgId}`);

      let pageNum = 1;

      let previousUsernames = new Set();

      while (true) {
        const page = await browser.newPage();
        const url = `https://codeforces.com/ratings/organization/${orgId}/page/${pageNum}`;
        ///console.log(`🔎 Visiting: ${url}`);

        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        );

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

        try {
          await page.waitForSelector(".datatable tbody tr", { timeout: 10000 });
        } catch (e) {
          ///console.log(`⛔ No data table on page ${pageNum}, stopping.`);
          await page.close();
          break;
        }

        const ratings = await page.evaluate(() => {
          const rows = Array.from(
            document.querySelectorAll(".datatable tbody tr")
          );
          const results = [];
          for (const row of rows) {
            const cells = row.querySelectorAll("td");
            const rank = cells[0]?.innerText.trim();
            if (rank === "-") break;
            const username = cells[1]?.innerText.trim();
            const contestParticipated = cells[2]?.innerText.trim();
            const rating = cells[3]?.innerText.trim();
            if (username && contestParticipated && rating) {
              results.push({ username, contestParticipated, rating });
            }
          }
          return results;
        });

        const currentUsernames = new Set(ratings.map((r) => r.username));
        const isSameAsPrevious =
          ratings.length === previousUsernames.size &&
          [...currentUsernames].every((username) =>
            previousUsernames.has(username)
          );

        if (ratings.length === 0 || isSameAsPrevious) {
          /*console.log(
            `✅ Repetition or no new data on page ${pageNum}. Stopping.`
          );*/
          await page.close();
          break;
        }

        /*console.log(`📄 Found ${ratings.length} users on page ${pageNum}`);
        ratings.forEach((r, i) =>
          console.log(`${i + 1}. ${r.username} - ${r.rating}`)
        );*/

        allRatings.push(...ratings);
        previousUsernames = currentUsernames;

        await page.close();
        pageNum++;
      }
    }

    await browser.close();

    // Deduplicate by username, keep highest rating
    const deduped = new Map();
    for (const user of allRatings) {
      if (!deduped.has(user.username)) {
        deduped.set(user.username, user);
      } else {
        const existing = deduped.get(user.username);
        if (parseInt(user.rating) > parseInt(existing.rating)) {
          deduped.set(user.username, user);
        }
      }
    }

    const finalRatings = Array.from(deduped.values());
    res.json({ ratings_all_codeforces: finalRatings });
  } catch (err) {
    console.error("❌ Scraping failed:", err);
    res.status(500).json({ error: "Failed to fetch Codeforces ratings" });
  }
});

const austHandles = [
  "mursalin",
  "sami_01",
  "rifat_69",
  "tanvir.cse",
  "hello_world_aust",
];
const austSet = new Set(austHandles.map((h) => h.toLowerCase()));

app.get("/codeforces_standings/:contestId", async (req, res) => {
  const contestId = req.params.contestId;
  const url = `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=50000&showUnofficial=false`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== "OK") {
      return res
        .status(404)
        .json({ error: "Contest not found or failed to fetch standings" });
    }

    const rows = data.result.rows;
    const contestName = data.result.contest.name;
    const globalStandings = [];
    const austStandings = [];

    let austPointsSum = 0;
    let austCount = 0;

    //const isPenaltyBased = /edu|div\.3|div\.4/i.test(contestName);

    for (const row of rows) {
      const handle = row.party.members[0].handle;
      const rank = row.rank;
      const points = row.points || 0;
      penalty = row.penalty || null;
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
    console.log("[Codeforces] Fetching with Puppeteer...");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );

    await page.goto("https://codeforces.com/contests", {
      waitUntil: "networkidle2",
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const contests = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll("table tbody tr[data-contestid]")
      );

      return rows
        .map((row) => {
          const contestId = row.getAttribute("data-contestid");
          const cells = row.querySelectorAll("td");

          if (cells.length < 6) return null;

          return {
            platform: "Codeforces",
            contestId,
            contestName: cells[0].innerText.trim(),
            writers: Array.from(cells[1].querySelectorAll("a")).map((a) =>
              a.innerText.trim()
            ),
            startTime: cells[2].innerText.trim(),
            length: cells[3].innerText.trim(),
            status: cells[4].innerText.trim(),
            extra: cells[5].innerText.trim(),
          };
        })
        .filter(
          (contest) =>
            contest &&
            contest.status &&
            contest.status.toLowerCase().includes("before start")
        );
    });

    await browser.close();
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
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // Set user agent to look like a normal browser
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );

    await page.goto("https://www.codechef.com/contests", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Wait for the container to load
    await page.waitForSelector("div._dataTable__container_14pun_417", {
      timeout: 15000,
    });

    const contests = await page.evaluate(() => {
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

    await browser.close();

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
