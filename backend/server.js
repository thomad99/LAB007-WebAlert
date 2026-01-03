if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ path: '.env.local' });
}

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const db = require('./config/db');
const scraper = require('./services/scraper');
const emailService = require('./services/emailService');
const smsService = require('./services/smsService');

const app = express();

// Add more detailed logging
console.log('Starting server...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Database host:', process.env.DB_HOST);

// Add near the top after imports
console.log('Database configuration:', {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

// Basic error handling
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
});

app.use(cors());
app.use(express.json());

// Add request logging middleware at the very top to catch ALL requests
app.use((req, res, next) => {
    console.log(`[Web-Alert] ===== INCOMING REQUEST =====`);
    console.log(`[Web-Alert] Method: ${req.method}`);
    console.log(`[Web-Alert] Path: ${req.path}`);
    console.log(`[Web-Alert] Original URL: ${req.originalUrl}`);
    console.log(`[Web-Alert] Base URL: ${req.baseUrl}`);
    console.log(`[Web-Alert] URL: ${req.url}`);
    console.log(`[Web-Alert] ===========================`);
    next();
});

// Store active monitoring tasks
const monitoringTasks = new Map();

// Function to clean/filter HTML content by removing ad-related content
function cleanContentForComparison(html) {
    if (!html) return '';
    
    let cleaned = html;
    
    // Remove ad-related patterns
    // 1. Ad click tracking URLs (e.g., /api/ads/click?ad=)
    cleaned = cleaned.replace(/href="[^"]*\/api\/ads\/click[^"]*"/gi, '');
    cleaned = cleaned.replace(/href='[^']*\/api\/ads\/click[^']*'/gi, '');
    
    // 2. Common ad container patterns
    cleaned = cleaned.replace(/<[^>]*class="[^"]*ad[s]?[^"]*"[^>]*>.*?<\/[^>]+>/gis, '');
    cleaned = cleaned.replace(/<[^>]*id="[^"]*ad[s]?[^"]*"[^>]*>.*?<\/[^>]+>/gis, '');
    
    // 3. Ad script tags
    cleaned = cleaned.replace(/<script[^>]*>.*?(ads?|advertisement|adserving).*?<\/script>/gis, '');
    
    // 4. Google AdSense patterns
    cleaned = cleaned.replace(/<[^>]*data-ad-[^>]*>.*?<\/[^>]+>/gis, '');
    cleaned = cleaned.replace(/<ins[^>]*class="[^"]*adsbygoogle[^"]*"[^>]*>.*?<\/ins>/gis, '');
    
    // 5. Ad iframes
    cleaned = cleaned.replace(/<iframe[^>]*(ads?|advertisement|doubleclick|googleadservices)[^>]*>.*?<\/iframe>/gis, '');
    
    // 6. Ad-related attributes in any tag
    cleaned = cleaned.replace(/\s+data-ad-[^=]*="[^"]*"/gi, '');
    cleaned = cleaned.replace(/\s+data-ads-[^=]*="[^"]*"/gi, '');
    
    // 7. Empty ad href attributes that might be left over
    cleaned = cleaned.replace(/href="[^"]*\/api\/ads[^"]*"/gi, '');
    
    // Normalize whitespace to avoid false positives from formatting changes
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.trim();
    
    return cleaned;
}

