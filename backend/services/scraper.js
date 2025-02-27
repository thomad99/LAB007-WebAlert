const puppeteer = require('puppeteer');

class WebScraper {
    async scrape(url) {
        const browser = await puppeteer.launch({
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            headless: 'new',
            ignoreHTTPSErrors: true
        });
        try {
            console.log('Browser launched successfully');
            const page = await browser.newPage();
            console.log('New page created');
            await page.setViewport({ width: 1280, height: 800 });
            await page.goto(url, { 
                waitUntil: 'networkidle0',
                timeout: 30000 
            });
            console.log('Page loaded');
            const content = await page.content();
            return content;
        } catch (error) {
            console.error(`Error scraping ${url}:`, error);
            throw error;
        } finally {
            await browser.close();
            console.log('Browser closed');
        }
    }
}

module.exports = new WebScraper(); 