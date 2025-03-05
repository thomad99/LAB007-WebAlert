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
        }
        return this.browser;
    },

    async scrape(url) {
        console.log(`🔍 Starting scrape of ${url}`);
        let browser = null;
        let page = null;
        
        try {
            browser = await this.initBrowser();
            page = await browser.newPage();

            // Configure page settings (removed logging)
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            page.setDefaultTimeout(30000);

            // Block unnecessary resources
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                const resourceType = request.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            await page.goto(url, {
                timeout: 30000,
                waitUntil: ['domcontentloaded', 'networkidle2']
            });

            await page.waitForFunction(() => {
                return document.body && document.body.innerHTML.length > 0;
            }, { timeout: 10000 });

            const content = await page.evaluate(() => {
                const scripts = document.getElementsByTagName('script');
                for (let script of scripts) script.remove();
                const styles = document.getElementsByTagName('style');
                for (let style of styles) style.remove();
                return document.body.innerText.replace(/\\s+/g, ' ').trim();
            });

            const debug = {
                timestamp: new Date().toISOString(),
                url: url,
                status: 'success',
                contentLength: content.length
            };

            console.log(`✅ Finished scrape of ${url}`);
            return { content, debug };

        } catch (error) {
            console.error(`❌ Error scraping ${url}:`, error.message);
            return { 
                content: `Error scraping content: ${error.message}`,
                debug: {
                    timestamp: new Date().toISOString(),
                    url: url,
                    status: 'error',
                    error: error.message
                }
            };
        } finally {
            if (page) await page.close().catch(() => {});
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