// Function to start monitoring a URL
async function startUrlMonitoring(urlId, websiteUrl) {
    if (!urlId || !websiteUrl) {
        console.error('Invalid parameters for startUrlMonitoring:', { urlId, websiteUrl });
        throw new Error('Invalid monitoring parameters');
    }

    if (monitoringTasks.has(urlId)) {
        console.log(`Monitoring already active for URL ID ${urlId}`);
        return;
    }

    console.log(`Starting monitoring for URL ID ${urlId}: ${websiteUrl}`);
    let previousContent = null;
    let changesDetected = 0;
    let subscriberInfo = null;

    try {
        // Initial scrape to get starting content (this is the baseline, not counted as a check)
        const initialScrape = await scraper.scrape(websiteUrl);
        previousContent = initialScrape.content;
        
        await db.query(`
            UPDATE monitored_urls 
            SET last_check = NOW(), 
                last_content = $1, 
                last_debug = $2,
                check_count = 0
            WHERE id = $3
        `, [initialScrape.content, JSON.stringify(initialScrape.debug), urlId]);

        console.log(`Initial scrape completed for URL ID ${urlId} - baseline content established`);
        
        // Get subscriber information for summary notifications
        const subscriberResult = await db.query(`
            SELECT email, phone_number, polling_duration
            FROM alert_subscribers 
            WHERE url_id = $1 
            AND is_active = true
            ORDER BY created_at DESC
            LIMIT 1
        `, [urlId]);
        
        if (subscriberResult.rows && subscriberResult.rows.length > 0) {
            subscriberInfo = subscriberResult.rows[0];
        }
    } catch (error) {
        console.error(`Error during initial scrape for URL ID ${urlId}:`, error);
    }

    // Schedule monitoring every 3 minutes
    const task = cron.schedule('*/3 * * * *', async () => {
        try {
            // Check if there are any active subscribers before proceeding
            const activeSubscribers = await db.query(`
                SELECT COUNT(*) 
                FROM alert_subscribers 
                WHERE url_id = $1 
                AND is_active = true
                AND NOW() < created_at + (polling_duration || ' minutes')::interval
            `, [urlId]);

            if (!activeSubscribers.rows[0] || parseInt(activeSubscribers.rows[0].count) === 0) {
                console.log(`No active subscribers left for URL ID ${urlId}, stopping monitoring`);
                
                // Send summary notifications before stopping - get ALL subscribers
                try {
                    const finalCheckCount = await db.query(
                        'SELECT check_count FROM monitored_urls WHERE id = $1',
                        [urlId]
                    );
                    
                    const checkCount = finalCheckCount.rows[0]?.check_count || 0;
                    
                    // Get all subscribers for this URL to send summary
                    const allSubscribers = await db.query(`
                        SELECT id as subscriber_id, email, phone_number, polling_duration
                        FROM alert_subscribers 
                        WHERE url_id = $1
                        ORDER BY created_at DESC
                    `, [urlId]);
                    
                    const summaryNotifications = [];
                    
                    // Send summary to all subscribers
                    for (const sub of allSubscribers.rows) {
                        if (sub.email) {
                            console.log('========== SENDING SUMMARY EMAIL ==========');
                            console.log(`Preparing to send summary email to: ${sub.email}`);
                            console.log(`Check count: ${checkCount}`);
                            console.log(`Changes detected: ${changesDetected}`);
                            
                            summaryNotifications.push(
                                emailService.sendSummaryEmail(
                                    sub.email, 
                                    websiteUrl, 
                                    sub.polling_duration, 
                                    checkCount, 
                                    changesDetected,
                                    new Date(),
                                    sub.subscriber_id
                                ).then(() => {
                                    console.log(`Summary email sent successfully to ${sub.email}`);
                                    console.log('========== SUMMARY EMAIL SENT ==========');
                                })
                                .catch(error => {
                                    console.error('========== SUMMARY EMAIL ERROR ==========');
                                    console.error(`Error sending summary email to ${sub.email}:`, error);
                                    console.error('Error stack:', error.stack);
                                    console.error('========== SUMMARY EMAIL ERROR END ==========');
                                })
                            );
                        }
                        
                        if (sub.phone_number && sub.phone_number.trim() !== '') {
                            console.log(`Preparing to send summary SMS to: ${sub.phone_number}`);
                            summaryNotifications.push(
                                smsService.sendSummarySMS(
                                    sub.phone_number, 
                                    websiteUrl, 
                                    checkCount, 
                                    changesDetected
                                ).then(() => console.log(`Summary SMS sent successfully to ${sub.phone_number}`))
                                .catch(error => console.error(`Error sending summary SMS to ${sub.phone_number}:`, error))
                            );
                        }
                    }
                    
                    if (summaryNotifications.length > 0) {
                        await Promise.all(summaryNotifications);
                        console.log(`Summary notifications sent to ${allSubscribers.rows.length} subscriber(s) for URL ID ${urlId}`);
                    }
                } catch (error) {
                    console.error(`Error sending summary notifications for URL ID ${urlId}:`, error);
                }
                
                task.stop();
                monitoringTasks.delete(urlId);
                await db.query('UPDATE monitored_urls SET is_active = false WHERE id = $1', [urlId]);
                return;
            }

            console.log(`Checking URL ID ${urlId}: ${websiteUrl}`);
            
            // Scrape the URL
            const { content, debug } = await scraper.scrape(websiteUrl);

            // Update last check and content
            await db.query(
                'UPDATE monitored_urls SET last_check = NOW(), last_content = $1, last_debug = $2 WHERE id = $3',
                [content, JSON.stringify(debug), urlId]
            );

            // Only increment check count and compare after the first check
            // The initial scrape establishes the baseline, subsequent checks compare against it
            if (previousContent !== null) {
                // Update check count only after first comparison (not after initial baseline scrape)
                await db.query(
                    'UPDATE monitored_urls SET check_count = check_count + 1 WHERE id = $1',
                    [urlId]
                );

                // Clean content before comparison to filter out ad-related changes
                const cleanedContent = cleanContentForComparison(content);
                const cleanedPreviousContent = cleanContentForComparison(previousContent);

                if (cleanedContent !== cleanedPreviousContent) {
                    console.log(`Change detected for URL ID ${urlId}`);
                    console.log(`Previous content length: ${previousContent ? previousContent.length : 0}`);
                    console.log(`New content length: ${content.length}`);
                    changesDetected++;

                    // Get all active subscribers for this URL
                    const subscribers = await db.query(`
                        SELECT 
                            id as subscriber_id,
                            email,
                            phone_number
                        FROM alert_subscribers 
                        WHERE url_id = $1 
                        AND is_active = true
                        AND NOW() < created_at + (polling_duration || ' minutes')::interval
                    `, [urlId]);

                    console.log(`Found ${subscribers.rows.length} active subscriber(s) for URL ID ${urlId}`);

                    // Record the change once
                    const changeRecord = await db.query(`
                        INSERT INTO alerts_history 
                            (monitored_url_id, detected_at, content_before, content_after) 
                        VALUES ($1, NOW(), $2, $3) 
                        RETURNING id
                    `, [urlId, previousContent, content]);

                    // Notify all subscribers
                    if (subscribers.rows && subscribers.rows.length > 0) {
                        for (const subscriber of subscribers.rows) {
                            try {
                                console.log(`Sending notifications to subscriber ${subscriber.subscriber_id} (email: ${subscriber.email})`);
                                
                                // Send notifications
                                const notifications = [];
                                
                                if (subscriber.email) {
                                    console.log('========== SENDING ALERT EMAIL ==========');
                                    console.log(`Sending email alert to: ${subscriber.email}`);
                                    console.log(`Subscriber ID: ${subscriber.subscriber_id}`);
                                    console.log(`Website URL: ${websiteUrl}`);
                                    
                                    notifications.push(
                                        emailService.sendAlert(subscriber.email, websiteUrl, previousContent, content, subscriber.subscriber_id)
                                            .then(result => {
                                                console.log(`Email alert sent successfully to ${subscriber.email}`);
                                                console.log(`Message ID: ${result.messageId}`);
                                                return db.query(
                                                    'UPDATE alerts_history SET email_sent = true WHERE id = $1',
                                                    [changeRecord.rows[0].id]
                                                );
                                            })
                                            .catch(error => {
                                                console.error('========== ALERT EMAIL SEND FAILED ==========');
                                                console.error(`Email notification failed for subscriber ${subscriber.subscriber_id}:`, error);
                                                console.error(`Error details: ${error.message}`);
                                                console.error(`Error stack:`, error.stack);
                                                console.error('========== ALERT EMAIL SEND FAILED END ==========');
                                            })
                                    );
                                }
                                
                                if (subscriber.phone_number && subscriber.phone_number.trim() !== '') {
                                    console.log(`Sending SMS alert to: ${subscriber.phone_number}`);
                                    notifications.push(
                                        smsService.sendAlert(subscriber.phone_number, websiteUrl)
                                            .then(() => {
                                                console.log(`SMS alert sent successfully to ${subscriber.phone_number}`);
                                                return db.query(
                                                    'UPDATE alerts_history SET sms_sent = true WHERE id = $1',
                                                    [changeRecord.rows[0].id]
                                                );
                                            })
                                            .catch(error => {
                                                console.error(`SMS notification failed for subscriber ${subscriber.subscriber_id}:`, error);
                                                console.error(`Error details: ${error.message}`);
                                            })
                                    );
                                }
                                
                                if (notifications.length > 0) {
                                    await Promise.all(notifications);
                                    console.log(`Notifications completed for subscriber ${subscriber.subscriber_id}`);
                                }
                            } catch (error) {
                                console.error(`Error notifying subscriber ${subscriber.subscriber_id}:`, error);
                            }
                        }
                    } else {
                        console.log(`No active subscribers found for URL ID ${urlId}`);
                    }
                    
                } else {
                    console.log(`No change detected for URL ID ${urlId} - content matches (after filtering ads)`);
                }

                // Store the original content (not cleaned) for display purposes
                previousContent = content;
            }

        } catch (error) {
            console.error(`Error in monitoring task for URL ID ${urlId}:`, error);
        }
    });

    monitoringTasks.set(urlId, task);
}

