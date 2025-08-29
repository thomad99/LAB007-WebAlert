const puppeteer = require('puppeteer');

const scraper = {
    browser: null,
    
    async initBrowser() {
        if (!this.browser) {
            console.log('Initializing browser...');
            this.browser = await puppeteer.launch({
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--disable-extensions'
                ],
                headless: 'new'
            });
        }
        return this.browser;
    },

    async scrape(url) {
        console.log(`🔍 Starting scrape of ${url}`);
        let page = null;
        try {
            const browser = await this.initBrowser();
            page = await browser.newPage();
            
            // Set longer timeout and optimize page load
            await page.setDefaultNavigationTimeout(60000);
            await page.setDefaultTimeout(60000);
            
            // Block unnecessary resources
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                const resourceType = request.resourceType();
                if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            // Add retry logic
            let retries = 3;
            let content = null;
            let error = null;

            while (retries > 0 && !content) {
                try {
                    await page.goto(url, {
                        waitUntil: 'networkidle0',
                        timeout: 60000
                    });

                    // Wait for any dynamic content to load
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    content = await page.content();
                    break;
                } catch (err) {
                    error = err;
                    console.log(`Attempt failed, ${retries - 1} retries left:`, err.message);
                    retries--;
                    if (retries > 0) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            }

            if (!content) {
                throw error || new Error('Failed to fetch content after all retries');
            }

            const debug = {
                timestamp: new Date().toISOString(),
                url: url,
                status: 'success',
                contentLength: content.length
            };

            await page.close();
            return { content, debug };

        } catch (error) {
            console.error(`❌ Error scraping ${url}:`, error.message);
            const debug = {
                timestamp: new Date().toISOString(),
                url: url,
                status: 'error',
                error: error.message
            };

            if (page) {
                await page.close();
            }

            return {
                content: `Error scraping content: ${error.message}`,
                debug: debug
            };
        }
    },

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
};

// Cleanup on process exit
process.on('SIGTERM', async () => {
    console.log('Cleaning up scraper resources...');
    await scraper.cleanup();
});

process.on('SIGINT', async () => {
    console.log('Cleaning up scraper resources...');
    await scraper.cleanup();
});

module.exports = scraper; 