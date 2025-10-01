#!/usr/bin/env node

const { program } = require("commander");
const puppeteer = require("puppeteer");
const fs = require("fs").promises;

async function crawlPriceHistory(
  url,
  outputFile = "output.json",
  headless = true
) {
  let browser;

  try {
    console.log(`Starting browser...`);
    browser = await puppeteer.launch({
      headless: headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    console.log(`Waiting for price history table to load...`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Wait for table to be present
    try {
      await page.waitForSelector(".price-history-table-root", {
        timeout: 10000,
      });
      console.log(`Price history table found`);
    } catch (err) {
      console.log(`Price history table not found, exiting...`);
      return;
    }

    // Remove any applied filters
    console.log(`Checking for active filters...`);
    const filterRemoved = await page.evaluate(() => {
      const removeButtons = document.querySelectorAll(
        '[da-id="filter-chip-remove-btn"]'
      );
      if (removeButtons.length > 0) {
        removeButtons.forEach((btn) => btn.click());
        return true;
      }
      return false;
    });

    if (filterRemoved) {
      console.log(
        `Removed ${filterRemoved} filter(s), waiting for table to update...`
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    }

    console.log(`Starting to scrape...`);

    // Wait for table rows to appear
    try {
      await page.waitForSelector(".table-row-collapsed", { timeout: 10000 });
    } catch (err) {
      console.log(`No table rows found. The table might be empty.`);
      return;
    }

    let allTransactions = [];
    let currentPage = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      console.log(`\nScraping page ${currentPage}...`);

      // Wait for table rows to be present
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Expand all rows to get full details
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

      // Wait for expansions to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Extract data from current page
      const pageData = await page.evaluate(() => {
        const rows = document.querySelectorAll(".table-row-collapsed");
        const transactions = [];

        rows.forEach((row) => {
          const transaction = {};

          // Extract date
          const dateCell = row.querySelector('[da-id="row-date"]');
          if (dateCell) {
            transaction.date = dateCell
              .querySelector(".field-value")
              ?.textContent?.trim();
          }

          // Extract bedroom and size
          const bedroomCell = row.querySelector('[da-id="row-bedroom"]');
          if (bedroomCell) {
            const mainText = bedroomCell
              .querySelector(".main-text")
              ?.textContent?.trim();
            const subText = bedroomCell
              .querySelector(".sub-text")
              ?.textContent?.trim();
            transaction.bedrooms = mainText;
            transaction.size = subText;
          }

          // Extract price and price per sqft
          const priceCell = row.querySelector('[da-id="row-price"]');
          if (priceCell) {
            const mainText = priceCell
              .querySelector(".main-text")
              ?.textContent?.trim();
            const subText = priceCell
              .querySelector(".sub-text")
              ?.textContent?.trim();
            transaction.price = mainText;
            transaction.pricePerSqft = subText;
          }

          // Extract floor level
          const floorCell = row.querySelector('[da-id="row-floorLevel"]');
          if (floorCell) {
            transaction.floorLevel = floorCell
              .querySelector(".field-value")
              ?.textContent?.trim();
          }

          // Extract completed status
          const completedCell = row.querySelector('[da-id="row-completed"]');
          if (completedCell) {
            transaction.buildStatus = completedCell
              .querySelector(".field-value")
              ?.textContent?.trim();
          }

          // Try to extract expanded details (lease and address)
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

              // Extract floor number from address (e.g., "#03-**" -> "3")
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

      console.log(
        `Found ${pageData.length} transactions on page ${currentPage}`
      );
      allTransactions = allTransactions.concat(pageData);

      // Check if there's a next page and if it's enabled
      const nextButtonStatus = await page.evaluate(() => {
        const nextButton = document.querySelector(
          '[da-id="hui-pagination-btn-next"]'
        );
        if (!nextButton) return { exists: false, enabled: false };

        const parentLi = nextButton.closest("li");
        const isDisabled = parentLi && parentLi.classList.contains("disabled");

        return {
          exists: true,
          enabled: !isDisabled,
        };
      });

      if (!nextButtonStatus.exists || !nextButtonStatus.enabled) {
        console.log(`\nNo more pages to scrape (reached last page)`);
        hasNextPage = false;
      } else {
        console.log(`Navigating to next page...`);

        try {
          // Click the next button
          await page.click('[da-id="hui-pagination-btn-next"]');

          // Wait for the page to update
          await new Promise((resolve) => setTimeout(resolve, 3000));

          // Wait for network to be idle
          await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {
            console.log("Network idle timeout, continuing...");
          });

          currentPage++;
        } catch (error) {
          console.error(`Error clicking next page: ${error.message}`);
          hasNextPage = false;
        }
      }
    }

    console.log(`\nTotal transactions scraped: ${allTransactions.length}`);

    const result = {
      url: url,
      scrapedAt: new Date().toISOString(),
      totalTransactions: allTransactions.length,
      totalPages: currentPage,
      transactions: allTransactions,
    };

    await fs.writeFile(outputFile, JSON.stringify(result, null, 2));
    console.log(`\nData saved to ${outputFile}`);

    // Show preview of data
    console.log("\nPreview of scraped transactions:");
    allTransactions.slice(0, 5).forEach((item, idx) => {
      console.log(`\n--- Transaction ${idx + 1} ---`);
      console.log(`Date: ${item.date}`);
      console.log(`Bedrooms: ${item.bedrooms}`);
      console.log(`Size: ${item.size}`);
      console.log(`Price: ${item.price}`);
      console.log(`Price per sqft: ${item.pricePerSqft}`);
      console.log(`Floor: ${item.floor || "N/A"}`);
      console.log(`Address: ${item.address || "N/A"}`);
    });

    if (allTransactions.length > 5) {
      console.log(
        `\n... and ${allTransactions.length - 5} more transaction(s)`
      );
    }
  } catch (error) {
    console.error("Error during crawling:", error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function crawlByClass(
  url,
  className,
  outputFile = "output.json",
  headless = true
) {
  let browser;

  try {
    console.log(`Starting browser...`);
    browser = await puppeteer.launch({
      headless: headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    console.log(`Waiting for dynamic content to load...`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`Looking for elements with class: ${className}...`);

    try {
      await page.waitForSelector(`.${className}`, { timeout: 5000 });
      console.log(`Found selector .${className}, scraping...`);
    } catch (err) {
      console.log(
        `Selector .${className} not found after waiting, attempting scrape anyway...`
      );
    }

    const data = await page.evaluate((cls) => {
      const elements = document.querySelectorAll(`.${cls}`);
      const results = [];

      elements.forEach((element, index) => {
        results.push({
          index: index,
          text: element.innerText || element.textContent || "",
          html: element.innerHTML,
          tagName: element.tagName.toLowerCase(),
          attributes: Array.from(element.attributes).reduce((attrs, attr) => {
            attrs[attr.name] = attr.value;
            return attrs;
          }, {}),
        });
      });

      return results;
    }, className);

    if (data.length === 0) {
      console.log(`No elements found with class: ${className}`);

      const allClasses = await page.evaluate(() => {
        const classes = new Set();
        document.querySelectorAll("*").forEach((el) => {
          el.classList.forEach((c) => classes.add(c));
        });
        return Array.from(classes).sort().slice(0, 20);
      });
      console.log(
        `\nSample classes found on page: ${allClasses.join(", ")}...`
      );
      return;
    }

    console.log(`Found ${data.length} element(s)`);

    const result = {
      url: url,
      className: className,
      timestamp: new Date().toISOString(),
      count: data.length,
      elements: data,
    };

    await fs.writeFile(outputFile, JSON.stringify(result, null, 2));
    console.log(`\nData saved to ${outputFile}`);

    console.log("\nPreview of scraped data:");
    data.slice(0, 3).forEach((item, idx) => {
      console.log(`\n--- Element ${idx + 1} ---`);
      console.log(`Tag: ${item.tagName}`);
      console.log(
        `Text: ${item.text.substring(0, 100)}${
          item.text.length > 100 ? "..." : ""
        }`
      );
    });

    if (data.length > 3) {
      console.log(`\n... and ${data.length - 3} more element(s)`);
    }
  } catch (error) {
    console.error("Error during crawling:", error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

program
  .name("web-crawler")
  .description(
    "Web scraper that extracts data from PropertyGuru and other websites"
  )
  .version("1.0.0");

program
  .command("price-history")
  .description("Crawl PropertyGuru price history with pagination support")
  .requiredOption("-u, --url <url>", "PropertyGuru listing URL")
  .option("-o, --output <file>", "Output JSON file", "price-history.json")
  .option("--headless <mode>", "Run in headless mode (true/false)", "false")
  .action(async (options) => {
    try {
      const headlessMode = options.headless === "false" ? false : true;
      await crawlPriceHistory(options.url, options.output, headlessMode);
    } catch (error) {
      console.error("Failed to crawl:", error.message);
      process.exit(1);
    }
  });

program
  .command("crawl")
  .description(
    "Crawl a URL and extract data from elements with specified class"
  )
  .requiredOption("-u, --url <url>", "URL to crawl")
  .requiredOption("-c, --class <className>", "CSS class name to search for")
  .option("-o, --output <file>", "Output JSON file", "output.json")
  .option("--headless <mode>", "Run in headless mode (true/false)", "false")
  .action(async (options) => {
    try {
      const headlessMode = options.headless === "false" ? false : true;
      await crawlByClass(
        options.url,
        options.class,
        options.output,
        headlessMode
      );
    } catch (error) {
      console.error("Failed to crawl:", error.message);
      process.exit(1);
    }
  });

if (process.argv.length === 2) {
  program.help();
}

program.parse();