// Test database connection (non-blocking - app will work even if DB is unavailable)
// Wait a bit for the pool to initialize, then test connection
setTimeout(() => {
    db.connect(async (err) => {
        if (err) {
            console.warn('Database connection error (non-fatal):', err.message);
            console.warn('Web-Alert API endpoints will not work until database is available');
            console.warn('Other services (3D Print, Citrix, VINValue) will continue to work normally');
        } else {
            console.log('Database connected successfully');
        try {
            // Initialize schema
            console.log('Initializing database schema...');
            
            // Create monitored_urls table
            console.log('Creating monitored_urls table...');
            await db.query(`
                CREATE TABLE IF NOT EXISTS monitored_urls (
                    id SERIAL PRIMARY KEY,
                    website_url TEXT NOT NULL UNIQUE,
                    last_check TIMESTAMP,
                    last_content TEXT,
                    last_debug JSONB,
                    check_count INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create alert_subscribers table
            console.log('Creating alert_subscribers table...');
            await db.query(`
                CREATE TABLE IF NOT EXISTS alert_subscribers (
                    id SERIAL PRIMARY KEY,
                    url_id INTEGER REFERENCES monitored_urls(id),
                    email VARCHAR(255) NOT NULL,
                    phone_number VARCHAR(20),
                    polling_duration INTEGER NOT NULL,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Create alerts_history table
            console.log('Creating alerts_history table...');
            await db.query(`
                CREATE TABLE IF NOT EXISTS alerts_history (
                    id SERIAL PRIMARY KEY,
                    monitored_url_id INTEGER REFERENCES monitored_urls(id),
                    subscriber_id INTEGER REFERENCES alert_subscribers(id),
                    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    email_sent BOOLEAN DEFAULT false,
                    sms_sent BOOLEAN DEFAULT false,
                    content_before TEXT,
                    content_after TEXT
                )
            `);

            console.log('Database schema initialized successfully');

            // Alter existing alert_subscribers table to make phone_number nullable
            try {
                console.log('Updating alert_subscribers table to make phone_number nullable...');
                await db.query(`
                    ALTER TABLE alert_subscribers 
                    ALTER COLUMN phone_number DROP NOT NULL
                `);
                console.log('Successfully updated phone_number column to be nullable');
            } catch (error) {
                if (error.code === '42701') {
                    console.log('Column phone_number already nullable or table does not exist yet');
                } else {
                    console.error('Error updating phone_number column:', error.message);
                }
            }

            // Verify tables were created
            const tables = ['monitored_urls', 'alert_subscribers', 'alerts_history'];
            for (const table of tables) {
                const result = await db.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [table]);
                console.log(`Table ${table} exists:`, result.rows[0].exists);
            }

            // Start monitoring for any existing active URLs
            const activeUrls = await db.query(`
                SELECT id, website_url 
                FROM monitored_urls 
                WHERE is_active = true
            `);

            for (const url of activeUrls.rows) {
                await startUrlMonitoring(url.id, url.website_url);
            }
            console.log(`Resumed monitoring for ${activeUrls.rows.length} active URLs`);

        } catch (error) {
            console.warn('Error initializing database schema (non-fatal):', error.message);
            console.warn('Database will be retried when API endpoints are accessed');
            // Log additional diagnostic information
            console.warn('Current directory:', process.cwd());
            console.warn('Environment:', process.env.NODE_ENV);
            console.warn('Database config:', {
                host: process.env.DB_HOST,
                database: process.env.DB_NAME,
                port: process.env.DB_PORT
            });
        }
    }
    });
}, 2000); // Wait 2 seconds for pool initialization

// Add specific routes for HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.get('/status.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/status.html'));
});

app.get('/stop/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/stop.html'));
});

// API endpoint to get subscriber information
app.get('/api/subscriber/:id', async (req, res) => {
    try {
        const subscriberId = parseInt(req.params.id);
        if (isNaN(subscriberId)) {
            return res.status(400).json({ success: false, error: 'Invalid subscriber ID' });
        }
        
        const result = await db.query(`
            SELECT 
                s.id,
                s.email,
                s.phone_number,
                s.polling_duration,
                s.is_active,
                s.created_at,
                u.website_url
            FROM alert_subscribers s
            JOIN monitored_urls u ON s.url_id = u.id
            WHERE s.id = $1
        `, [subscriberId]);
        
        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Subscriber not found' });
        }
        
        res.json({
            success: true,
            subscriber: result.rows[0]
        });
    } catch (error) {
        console.error('Error fetching subscriber:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch subscriber information' });
    }
});

// API endpoint to stop alerts for a specific subscriber
app.post('/api/stop/:id', async (req, res) => {
    try {
        const subscriberId = parseInt(req.params.id);
        if (isNaN(subscriberId)) {
            return res.status(400).json({ success: false, error: 'Invalid subscriber ID' });
        }
        
        // Get subscriber info to find url_id
        const subscriberResult = await db.query(`
            SELECT url_id FROM alert_subscribers WHERE id = $1
        `, [subscriberId]);
        
        if (!subscriberResult.rows || subscriberResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Subscriber not found' });
        }
        
        const urlId = subscriberResult.rows[0].url_id;
        
        // Deactivate the subscriber
        await db.query(`
            UPDATE alert_subscribers 
            SET is_active = false 
            WHERE id = $1
        `, [subscriberId]);
        
        // Check if there are any other active subscribers for this URL
        const activeSubscribers = await db.query(`
            SELECT COUNT(*) as count 
            FROM alert_subscribers 
            WHERE url_id = $1 AND is_active = true
        `, [urlId]);
        
        // If no active subscribers, stop monitoring
        if (parseInt(activeSubscribers.rows[0].count) === 0) {
            const task = monitoringTasks.get(urlId);
            if (task) {
                console.log(`Stopping monitoring for URL ID ${urlId} - no active subscribers`);
                task.stop();
                monitoringTasks.delete(urlId);
            }
        }
        
        res.json({
            success: true,
            message: 'Alerts stopped successfully'
        });
    } catch (error) {
        console.error('Error stopping alerts:', error);
        res.status(500).json({ success: false, error: 'Failed to stop alerts' });
    }
});

app.get('/MOVING.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/MOVING.html'));
});

app.get('/test-notifications.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/test-notifications.html'));
});

// Keep the health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
        dbConnected: db.pool ? true : false,
        dbConfig: {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT
        }
    });
});

