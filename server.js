const express = require("express");
const cors = require("cors");
const path = require("path");
const puppeteer = require("puppeteer");
const fs = require("fs").promises;

// For Vercel deployment
let chromium = null;
try {
  chromium = require('chrome-aws-lambda');
} catch (err) {
  // chrome-aws-lambda not available in development
}

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", "./views");

// Store active crawl sessions
const activeCrawls = new Map();

// Optimized crawler class for parallel processing
class FastCrawler {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 3;
    this.headless = options.headless !== false;
    this.timeout = options.timeout || 30000;
    this.browsers = [];
  }

  async initBrowsers() {
    console.log(`Initializing ${this.concurrency} browser instances...`);

    for (let i = 0; i < this.concurrency; i++) {
      let browser;
      
      if (chromium && process.env.NODE_ENV === 'production') {
        // Vercel/AWS Lambda environment
        browser = await puppeteer.launch({
          args: await chromium.args,
          defaultViewport: chromium.defaultViewport,
          executablePath: await chromium.executablePath,
          headless: chromium.headless,
        });
      } else {
        // Local development
        browser = await puppeteer.launch({
          headless: this.headless,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-default-apps",
            "--disable-extensions",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
          ],
        });
      }
      
      this.browsers.push(browser);
    }
  }

  async crawlPropertyGuru(url, sessionId, urlIndex, totalUrls) {
    const browserIndex = urlIndex % this.browsers.length;
    const browser = this.browsers[browserIndex];

    if (!browser) {
      throw new Error("Browser not available");
    }

    const page = await browser.newPage();

    try {
      // Emit progress update
      this.emitProgress(sessionId, {
        urlIndex,
        totalUrls,
        status: "starting",
        url,
        message: "Navigating to page...",
      });

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });
      });

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.timeout,
      });

      this.emitProgress(sessionId, {
        urlIndex,
        totalUrls,
        status: "loading",
        url,
        message: "Waiting for content...",
      });

      // Scroll and wait for content
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check for price history table
      try {
        await page.waitForSelector(".price-history-table-root", {
          timeout: 10000,
        });
      } catch (err) {
        this.emitProgress(sessionId, {
          urlIndex,
          totalUrls,
          status: "error",
          url,
          message: "Price history table not found",
          error: "No price history data available",
        });
        return { url, error: "No price history table found", transactions: [] };
      }

      // Remove filters if any
      await page.evaluate(() => {
        const removeButtons = document.querySelectorAll(
          '[da-id="filter-chip-remove-btn"]'
        );
        removeButtons.forEach((btn) => btn.click());
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      this.emitProgress(sessionId, {
        urlIndex,
        totalUrls,
        status: "scraping",
        url,
        message: "Extracting data...",
      });

      let allTransactions = [];
      let currentPage = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // Wait for rows
        try {
          await page.waitForSelector(".table-row-collapsed", { timeout: 5000 });
        } catch (err) {
          break;
        }

        // Expand all rows
        await page.evaluate(() => {
          const collapseIcons = document.querySelectorAll(
            '[da-id="collapse-icon"]'
          );
          collapseIcons.forEach((icon) => {
            if (
              icon &&
              !icon
                .closest("tr")
                ?.nextElementSibling?.querySelector(".expanded-content.show")
            ) {
              icon.click();
            }
          });
        });

        await new Promise((resolve) => setTimeout(resolve, 800));

        // Extract data
        const pageData = await page.evaluate(() => {
          const rows = document.querySelectorAll(".table-row-collapsed");
          const transactions = [];

          rows.forEach((row) => {
            const transaction = {};

            // Date
            const dateCell = row.querySelector('[da-id="row-date"]');
            if (dateCell) {
              transaction.date = dateCell
                .querySelector(".field-value")
                ?.textContent?.trim();
            }

            // Bedroom and size
            const bedroomCell = row.querySelector('[da-id="row-bedroom"]');
            if (bedroomCell) {
              transaction.bedrooms = bedroomCell
                .querySelector(".main-text")
                ?.textContent?.trim();
              transaction.size = bedroomCell
                .querySelector(".sub-text")
                ?.textContent?.trim();
            }

            // Price
            const priceCell = row.querySelector('[da-id="row-price"]');
            if (priceCell) {
              transaction.price = priceCell
                .querySelector(".main-text")
                ?.textContent?.trim();
              transaction.pricePerSqft = priceCell
                .querySelector(".sub-text")
                ?.textContent?.trim();
            }

            // Floor level
            const floorCell = row.querySelector('[da-id="row-floorLevel"]');
            if (floorCell) {
              transaction.floorLevel = floorCell
                .querySelector(".field-value")
                ?.textContent?.trim();
            }

            // Build status
            const completedCell = row.querySelector('[da-id="row-completed"]');
            if (completedCell) {
              transaction.buildStatus = completedCell
                .querySelector(".field-value")
                ?.textContent?.trim();
            }

            // Expanded details
            const expandedRow = row.nextElementSibling;
            if (
              expandedRow &&
              expandedRow.classList.contains("table-row-expanded")
            ) {
              const leaseItem = expandedRow.querySelector(
                '[da-id="expanded-lease"]'
              );
              if (leaseItem) {
                transaction.lease = leaseItem
                  .querySelector(".expanded-item-value")
                  ?.textContent?.trim();
              }

              const addressItem = expandedRow.querySelector(
                '[da-id="expanded-address"]'
              );
              if (addressItem) {
                const address = addressItem
                  .querySelector(".expanded-item-value")
                  ?.textContent?.trim();
                transaction.address = address;

                if (address) {
                  const floorMatch = address.match(/#(\d+)-/);
                  if (floorMatch) {
                    transaction.floor = floorMatch[1];
                  }
                }
              }
            }

            transactions.push(transaction);
          });

          return transactions;
        });

        allTransactions = allTransactions.concat(pageData);

        this.emitProgress(sessionId, {
          urlIndex,
          totalUrls,
          status: "scraping",
          url,
          message: `Scraped page ${currentPage} (${pageData.length} records)`,
        });

        // Check for next page
        const nextButtonStatus = await page.evaluate(() => {
          const nextButton = document.querySelector(
            '[da-id="hui-pagination-btn-next"]'
          );
          if (!nextButton) return { exists: false, enabled: false };

          const parentLi = nextButton.closest("li");
          const isDisabled =
            parentLi && parentLi.classList.contains("disabled");

          return { exists: true, enabled: !isDisabled };
        });

        if (!nextButtonStatus.exists || !nextButtonStatus.enabled) {
          hasNextPage = false;
        } else {
          try {
            await page.click('[da-id="hui-pagination-btn-next"]');
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});
            currentPage++;
          } catch (error) {
            hasNextPage = false;
          }
        }
      }

      this.emitProgress(sessionId, {
        urlIndex,
        totalUrls,
        status: "completed",
        url,
        message: `Completed: ${allTransactions.length} transactions`,
      });

      return {
        url,
        scrapedAt: new Date().toISOString(),
        totalTransactions: allTransactions.length,
        totalPages: currentPage,
        transactions: allTransactions,
      };
    } catch (error) {
      this.emitProgress(sessionId, {
        urlIndex,
        totalUrls,
        status: "error",
        url,
        message: error.message,
        error: error.message,
      });

      return {
        url,
        error: error.message,
        transactions: [],
      };
    } finally {
      await page.close();
    }
  }

  emitProgress(sessionId, data) {
    const session = activeCrawls.get(sessionId);
    if (session && session.res) {
      session.res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  }

  async crawlMultipleUrls(urls, sessionId) {
    await this.initBrowsers();

    try {
      const results = await Promise.allSettled(
        urls.map((url, index) =>
          this.crawlPropertyGuru(url.trim(), sessionId, index, urls.length)
        )
      );

      return results.map((result, index) => ({
        url: urls[index],
        success: result.status === "fulfilled",
        data: result.status === "fulfilled" ? result.value : null,
        error: result.status === "rejected" ? result.reason.message : null,
      }));
    } finally {
      // Close all browsers
      await Promise.all(this.browsers.map((browser) => browser.close()));
    }
  }
}

