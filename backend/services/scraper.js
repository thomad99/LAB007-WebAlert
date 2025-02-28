const puppeteer = require('puppeteer');

async function scrape(url) {
    console.log('\n=== Starting Scrape Process ===');
    console.log('URL:', url);
    console.log('Chrome Path:', process.env.PUPPETEER_EXECUTABLE_PATH);
    
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

        // Log browser version
        const version = await browser.version();
        debugInfo.steps.push(`Browser version: ${version}`);

        debugInfo.steps.push('Creating new page...');
        const page = await browser.newPage();
        
        // Add more verbose page logging
        page.on('console', msg => {
            const text = `Page console: ${msg.type()}: ${msg.text()}`;
            console.log(text);
            debugInfo.steps.push(text);
        });

        page.on('pageerror', err => {
            const text = `Page error: ${err.message}`;
            console.error(text);
            debugInfo.steps.push(text);
        });

        page.on('requestfailed', request => {
            const text = `Failed request: ${request.url()} ${request.failure().errorText}`;
            console.error(text);
            debugInfo.steps.push(text);
        });

        debugInfo.steps.push('Setting viewport...');
        await page.setViewport({ width: 1920, height: 1080 });

        // Set a longer timeout and add navigation options
        debugInfo.steps.push(`Navigating to ${url}...`);
        const response = await page.goto(url, {
            waitUntil: ['networkidle0', 'domcontentloaded'],
            timeout: 60000 // 60 seconds timeout
        });

        const status = response.status();
        debugInfo.steps.push(`Page loaded with status: ${status}`);
        
        if (status !== 200) {
            throw new Error(`Page returned status ${status}`);
        }

        debugInfo.steps.push('Waiting for body...');
        await page.waitForSelector('body', { timeout: 10000 });

        // Take a screenshot before content extraction
        debugInfo.steps.push('Taking screenshot...');
        const screenshot = await page.screenshot({ 
            fullPage: true,
            encoding: 'base64'
        });
        debugInfo.screenshot = `data:image/png;base64,${screenshot}`;

        // Extract content with more details
        debugInfo.steps.push('Extracting content...');
        const content = await page.evaluate(() => {
            // Remove unwanted elements
            const elementsToRemove = document.querySelectorAll('script, style, iframe, noscript');
            elementsToRemove.forEach(el => el.remove());

            // Get both text and HTML
            const text = document.body.innerText;
            const html = document.body.innerHTML;

            return {
                text,
                html,
                textLength: text.length,
                htmlLength: html.length
            };
        });

        debugInfo.content = content;
        debugInfo.steps.push(`Content extracted - Text length: ${content.textLength}, HTML length: ${content.htmlLength}`);

        // Log sample of content
        console.log('\nContent Sample:');
        console.log(content.text.substring(0, 200) + '...\n');

        return {
            content: content.text,
            debug: debugInfo
        };
    } catch (error) {
        console.error('\n=== Scraper Error ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);

        debugInfo.error = {
            message: error.message,
            stack: error.stack
        };
        debugInfo.steps.push(`Error: ${error.message}`);
        throw error;
    } finally {
        if (browser) {
            debugInfo.steps.push('Closing browser...');
            await browser.close();
            debugInfo.steps.push('Browser closed');
            console.log('=== Scrape Process Complete ===\n');
        }
    }
}

module.exports = {
    scrape
}; 