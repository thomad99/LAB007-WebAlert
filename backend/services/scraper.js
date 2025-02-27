const puppeteer = require('puppeteer');

async function scrape(url) {
    console.log('Starting scrape for URL:', url);
    let browser = null;
    try {
        // Launch browser with specific args for running in container
        console.log('Launching browser...');
        browser = await puppeteer.launch({
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080'
            ],
            headless: 'new',
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        // Create a new page
        console.log('Creating new page...');
        const page = await browser.newPage();

        // Set viewport
        await page.setViewport({ width: 1920, height: 1080 });

        // Navigate to URL with timeout
        console.log('Navigating to URL...');
        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        // Wait for content to load
        console.log('Waiting for content to load...');
        await page.waitForSelector('body');

        // Get the page content
        console.log('Extracting content...');
        const content = await page.evaluate(() => {
            // Remove scripts, styles, and other non-content elements
            const elementsToRemove = document.querySelectorAll('script, style, iframe, noscript');
            elementsToRemove.forEach(el => el.remove());

            // Get the text content
            return document.body.innerText;
        });

        console.log(`Content extracted, length: ${content.length} characters`);
        console.log('Sample of content:', content.substring(0, 200) + '...');

        return content;
    } catch (error) {
        console.error('Error in scraper:', {
            url,
            error: error.message,
            stack: error.stack
        });
        throw error;
    } finally {
        if (browser) {
            console.log('Closing browser...');
            await browser.close();
        }
    }
}

module.exports = {
    scrape
}; 