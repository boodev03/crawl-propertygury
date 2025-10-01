# Puppeteer Web Crawler

A flexible and powerful web crawler built with Puppeteer that handles state-based pagination and supports custom data extraction.

## Features

✅ **Page Navigation** - Navigate to any URL and wait for dynamic content
✅ **Element Extraction** - Extract data by class name or CSS selector
✅ **State-Based Pagination** - Automatically handle pagination that doesn't change URLs
✅ **Table Data Extraction** - Built-in support for HTML table extraction
✅ **Custom Extractors** - Define your own data extraction logic
✅ **JSON Output** - Automatically save extracted data to JSON files
✅ **Configurable** - Adjust timeouts, headless mode, and more

## Installation

```bash
npm install
```

## Quick Start

### 1. Basic Usage

Edit the configuration in `crawler.js`:

```javascript
const config = {
  url: "https://your-target-website.com",
  selector: ".your-target-class",
  options: {
    headless: false,
    extractTableData: true,
    nextButtonSelector: '[da-id="hui-pagination-btn-next"]',
    maxPages: null,
    outputFile: "output.json",
  },
};
```

Run the crawler:

```bash
npm start
```

### 2. Advanced Usage

Create your own crawler script:

```javascript
import WebCrawler from "./crawler.js";

const crawler = new WebCrawler({
  headless: false,
  waitForSelector: 2000,
});

// Example: Crawl a paginated table
const data = await crawler.crawl(
  "https://example.com/listings",
  ".table-row-collapsed",
  {
    extractTableData: true,
    nextButtonSelector: '[da-id="hui-pagination-btn-next"]',
    maxPages: 10,
    outputFile: "listings.json",
  }
);
```

## API Reference

### WebCrawler Class

#### Constructor Options

```javascript
const crawler = new WebCrawler({
  headless: true, // Run browser in headless mode
  timeout: 30000, // Default timeout in milliseconds
  waitForSelector: 2000, // Wait time after actions (ms)
  outputDir: "./output", // Output directory for JSON files
});
```

#### Methods

##### `crawl(url, selector, options)`

Main method to crawl a website with pagination support.

**Parameters:**

- `url` (string): Target URL to crawl
- `selector` (string): CSS selector to find target elements
- `options` (object):
  - `nextButtonSelector` (string): Selector for next page button
  - `maxPages` (number|null): Maximum pages to crawl (null = all)
  - `extractTableData` (boolean): Use built-in table extraction
  - `customExtractor` (function): Custom extraction function
  - `outputFile` (string): Output filename

**Returns:** Array of extracted data

##### `extractData(selector, extractors)`

Extract data from elements matching the selector.

##### `extractTableData(tableSelector)`

Extract structured data from HTML tables.

##### `crawlWithPagination(url, dataSelector, options)`

Crawl multiple pages with pagination support.

##### `saveToJSON(data, filename)`

Save extracted data to a JSON file.

## Examples

### Example 1: Table with State-Based Pagination

For the price history table from your preview:

```javascript
import WebCrawler from "./crawler.js";

const crawler = new WebCrawler({
  headless: false,
  waitForSelector: 3000,
});

const data = await crawler.crawl(
  "https://your-property-site.com/property/12345",
  "table",
  {
    extractTableData: true,
    nextButtonSelector: '[da-id="hui-pagination-btn-next"]',
    outputFile: "price-history.json",
  }
);
```

### Example 2: Custom Data Extraction

```javascript
const customExtractor = async (page, selector) => {
  return await page.evaluate((sel) => {
    const rows = document.querySelectorAll(sel);
    return Array.from(rows).map((row) => ({
      date: row.querySelector('[da-id="row-date"]')?.textContent?.trim(),
      price: row
        .querySelector('[da-id="row-price"] .main-text')
        ?.textContent?.trim(),
      beds: row
        .querySelector('[da-id="row-bedroom"] .main-text')
        ?.textContent?.trim(),
      floor: row.querySelector('[da-id="row-floorLevel"]')?.textContent?.trim(),
    }));
  }, selector);
};

const data = await crawler.crawl(
  "https://example.com",
  ".table-row-collapsed",
  {
    customExtractor,
    nextButtonSelector: '[da-id="hui-pagination-btn-next"]',
    outputFile: "custom-data.json",
  }
);
```

### Example 3: Simple Class-Based Extraction

```javascript
const data = await crawler.crawl(
  "https://example.com/products",
  ".product-card",
  {
    nextButtonSelector: ".next-button",
    maxPages: 5,
    outputFile: "products.json",
  }
);
```

## How It Works

### State-Based Pagination

The crawler handles pagination that doesn't change the URL by:

1. **Detecting the next button** - Uses `nextButtonSelector` to find the pagination button
2. **Checking if enabled** - Verifies the button isn't disabled
3. **Clicking and waiting** - Clicks the button and waits for new content
4. **Extracting data** - Collects data from the updated page
5. **Repeating** - Continues until no more pages or max limit reached

### Data Extraction Flow

```
Navigate to URL
    ↓
Wait for content to load
    ↓
Extract data from current page
    ↓
Check for next page
    ↓
Yes → Click next → Wait → Extract
    ↓
No → Save all data to JSON
```

## Configuration Tips

### For Slow Websites

Increase wait times:

```javascript
const crawler = new WebCrawler({
  timeout: 60000,
  waitForSelector: 5000,
});
```

### For Dynamic Content

Wait for specific elements:

```javascript
await page.waitForSelector(".content-loaded", { timeout: 10000 });
```

### Debugging

Run with visible browser:

```javascript
const crawler = new WebCrawler({
  headless: false,
});
```

## Output Format

Data is saved as JSON in the `output` directory:

```json
[
  {
    "date": "Sept 2025",
    "bedroom": {
      "main": "5 Bed",
      "sub": "1711 sqft"
    },
    "price": {
      "main": "S$ 4.05M",
      "sub": "S$ 2368 psf"
    },
    "floorLevel": "3",
    "completed": "Uncompleted"
  }
]
```

## Troubleshooting

### Element Not Found

- Increase `waitForSelector` timeout
- Verify selector is correct
- Check if content loads dynamically

### Pagination Not Working

- Verify `nextButtonSelector` matches the actual button
- Check if button requires authentication
- Ensure page has time to load new content

### Browser Crashes

- Reduce concurrent operations
- Increase system resources
- Use headless mode for better performance

## License

MIT

## Notes

- Always respect robots.txt and website terms of service
- Add delays between requests to avoid overwhelming servers
- Handle errors gracefully in production environments
- Consider rate limiting for large-scale crawling

