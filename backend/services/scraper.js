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
                    '--window-size=1920x1080'
                ],
                headless: 'new'
            });
            console.log('Browser initialized');
        }
        return this.browser;
    },

    async scrape(url) {
        console.log(`Starting scrape for URL: ${url}`);
        let browser = null;
        let page = null;
        
        try {
            browser = await this.initBrowser();
            page = await browser.newPage();

            // Set viewport and user agent
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

            // Set default timeout to 30 seconds
            page.setDefaultTimeout(30000);

            // Enable request interception to block unnecessary resources
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                const resourceType = request.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            // Add error handling for common scenarios
            page.on('error', err => {
                console.error('Page error:', err);
            });

            page.on('pageerror', err => {
                console.error('Page error:', err);
            });

            // Navigate to the page with custom timeout and waitUntil conditions
            console.log(`Navigating to ${url}...`);
            await page.goto(url, {
                timeout: 30000,
                waitUntil: ['domcontentloaded', 'networkidle2']
            });

            // Wait for content to be available
            await page.waitForFunction(() => {
                return document.body && document.body.innerHTML.length > 0;
            }, { timeout: 10000 });

            // Get the page content
            const content = await page.evaluate(() => {
                // Remove script tags and their content
                const scripts = document.getElementsByTagName('script');
                for (let script of scripts) {
                    script.remove();
                }
                
                // Remove style tags and their content
                const styles = document.getElementsByTagName('style');
                for (let style of styles) {
                    style.remove();
                }
                
                // Get text content and normalize whitespace
                return document.body.innerText
                    .replace(/\\s+/g, ' ')
                    .trim();
            });

            // Collect debug information
            const debug = {
                timestamp: new Date().toISOString(),
                url: url,
                status: 'success',
                contentLength: content.length,
                title: await page.title(),
                metrics: await page.metrics()
            };

            console.log(`Scrape completed for ${url}`);
            return { content, debug };

        } catch (error) {
            console.error('=== Scraper Error ===');
            console.error(error);
            console.error('Stack:', error.stack);

            // Collect error debug information
            const debug = {
                timestamp: new Date().toISOString(),
                url: url,
                status: 'error',
                error: error.message,
                errorType: error.name,
                stack: error.stack
            };

            // Return empty content with error debug info
            return { 
                content: `Error scraping content: ${error.message}`,
                debug 
            };

        } finally {
            console.log('=== Scrape Process Complete ===');
            if (page) {
                await page.close().catch(console.error);
            }
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
    console.log('SIGTERM received in scraper, cleaning up...');
    await scraper.cleanup();
});

process.on('SIGINT', async () => {
    console.log('SIGINT received in scraper, cleaning up...');
    await scraper.cleanup();
});

module.exports = scraper; 