// Routes
app.get("/", (req, res) => {
  res.render("index");
});

app.post("/crawl", async (req, res) => {
  const { urls, options = {} } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "URLs array is required" });
  }

  const sessionId = Date.now().toString();

  // Set up Server-Sent Events
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  // Store session
  activeCrawls.set(sessionId, { res, startTime: Date.now() });

  // Start crawling
  const crawler = new FastCrawler({
    concurrency: options.concurrency || 3,
    headless: options.headless !== false,
    timeout: options.timeout || 30000,
  });

  try {
    const results = await crawler.crawlMultipleUrls(urls, sessionId);

    // Send final results
    res.write(
      `data: ${JSON.stringify({
        type: "complete",
        results,
        sessionId,
        totalTime: Date.now() - activeCrawls.get(sessionId).startTime,
      })}\n\n`
    );

    // Save results to file
    const outputFile = `output/bulk-crawl-${sessionId}.json`;
    await fs.mkdir("output", { recursive: true });
    await fs.writeFile(
      outputFile,
      JSON.stringify(
        {
          sessionId,
          crawledAt: new Date().toISOString(),
          totalUrls: urls.length,
          results,
        },
        null,
        2
      )
    );

    res.write(
      `data: ${JSON.stringify({
        type: "saved",
        file: outputFile,
      })}\n\n`
    );
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        error: error.message,
      })}\n\n`
    );
  } finally {
    activeCrawls.delete(sessionId);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Crawler UI running at http://localhost:${PORT}`);
  console.log("📊 Ready for bulk PropertyGuru crawling!");
});