// API endpoint to start monitoring
app.post('/api/monitor', async (req, res) => {
    console.log('[Web-Alert API] POST /api/monitor called');
    console.log('[Web-Alert API] Request path:', req.path);
    console.log('[Web-Alert API] Request originalUrl:', req.originalUrl);
    console.log('[Web-Alert API] Request baseUrl:', req.baseUrl);
    console.log('[Web-Alert API] Request body:', req.body);
    
    let { websiteUrl, email, phone, duration } = req.body;

    try {
        // Log the incoming request
        console.log('[Web-Alert API] Received monitoring request:', { websiteUrl, email, phone, duration });

        // Normalize the URL
        if (websiteUrl.toLowerCase().includes('moving.html')) {
            websiteUrl = websiteUrl.replace(/moving\.html/i, 'MOVING.html');
        }

        // Validate required fields (phone is now optional, email is required)
        if (!websiteUrl || !email || !duration) {
            console.log('Missing required fields:', { websiteUrl, email, phone, duration });
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['websiteUrl', 'email', 'duration'],
                received: { websiteUrl, email, phone, duration }
            });
        }

        // First, get or create the monitored URL
        console.log('Checking for existing URL record...');
        let urlRecord = await db.query(
            'SELECT * FROM monitored_urls WHERE website_url = $1',
            [websiteUrl]
        );

        let urlId;
        if (!urlRecord.rows || urlRecord.rows.length === 0) {
            console.log('Creating new URL record...');
            const newUrl = await db.query(
                'INSERT INTO monitored_urls (website_url, is_active) VALUES ($1, true) RETURNING *',
                [websiteUrl]
            );
            
            if (!newUrl.rows || newUrl.rows.length === 0) {
                throw new Error('Failed to create URL record');
            }
            
            urlId = newUrl.rows[0].id;
            console.log('Created new URL record with ID:', urlId);
        } else {
            urlId = urlRecord.rows[0].id;
            console.log('Found existing URL record with ID:', urlId);

            // Reactivate the URL if it was inactive
            await db.query(
                'UPDATE monitored_urls SET is_active = true WHERE id = $1',
                [urlId]
            );
        }

        // Create subscriber record
        console.log('Creating subscriber record...');
        
        // Handle phone number insertion - use conditional logic to avoid NULL constraint issues
        let subscriber;
        if (phone && phone.trim() !== '') {
            subscriber = await db.query(`
                INSERT INTO alert_subscribers 
                    (url_id, email, phone_number, polling_duration) 
                VALUES ($1, $2, $3, $4) 
                RETURNING *
            `, [urlId, email, phone, duration]);
        } else {
            // For databases that still have NOT NULL constraint, we'll need to handle this differently
            // Try to insert without phone_number first
            try {
                subscriber = await db.query(`
                    INSERT INTO alert_subscribers 
                        (url_id, email, polling_duration) 
                    VALUES ($1, $2, $3) 
                    RETURNING *
                `, [urlId, email, duration]);
            } catch (error) {
                if (error.code === '23502' && error.detail.includes('phone_number')) {
                    // If the column still requires a value, insert with empty string
                    console.log('Phone number column still requires a value, using empty string...');
                    subscriber = await db.query(`
                        INSERT INTO alert_subscribers 
                            (url_id, email, phone_number, polling_duration) 
                        VALUES ($1, $2, $3, $4) 
                        RETURNING *
                    `, [urlId, email, '', duration]);
                } else {
                    throw error;
                }
            }
        }

        if (!subscriber.rows || subscriber.rows.length === 0) {
            throw new Error('Failed to create subscriber record');
        }

        // Start monitoring if not already active
        if (!monitoringTasks.has(urlId)) {
            console.log('Starting monitoring task...');
            
            // Send welcome notifications
            try {
                console.log('========== SENDING WELCOME NOTIFICATIONS ==========');
                const notifications = [];
                if (email) {
                    console.log(`Preparing to send welcome email to: ${email}`);
                    console.log(`Email config - USER: ${process.env.EMAIL_USER ? 'SET' : 'NOT SET'}, PASSWORD: ${process.env.EMAIL_PASSWORD ? 'SET' : 'NOT SET'}`);
                    console.log(`Email user value: ${process.env.EMAIL_USER ? process.env.EMAIL_USER.substring(0, 10) + '...' : 'NOT SET'}`);
                    
                    const subscriberId = subscriber.rows[0].id;
                    notifications.push(
                        emailService.sendWelcomeEmail(email, websiteUrl, duration, subscriberId)
                            .then(result => {
                                console.log('Welcome email sent successfully in server.js');
                                return result;
                            })
                            .catch(error => {
                                console.error('Welcome email failed in server.js:', error.message);
                                throw error;
                            })
                    );
                }
                if (phone && phone.trim() !== '') {
                    console.log(`Preparing to send welcome SMS to: ${phone}`);
                    notifications.push(smsService.sendWelcomeSMS(phone, websiteUrl, duration));
                }
                if (notifications.length > 0) {
                    console.log('Awaiting notification results...');
                    await Promise.all(notifications);
                    console.log('Welcome notifications sent successfully');
                }
                console.log('========== WELCOME NOTIFICATIONS COMPLETE ==========');
            } catch (error) {
                console.error('========== WELCOME NOTIFICATIONS ERROR ==========');
                console.error('Error sending welcome notifications:', error);
                console.error('Error stack:', error.stack);
                console.error('========== WELCOME NOTIFICATIONS ERROR END ==========');
                // Continue with monitoring even if welcome notifications fail
            }
            
            await startUrlMonitoring(urlId, websiteUrl);
        } else {
            console.log('Monitoring already active');
        }

        // Return success response
        const response = {
            success: true,
            message: 'Monitoring started successfully',
            data: {
                urlId: urlId,
                websiteUrl: websiteUrl,
                subscriber: subscriber.rows[0],
                isNewUrl: !urlRecord.rows || urlRecord.rows.length === 0
            }
        };
        
        console.log('Monitoring setup complete:', response);
        res.json(response);

    } catch (error) {
        console.error('[Web-Alert API] Error in /api/monitor:', error);
        console.error('[Web-Alert API] Error message:', error.message);
        console.error('[Web-Alert API] Error stack:', error.stack);
        res.status(500).json({ 
            success: false,
            error: 'Failed to start monitoring',
            message: error.message,
            details: error.stack
        });
    }
});

