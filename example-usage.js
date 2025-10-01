#!/usr/bin/env node

const { execSync } = require("child_process");

console.log("=== PropertyGuru Price History Crawler ===\n");

const url =
  "https://www.propertyguru.com.sg/listing/for-sale-tembusu-grand-24524443#price-history";
const outputFile = "propertyguru-price-history.json";

console.log(
  "Crawling PropertyGuru listing for price history data with pagination...\n"
);
console.log(`URL: ${url}`);
console.log(`Output file: ${outputFile}\n`);

try {
  const command = `node crawler.js price-history -u "${url}" -o "${outputFile}" --headless false`;
  console.log(`Running: ${command}\n`);

  const output = execSync(command, { encoding: "utf-8" });
  console.log(output);

  console.log(
    `\n✓ Success! Check ${outputFile} for the complete scraped price history data.`
  );
} catch (error) {
  console.error("✗ Error running crawler:", error.message);
  process.exit(1);
}
