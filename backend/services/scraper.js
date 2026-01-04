// Puppeteer will be loaded on-demand to save memory
let puppeteer = null;

async function loadPuppeteer() {
    if (!puppeteer) {
        try {
            console.log('Loading Puppeteer on-demand...');
            puppeteer = require('puppeteer');
            console.log('Puppeteer loaded successfully');
        } catch (error) {
            console.error('Failed to load Puppeteer:', error.message);
            throw new Error('Puppeteer is not installed. Please install it: npm install puppeteer');
        }
    }
    return puppeteer;
}

const scraper = {
    browser: null,
    
    async initBrowser() {
        if (!this.browser) {
            console.log('Initializing browser...');
            const puppeteerLib = await loadPuppeteer();
            
            const fs = require('fs');
            let executablePath = null;
            
            // Try to use Puppeteer's bundled Chrome first
            try {
                const reportedPath = puppeteerLib.executablePath();
                // Verify the path actually exists - check both the reported path and common variations
                const pathsToCheck = [
                    reportedPath,
                    reportedPath + '/chrome',
                    reportedPath.replace('/chrome-linux64/chrome', '/chrome-linux64/chrome-linux64/chrome'),
                    reportedPath.replace('/chrome', '/chrome-linux64/chrome')
                ];
                
                for (const pathToCheck of pathsToCheck) {
                    if (pathToCheck && fs.existsSync(pathToCheck)) {
                        executablePath = pathToCheck;
                        console.log('Using Puppeteer bundled Chrome:', executablePath);
                        break;
                    }
                }
                
                if (!executablePath && reportedPath) {
                    console.warn('Puppeteer reported Chrome path but file does not exist:', reportedPath);
                    console.warn('Attempted to check variations:', pathsToCheck);
                }
            } catch (err) {
                console.warn('Could not get Puppeteer bundled Chrome path:', err.message);
            }
            
            // If no bundled Chrome, try system Chrome
            if (!executablePath) {
                const possiblePaths = [
                    '/usr/bin/google-chrome',
                    '/usr/bin/chromium-browser',
                    '/usr/bin/chromium',
                    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
                ];
                
                for (const path of possiblePaths) {
                    try {
                        if (fs.existsSync(path)) {
                            executablePath = path;
                            console.log('Using system Chrome:', executablePath);
                            break;
                        }
                    } catch (e) {
                        // Continue checking other paths
                    }
                }
            }
            
            const launchOptions = {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-ipc-flooding-protection'
                ],
                headless: 'new',
                timeout: 120000 // 2 minute timeout for launch
            };
            
            // Only set executablePath if we found a valid one that exists
            if (executablePath && fs.existsSync(executablePath)) {
                launchOptions.executablePath = executablePath;
                console.log('Setting executablePath to:', executablePath);
            } else {
                // Don't set executablePath - let Puppeteer try to find it automatically
                console.log('No valid Chrome path found, letting Puppeteer auto-detect or install...');
            }
            
            try {
                this.browser = await puppeteerLib.launch(launchOptions);
                console.log('Browser initialized successfully');
            } catch (error) {
                console.error('Failed to launch browser:', error.message);
                if (error.message.includes('Could not find Chrome') || error.message.includes('Browser was not found')) {
                    // Try to install Chrome automatically
                    console.log('Chrome not found, attempting to install...');
                    try {
                        const { execSync } = require('child_process');
                        console.log('Running: npx puppeteer browsers install chrome');
                        execSync('npx puppeteer browsers install chrome', { 
                            stdio: 'inherit',
                            timeout: 300000, // 5 minutes timeout
                            cwd: process.cwd(),
                            env: { ...process.env, PUPPETEER_CACHE_DIR: '/opt/render/.cache/puppeteer' }
                        });
                        console.log('Chrome installed, retrying browser launch...');
                        // Retry launch without executablePath to use newly installed Chrome
                        delete launchOptions.executablePath;
                        this.browser = await puppeteerLib.launch(launchOptions);
                        console.log('Browser initialized successfully after Chrome installation');
                    } catch (installError) {
                        console.error('Failed to install Chrome:', installError.message);
                        console.error('Install error stack:', installError.stack);
                        // Try one more time without executablePath
                        try {
                            console.log('Attempting final launch without executablePath...');
                            delete launchOptions.executablePath;
                            this.browser = await puppeteerLib.launch(launchOptions);
                            console.log('Browser initialized successfully on final attempt');
                        } catch (finalError) {
                            throw new Error('Chrome browser not found and automatic installation failed. Please install Chrome manually or ensure Puppeteer is properly configured.');
                        }
                    }
                } else {
                    throw error;
                }
            }
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
            await page.setDefaultNavigationTimeout(90000); // 90 seconds
            await page.setDefaultTimeout(90000); // 90 seconds
            
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
                    // Use domcontentloaded instead of networkidle0 for faster, more reliable loading
                    await page.goto(url, {
                        waitUntil: 'domcontentloaded',
                        timeout: 90000 // Increased to 90 seconds
                    });

                    // Wait for any dynamic content to load (reduced from 2000ms to 1000ms)
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    content = await page.content();
                    break;
                } catch (err) {
                    error = err;
                    console.log(`Attempt failed, ${retries - 1} retries left:`, err.message);
                    retries--;
                    if (retries > 0) {
                        // Wait longer between retries
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