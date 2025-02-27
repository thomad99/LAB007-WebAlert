const puppeteer = require('puppeteer');

async function scrape(url) {
    console.log('Starting scrape for URL:', url);
    let browser = null;
    let debugInfo = {
        steps: [],
        content: null,
        error: null
    };

    try {
        debugInfo.steps.push('Launching browser...');
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
        debugInfo.steps.push('Browser launched successfully');

        debugInfo.steps.push('Creating new page...');
        const page = await browser.newPage();
        
        // Enable request interception for debugging
        await page.setRequestInterception(true);
        page.on('request', request => {
            debugInfo.steps.push(`Request: ${request.method()} ${request.url()}`);
            request.continue();
        });

        page.on('console', msg => {
            debugInfo.steps.push(`Console: ${msg.text()}`);
        });

        page.on('error', err => {
            debugInfo.steps.push(`Page error: ${err.message}`);
        });

        debugInfo.steps.push('Setting viewport...');
        await page.setViewport({ width: 1920, height: 1080 });

        debugInfo.steps.push(`Navigating to ${url}...`);
        const response = await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        debugInfo.steps.push(`Page loaded with status: ${response.status()}`);

        debugInfo.steps.push('Waiting for body...');
        await page.waitForSelector('body');

        debugInfo.steps.push('Taking screenshot...');
        const screenshot = await page.screenshot({ encoding: 'base64' });
        debugInfo.screenshot = `data:image/png;base64,${screenshot}`;

        debugInfo.steps.push('Extracting content...');
        const content = await page.evaluate(() => {
            const elementsToRemove = document.querySelectorAll('script, style, iframe, noscript');
            elementsToRemove.forEach(el => el.remove());
            return {
                text: document.body.innerText,
                html: document.body.innerHTML
            };
        });

        debugInfo.content = content;
        debugInfo.steps.push(`Content extracted, text length: ${content.text.length}`);

        return {
            content: content.text,
            debug: debugInfo
        };
    } catch (error) {
        debugInfo.error = {
            message: error.message,
            stack: error.stack
        };
        debugInfo.steps.push(`Error: ${error.message}`);
        console.error('Error in scraper:', {
            url,
            error: error.message,
            stack: error.stack,
            debug: debugInfo
        });
        throw error;
    } finally {
        if (browser) {
            debugInfo.steps.push('Closing browser...');
            await browser.close();
            debugInfo.steps.push('Browser closed');
        }
    }
}

module.exports = {
    scrape
}; 