// Modify the status endpoint
app.get('/api/status', async (req, res) => {
    try {
        console.log('Fetching status from database...');
        
        // Check database connection first
        if (!db.pool) {
            throw new Error('Database connection not available');
        }
        
        // Note: We're NOT automatically stopping expired tasks anymore
        // This allows users to see all their monitoring history until they manually clear it
        
        console.log('Executing status query...');
        
        // Get ALL monitoring tasks (both active and completed)
        const result = await db.query(`
            WITH active_subscribers AS (
                SELECT 
                    url_id,
                    COUNT(*) as subscriber_count,
                    MAX(created_at + COALESCE(polling_duration, 0) * interval '1 minute') as latest_end_time
                FROM alert_subscribers
                WHERE is_active = true
                GROUP BY url_id
            ),
            change_counts AS (
                SELECT 
                    ah.monitored_url_id,
                    COUNT(DISTINCT ah.detected_at) as changes_count
                FROM alerts_history ah
                WHERE EXISTS (
                    SELECT 1 
                    FROM alert_subscribers asub 
                    WHERE asub.url_id = ah.monitored_url_id
                      AND ah.detected_at >= asub.created_at
                      AND ah.detected_at <= asub.created_at + COALESCE(asub.polling_duration, 0) * interval '1 minute'
                )
                GROUP BY ah.monitored_url_id
            ),
            latest_subscriber_info AS (
                SELECT DISTINCT ON (url_id)
                    id,
                    url_id,
                    email,
                    phone_number,
                    polling_duration,
                    created_at,
                    is_active
                FROM alert_subscribers
                ORDER BY url_id, created_at DESC
            )
            SELECT 
                mu.id,
                mu.website_url,
                mu.last_check,
                mu.check_count,
                mu.is_active,
                mu.created_at,
                lsi.email,
                lsi.phone_number,
                lsi.polling_duration,
                CASE 
                    WHEN lsi.id IS NOT NULL AND lsi.is_active = true AND lsi.polling_duration IS NOT NULL AND lsi.created_at IS NOT NULL
                         AND NOW() < lsi.created_at + COALESCE(lsi.polling_duration, 0) * interval '1 minute'
                    THEN EXTRACT(EPOCH FROM (lsi.created_at + COALESCE(lsi.polling_duration, 0) * interval '1 minute' - NOW()))/60
                    ELSE 0
                END as minutes_left,
                COALESCE(cc.changes_count, 0) as changes_count,
                COALESCE(as_count.subscriber_count, 0) as subscriber_count,
                CASE 
                    WHEN lsi.url_id IS NOT NULL AND lsi.is_active = true AND lsi.polling_duration IS NOT NULL AND lsi.created_at IS NOT NULL
                         AND NOW() < lsi.created_at + COALESCE(lsi.polling_duration, 0) * interval '1 minute'
                    THEN 'Active'
                    ELSE 'Completed'
                END as status_text
            FROM monitored_urls mu
            LEFT JOIN latest_subscriber_info lsi ON mu.id = lsi.url_id
            LEFT JOIN change_counts cc ON cc.monitored_url_id = mu.id
            LEFT JOIN active_subscribers as_count ON as_count.url_id = mu.id
            ORDER BY mu.last_check DESC NULLS LAST, mu.created_at DESC
        `);

        console.log(`Status query completed. Found ${result.rows.length} rows.`);
        console.log('Sample row data:', result.rows[0] || 'No rows found');
        
        // Format the results with additional error handling
        const formattedResults = result.rows.map((row, index) => {
            try {
                // Validate that required fields exist
                if (!row.id) {
                    console.error(`Row ${index} missing ID:`, row);
                    return null; // Skip invalid rows
                }
                
                return {
                    ...row,
                    last_check: row.last_check ? row.last_check.toISOString() : null,
                    created_at: row.created_at ? row.created_at.toISOString() : null,
                    minutes_left: Math.max(0, Math.round(row.minutes_left || 0)),
                    changes_count: parseInt(row.changes_count || 0),
                    check_count: parseInt(row.check_count || 0),
                    subscriber_count: parseInt(row.subscriber_count || 0),
                    status: row.status_text || 'Unknown'
                };
            } catch (error) {
                console.error(`Error formatting row ${index}:`, error, 'Row data:', row);
                return null; // Skip problematic rows
            }
        }).filter(row => row !== null); // Remove any null rows

        console.log('Sending formatted status response:', formattedResults);
        res.json(formattedResults);
    } catch (error) {
        console.error('========== ERROR FETCHING STATUS ==========');
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error detail:', error.detail);
        console.error('Error hint:', error.hint);
        console.error('Error stack:', error.stack);
        console.error('===========================================');
        res.status(500).json({ 
            error: 'Failed to fetch monitoring status',
            message: error.message,
            detail: error.detail || error.hint || 'No additional details',
            timestamp: new Date().toISOString()
        });
    }
});

// Add a test endpoint
app.get('/api/test-db', async (req, res) => {
    try {
        console.log('Testing database connection...');
        
        // Check if pool exists
        if (!db.pool) {
            return res.status(500).json({
                success: false,
                error: 'Database pool not available',
                dbConfig: {
                    host: process.env.DB_HOST,
                    user: process.env.DB_USER,
                    database: process.env.DB_NAME,
                    port: process.env.DB_PORT
                }
            });
        }
        
        const result = await db.query('SELECT NOW()');
        res.json({
            success: true,
            timestamp: result.rows[0].now,
            dbConfig: {
                host: process.env.DB_HOST,
                user: process.env.DB_USER,
                database: process.env.DB_NAME,
                port: process.env.DB_PORT
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            details: {
                code: error.code,
                detail: error.detail
            }
        });
    }
});

// Add route logging middleware (but skip static file requests to reduce noise)
app.use((req, res, next) => {
    // Skip logging for static assets (images, CSS, JS) to reduce log noise
    const staticExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.css', '.js', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot'];
    const isStaticFile = staticExtensions.some(ext => req.path.toLowerCase().endsWith(ext));
    
    if (!isStaticFile) {
        console.log(`[Web-Alert] ${new Date().toISOString()} - ${req.method} ${req.path}`);
        console.log(`[Web-Alert] Original URL: ${req.originalUrl}, Base URL: ${req.baseUrl}`);
        console.log(`[Web-Alert] Request body:`, req.body);
        console.log(`[Web-Alert] Request query:`, req.query);
    }
    next();
});

// Modify the test-insert endpoint to explicitly handle GET and POST
app.get('/api/test-insert', async (req, res) => {
    try {
        console.log('GET /api/test-insert called');
        const testData = {
            website_url: 'https://test.com',
            email: 'test@test.com',
            phone_number: '1234567890',
            polling_duration: 5
        };

        // First test the connection
        console.log('Testing connection...');
        const connectionTest = await db.query('SELECT NOW()');
        console.log('Connection test result:', connectionTest.rows[0]);

        console.log('Testing direct insert with data:', testData);
        const result = await db.query(`
            INSERT INTO web_alerts 
                (website_url, email, phone_number, polling_duration) 
            VALUES 
                ($1, $2, $3, $4) 
            RETURNING *
        `, [testData.website_url, testData.email, testData.phone_number, testData.polling_duration]);

        console.log('Insert successful, result:', result.rows[0]);

        // Verify the insert
        const verify = await db.query('SELECT * FROM web_alerts WHERE id = $1', [result.rows[0].id]);
        
        res.json({
            success: true,
            connectionTest: connectionTest.rows[0],
            insertedRow: result.rows[0],
            verifiedRow: verify.rows[0],
            message: 'Test insert successful'
        });
    } catch (error) {
        console.error('Test insert failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: {
                code: error.code,
                detail: error.detail,
                stack: error.stack
            }
        });
    }
});

// Also add a POST handler for completeness
app.post('/api/test-insert', async (req, res) => {
    // Same handler as GET
    // ... copy the same code as above ...
});

// Add this near your other endpoints
app.get('/api/health', async (req, res) => {
    try {
        const dbHealth = await db.checkHealth();
        const systemInfo = {
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            nodeVersion: process.version,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime(),
            activeMonitoringTasks: monitoringTasks.size
        };

        if (dbHealth.status === 'healthy') {
            res.json({
                status: 'healthy',
                database: dbHealth,
                system: systemInfo
            });
        } else {
            res.status(500).json({
                status: 'unhealthy',
                database: dbHealth,
                system: systemInfo
            });
        }
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message,
            stack: error.stack
        });
    }
});

