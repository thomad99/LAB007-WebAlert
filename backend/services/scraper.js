const puppeteer = require('puppeteer');

class WebScraper {
    async scrape(url) {
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        try {
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle0' });
            const content = await page.content();
            return content;
        } catch (error) {
            console.error(`Error scraping ${url}:`, error);
            throw error;
        } finally {
            await browser.close();
        }
    }
}

module.exports = new WebScraper(); 