// Add this simple test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'Test route working' });
});

// Add this new endpoint
app.get('/api/alerts-history/:alertId', async (req, res) => {
    try {
        const { alertId } = req.params;
        const result = await db.query(`
            SELECT 
                ah.*,
                wa.website_url,
                wa.email,
                wa.phone_number
            FROM alerts_history ah
            JOIN web_alerts wa ON wa.id = ah.alert_id
            WHERE ah.alert_id = $1
            ORDER BY ah.detected_at DESC
        `, [alertId]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching alert history:', error);
        res.status(500).json({ error: 'Failed to fetch alert history' });
    }
});

// Add this new endpoint to view scraped content
app.get('/api/content/:alertId', async (req, res) => {
    try {
        const { alertId } = req.params;
        
        // Get current content
        const currentContent = await db.query(`
            SELECT website_url, last_content, last_check 
            FROM web_alerts 
            WHERE id = $1
        `, [alertId]);

        // Get content history
        const contentHistory = await db.query(`
            SELECT 
                detected_at,
                content_before,
                content_after
            FROM alerts_history 
            WHERE alert_id = $1 
            ORDER BY detected_at DESC
        `, [alertId]);

        res.json({
            current: currentContent.rows[0] || null,
            history: contentHistory.rows || []
        });
    } catch (error) {
        console.error('Error fetching content:', error);
        res.status(500).json({ error: 'Failed to fetch content history' });
    }
});

// Add this new endpoint for debug view
app.get('/api/debug/:alertId', async (req, res) => {
    try {
        const { alertId } = req.params;
        const result = await db.query(`
            SELECT 
                website_url,
                last_check,
                last_content,
                last_debug,
                check_count,
                polling_duration
            FROM web_alerts 
            WHERE id = $1
        `, [alertId]);

        if (!result.rows[0]) {
            return res.status(404).json({ error: 'Alert not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching debug info:', error);
        res.status(500).json({ error: 'Failed to fetch debug info' });
    }
});

// Add this new test endpoint
app.get('/api/test-scrape', async (req, res) => {
    const url = req.query.url || 'https://example.com';
    try {
        console.log(`Testing scraper with URL: ${url}`);
        const { content, debug } = await scraper.scrape(url);
        
        res.json({
            success: true,
            url,
            contentLength: content.length,
            contentPreview: content.substring(0, 500),
            debug
        });
    } catch (error) {
        console.error('Test scrape failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack,
            debug: error.debug
        });
    }
});

// Add these test endpoints
app.get('/api/test-email', async (req, res) => {
    const testEmail = req.query.email || 'test@example.com';
    const testUrl = req.query.url || 'https://example.com';
    
    try {
        console.log('=== EMAIL TEST STARTED ===');
        console.log('Test parameters:', { testEmail, testUrl });
        console.log('Testing email service...');
        
        // Sample content changes for testing
        const sampleContentBefore = "Welcome to our sailing website. We offer sailing lessons and boat rentals.";
        const sampleContentAfter = "Welcome to our sailing website. We offer sailing lessons, boat rentals, and yacht charters.";
        
        console.log('Calling emailService.sendAlert...');
        const result = await emailService.sendAlert(testEmail, testUrl, sampleContentBefore, sampleContentAfter);
        console.log('Email service result:', result);
        
        const response = {
            success: true,
            message: 'Test email sent successfully',
            details: result
        };
        console.log('Sending success response:', response);
        res.json(response);
    } catch (error) {
        console.error('=== EMAIL TEST FAILED ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

// Add these test endpoints for SMS
app.get('/api/test-sms', async (req, res) => {
    const testPhone = req.query.phone || '+1234567890';
    const testUrl = req.query.url || 'https://example.com';
    
    try {
        console.log('=== SMS TEST STARTED ===');
        console.log('Test parameters:', { testPhone, testUrl });
        
        // First test the connection
        console.log('Testing SMS service connection...');
        const connectionTest = await smsService.testConnection();
        console.log('SMS connection test result:', connectionTest);

        if (connectionTest.status === 'error') {
            throw new Error(`SMS service connection failed: ${connectionTest.error}`);
        }

        // Then try to send a message
        console.log('Calling smsService.sendAlert...');
        const result = await smsService.sendAlert(testPhone, testUrl);
        console.log('SMS service result:', result);
        
        const response = {
            success: true,
            message: 'Test SMS sent successfully',
            connectionTest,
            smsResult: result
        };
        console.log('Sending success response:', response);
        res.json(response);
    } catch (error) {
        console.error('=== SMS TEST FAILED ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code,
            connectionTest: await smsService.testConnection(),
            smsConfig: {
                method: 'email-to-sms-gateway',
                status: 'configured'
            }
        });
    }
});

// SMS service status check endpoint
app.get('/api/check-sms', async (req, res) => {
    try {
        const connectionTest = await smsService.testConnection();
        res.json({
            status: 'success',
            connection: connectionTest,
            config: {
                method: 'email-to-sms-gateway',
                status: 'configured'
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// Test welcome notifications
app.get('/api/test-welcome', async (req, res) => {
    const testEmail = req.query.email || 'test@example.com';
    const testPhone = req.query.phone || '+1234567890';
    const testUrl = req.query.url || 'https://example.com';
    const testDuration = parseInt(req.query.duration) || 30;
    
    try {
        console.log('Testing welcome notifications...');
        const results = await Promise.all([
            emailService.sendWelcomeEmail(testEmail, testUrl, testDuration),
            smsService.sendWelcomeSMS(testPhone, testUrl, testDuration)
        ]);
        
        res.json({
            success: true,
            message: 'Welcome notifications sent successfully',
            emailResult: results[0].messageId,
            smsResult: results[1].messageId || results[1].status
        });
    } catch (error) {
        console.error('Test welcome notifications failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

// Test summary notifications
app.get('/api/test-summary', async (req, res) => {
    const testEmail = req.query.email || 'test@example.com';
    const testPhone = req.query.phone || '+1234567890';
    const testUrl = req.query.url || 'https://example.com';
    const testDuration = parseInt(req.query.duration) || 30;
    const testCheckCount = parseInt(req.query.checks) || 6;
    const testChanges = parseInt(req.query.changes) || 0;
    
    try {
        console.log('Testing summary notifications...');
        const results = await Promise.all([
            emailService.sendSummaryEmail(testEmail, testUrl, testDuration, testCheckCount, testChanges, new Date()),
            smsService.sendSummarySMS(testPhone, testUrl, testCheckCount, testChanges)
        ]);
        
        res.json({
            success: true,
            message: 'Summary notifications sent successfully',
            emailResult: results[0].messageId,
            smsResult: results[1].sid
        });
    } catch (error) {
        console.error('Test summary notifications failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

// Add a test endpoint for Email-to-SMS gateway
app.post('/api/test-sms-gateway', async (req, res) => {
    try {
        const { phone, carrier, message, preferMms, tryAll, fallback, blankSubject, shortMessage } = req.body || {};
        if (!phone || !carrier) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['phone', 'carrier'],
                received: { phone, carrier }
            });
        }

        const text = message || 'This is a test message from Web-Alert via email-to-SMS gateway.';
        const result = await smsService.sendViaEmailGateway(
            phone,
            carrier,
            text,
            'Web Alert Test',
            preferMms !== false, // default true
            fallback !== false,  // default true
            tryAll === true,      // default false
            { blankSubject: blankSubject === true, shortMessage: shortMessage === true }
        );

        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, attempts: error.attempts });
    }
});

// Test all carriers endpoint
app.post('/api/test-all-carriers', async (req, res) => {
    try {
        const { phone, message } = req.body || {};
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Missing phone number',
                required: ['phone']
            });
        }

        console.log(`Testing all carriers for phone: ${phone}`);
        const results = await smsService.testAllCarriers(phone, message || 'Test');
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        res.json({ 
            success: true, 
            summary: {
                total: results.length,
                successful: successful.length,
                failed: failed.length
            },
            results 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add this endpoint to check active monitoring
app.get('/api/active-monitors', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                id,
                website_url,
                email,
                phone_number,
                polling_duration,
                check_count,
                last_check,
                created_at,
                is_active,
                polling_duration - check_count as checks_remaining,
                ROUND((check_count::float / polling_duration::float * 100), 1) as progress_percent,
                NOW() - last_check as time_since_last_check
            FROM web_alerts 
            WHERE is_active = true 
            ORDER BY last_check DESC
        `);

        // Get stuck monitors (haven't checked in over 5 minutes)
        const stuckMonitors = await db.query(`
            SELECT id, website_url, last_check, NOW() - last_check as stuck_time
            FROM web_alerts 
            WHERE 
                is_active = true 
                AND (NOW() - last_check) > interval '5 minutes'
        `);

        res.json({
            activeCount: result.rows.length,
            activeMonitors: result.rows,
            stuckMonitors: stuckMonitors.rows,
            monitoringTaskCount: monitoringTasks.size
        });
    } catch (error) {
        console.error('Error fetching active monitors:', error);
        res.status(500).json({ error: 'Failed to fetch active monitors' });
    }
});

// Add this endpoint to stop overrun scans
app.post('/api/stop-overrun-scans', async (req, res) => {
    try {
        // Find all scans that have exceeded their duration
        const overrunScans = await db.query(`
            SELECT 
                id,
                website_url,
                check_count,
                polling_duration
            FROM web_alerts 
            WHERE 
                is_active = true 
                AND check_count >= polling_duration
        `);

        console.log('Found overrun scans:', overrunScans.rows);

        // Stop each overrun scan
        for (const scan of overrunScans.rows) {
            // Stop the monitoring task if it exists
            if (monitoringTasks.has(scan.id)) {
                console.log(`Stopping monitoring task for ID ${scan.id}`);
                monitoringTasks.get(scan.id).stop();
                monitoringTasks.delete(scan.id);
            }

            // Mark as inactive in database
            await db.query(`
                UPDATE web_alerts 
                SET is_active = false 
                WHERE id = $1
            `, [scan.id]);

            console.log(`Marked scan ${scan.id} as inactive`);
        }

        res.json({
            message: 'Overrun scans stopped',
            stoppedScans: overrunScans.rows,
            count: overrunScans.rows.length
        });
    } catch (error) {
        console.error('Error stopping overrun scans:', error);
        res.status(500).json({ error: 'Failed to stop overrun scans' });
    }
});

// Add an endpoint to force stop a specific scan
app.post('/api/stop-scan/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Stop the monitoring task if it exists
        if (monitoringTasks.has(parseInt(id))) {
            monitoringTasks.get(parseInt(id)).stop();
            monitoringTasks.delete(parseInt(id));
        }

        // Mark as inactive in database
        await db.query(`
            UPDATE web_alerts 
            SET is_active = false 
            WHERE id = $1
            RETURNING id, website_url, check_count, polling_duration
        `, [id]);

        res.json({
            message: `Scan ${id} stopped successfully`,
            taskStopped: true,
            taskRemoved: true
        });
    } catch (error) {
        console.error(`Error stopping scan ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to stop scan' });
    }
});

// Helper function to find where content differs
function findFirstDifference(str1, str2) {
    const minLength = Math.min(str1.length, str2.length);
    for (let i = 0; i < minLength; i++) {
        if (str1[i] !== str2[i]) {
            const start = Math.max(0, i - 20);
            const end = Math.min(i + 20, minLength);
            return {
                position: i,
                context: {
                    str1: str1.substring(start, end),
                    str2: str2.substring(start, end)
                }
            };
        }
    }
    return { position: minLength, lengthDifference: str1.length - str2.length };
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Modify the server startup (only if running as standalone)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running on port ${PORT}`);
      console.log('Environment:', process.env.NODE_ENV);
      console.log('Database host:', process.env.DB_HOST);
      console.log('Chrome path:', process.env.PUPPETEER_EXECUTABLE_PATH);
      console.log('Current working directory:', process.cwd());
      console.log('Directory contents:', require('fs').readdirSync('.'));
  }).on('error', (err) => {
      console.error('Server failed to start:', err);
      process.exit(1);
  });

  // Add graceful shutdown
  process.on('SIGTERM', () => {
      console.log('SIGTERM received. Shutting down gracefully...');
      server.close(() => {
          console.log('Server closed');
          process.exit(0);
      });
  });
} else {
  // Being required as a module - export the app
  console.log('[Web-Alert] App is being required as a module (not running standalone)');
  console.log('[Web-Alert] Logging registered routes after initialization...');
  
  // Log all registered routes after a short delay to ensure all routes are registered
  setTimeout(() => {
    console.log('[Web-Alert] === Registered Routes ===');
    if (app._router && app._router.stack) {
      let routeCount = 0;
      app._router.stack.forEach((middleware, index) => {
        if (middleware.route) {
          const methods = Object.keys(middleware.route.methods).join(', ').toUpperCase();
          console.log(`  [${index}] ${methods} ${middleware.route.path}`);
          routeCount++;
        } else if (middleware.name === 'router') {
          console.log(`  [${index}] Router middleware`);
        } else if (middleware.name) {
          console.log(`  [${index}] ${middleware.name} middleware`);
        }
      });
      console.log(`[Web-Alert] Total routes found: ${routeCount}`);
    } else {
      console.log('  Router stack not available yet');
    }
    console.log('[Web-Alert] === End Routes ===');
  }, 200);
  
  module.exports = app;
}

// Add these new endpoints near the other API endpoints

// Stop all monitoring tasks
app.post('/api/stop-all-monitoring', async (req, res) => {
    try {
        console.log('Stopping all monitoring tasks...');
        
        // Stop all cron tasks
        for (const [urlId, task] of monitoringTasks.entries()) {
            console.log(`Stopping monitoring for URL ID: ${urlId}`);
            task.stop();
        }
        
        // Clear the monitoring tasks map
        monitoringTasks.clear();

        // Update database to mark all URLs as inactive
        await db.query(`
            UPDATE monitored_urls 
            SET is_active = false 
            WHERE is_active = true
        `);

        // Update all subscribers to inactive
        await db.query(`
            UPDATE alert_subscribers 
            SET is_active = false 
            WHERE is_active = true
        `);

        res.json({
            message: 'All monitoring tasks stopped successfully',
            tasksStoppedCount: monitoringTasks.size
        });
    } catch (error) {
        console.error('Error stopping monitoring tasks:', error);
        res.status(500).json({ error: 'Failed to stop monitoring tasks' });
    }
});

// Clear completed monitoring jobs
app.post('/api/clear-history', async (req, res) => {
    try {
        console.log('Clearing completed monitoring jobs...');

        // Delete completed alerts
        const deletedAlerts = await db.query(`
            DELETE FROM alerts_history 
            WHERE email_sent = true 
            AND sms_sent = true
            RETURNING id
        `);

        // Delete completed subscribers (those that have expired)
        const deletedSubscribers = await db.query(`
            DELETE FROM alert_subscribers 
            WHERE is_active = false 
            AND created_at + (polling_duration || ' minutes')::interval < NOW()
            AND NOT EXISTS (
                SELECT 1 
                FROM alerts_history 
                WHERE alerts_history.subscriber_id = alert_subscribers.id
            )
            RETURNING id
        `);

        // Delete completed URLs (those with no active subscribers and expired)
        const deletedUrls = await db.query(`
            DELETE FROM monitored_urls 
            WHERE is_active = false 
            AND NOT EXISTS (
                SELECT 1 
                FROM alert_subscribers 
                WHERE alert_subscribers.url_id = monitored_urls.id
                AND alert_subscribers.is_active = true
                AND NOW() < alert_subscribers.created_at + (alert_subscribers.polling_duration || ' minutes')::interval
            )
            RETURNING id
        `);

        res.json({
            message: 'Completed monitoring jobs cleared successfully',
            deletedCounts: {
                alerts: deletedAlerts.rows.length,
                subscribers: deletedSubscribers.rows.length,
                urls: deletedUrls.rows.length
            }
        });
    } catch (error) {
        console.error('Error clearing history:', error);
        res.status(500).json({ error: 'Failed to clear history' });
    }
});

// Add endpoint to stop individual monitoring
app.post('/api/stop-monitoring/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`Stopping monitoring for URL ID: ${id}`);

        // Stop the cron task if it exists
        if (monitoringTasks.has(parseInt(id))) {
            monitoringTasks.get(parseInt(id)).stop();
            monitoringTasks.delete(parseInt(id));
        }

        // Update database to mark URL and subscribers as inactive
        await db.query(`
            UPDATE monitored_urls 
            SET is_active = false 
            WHERE id = $1
        `, [id]);

        await db.query(`
            UPDATE alert_subscribers 
            SET is_active = false 
            WHERE url_id = $1
        `, [id]);

        res.json({
            message: 'Monitoring stopped successfully',
            urlId: id
        });
    } catch (error) {
        console.error('Error stopping monitoring:', error);
        res.status(500).json({ 
            error: 'Failed to stop monitoring',
            details: error.message 
        });
    }
});

// Add POST handlers for the test endpoints
app.post('/api/test-email', async (req, res) => {
    const { email, subject, message } = req.body;
    
    try {
        console.log('=== POST EMAIL TEST STARTED ===');
        console.log('Request body:', { email, subject, message });
        console.log('Testing email service...');
        
        // Sample content changes for testing
        const sampleContentBefore = "Welcome to our sailing website. We offer sailing lessons and boat rentals.";
        const sampleContentAfter = "Welcome to our sailing website. We offer sailing lessons, boat rentals, and yacht charters.";
        
        console.log('Calling emailService.sendAlert...');
        const result = await emailService.sendAlert(email, 'https://example.com', sampleContentBefore, sampleContentAfter);
        console.log('Email service result:', result);
        
        const response = {
            success: true,
            message: 'Test email sent successfully',
            emailId: result.messageId || 'mock_' + Date.now(),
            status: 'Sent',
            message: 'Email delivered'
        };
        console.log('Sending success response:', response);
        res.json(response);
    } catch (error) {
        console.error('=== POST EMAIL TEST FAILED ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

app.post('/api/test-sms', async (req, res) => {
    const { phone, message } = req.body;
    
    try {
        console.log('=== POST SMS TEST STARTED ===');
        console.log('Request body:', { phone, message });
        
        // First test the connection
        console.log('Testing SMS service connection...');
        const connectionTest = await smsService.testConnection();
        console.log('SMS connection test result:', connectionTest);

        if (connectionTest.status === 'error') {
            throw new Error(`SMS service connection failed: ${connectionTest.error}`);
        }

        // Then try to send a message
        console.log('Calling smsService.sendAlert...');
        const result = await smsService.sendAlert(phone, 'https://example.com');
        console.log('SMS service result:', result);
        
        const response = {
            success: true,
            message: 'Test SMS sent successfully',
            smsId: result.sid || 'mock_' + Date.now(),
            status: 'Sent',
            message: 'SMS delivered'
        };
        console.log('Sending success response:', response);
        res.json(response);
    } catch (error) {
        console.error('=== POST SMS TEST FAILED ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code,
            connectionTest: await smsService.testConnection(),
            smsConfig: {
                method: 'email-to-sms-gateway',
                status: 'configured'
            }
        });
    }
});

// Catch-all for unmatched API routes (before static file serving)
app.use((req, res, next) => {
    // Only handle if it's an API route and hasn't been handled
    if (req.path.startsWith('/api/')) {
        console.error(`[Web-Alert] ===== 404 - UNMATCHED API ROUTE =====`);
        console.error(`[Web-Alert] Method: ${req.method}`);
        console.error(`[Web-Alert] Path: ${req.path}`);
        console.error(`[Web-Alert] Original URL: ${req.originalUrl}`);
        console.error(`[Web-Alert] Base URL: ${req.baseUrl}`);
        console.error(`[Web-Alert] URL: ${req.url}`);
        console.error(`[Web-Alert] =====================================`);
        return res.status(404).json({ 
            error: `API route not found: ${req.method} ${req.path}`,
            originalUrl: req.originalUrl,
            baseUrl: req.baseUrl,
            path: req.path,
            url: req.url
        });
    }
    next();
});

// Static file serving - must come AFTER all API routes to avoid conflicts
app.use(express.static(path.join(__dirname, '../frontend/public')));
app.use('/src', express.static(path.join(__dirname, '../frontend/src')));