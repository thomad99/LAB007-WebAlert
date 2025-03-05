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

// Update the static file serving
app.use(express.static(path.join(__dirname, '../frontend')));

// Store active monitoring tasks
const monitoringTasks = new Map();

// Function to start monitoring a URL
async function startUrlMonitoring(urlId, websiteUrl) {
    if (monitoringTasks.has(urlId)) {
        console.log(`Monitoring already active for URL ID ${urlId}`);
        return;
    }

    console.log(`Starting monitoring for URL ID ${urlId}: ${websiteUrl}`);
    let previousContent = null;

    const task = cron.schedule('*/5 * * * *', async () => {
        try {
            console.log(`Checking URL ID ${urlId}: ${websiteUrl}`);
            
            // Update check count
            await db.query(
                'UPDATE monitored_urls SET check_count = check_count + 1 WHERE id = $1',
                [urlId]
            );

            // Scrape the URL
            const { content, debug } = await scraper.scrape(websiteUrl);

            // Update last check and content
            await db.query(
                'UPDATE monitored_urls SET last_check = NOW(), last_content = $1, last_debug = $2 WHERE id = $1',
                [content, JSON.stringify(debug), urlId]
            );

            if (previousContent && content !== previousContent) {
                console.log(`Change detected for URL ID ${urlId}`);

                // Get all active subscribers for this URL
                const subscribers = await db.query(`
                    SELECT 
                        as.id as subscriber_id,
                        as.email,
                        as.phone_number,
                        as.polling_duration,
                        as.created_at + (as.polling_duration || ' minutes')::interval as end_time
                    FROM alert_subscribers as
                    WHERE 
                        as.url_id = $1 
                        AND as.is_active = true
                        AND NOW() < as.created_at + (as.polling_duration || ' minutes')::interval
                `, [urlId]);

                // Record change and notify each subscriber
                for (const subscriber of subscribers.rows) {
                    try {
                        // Record the change
                        const alertRecord = await db.query(`
                            INSERT INTO alerts_history 
                                (url_id, subscriber_id, content_before, content_after) 
                            VALUES ($1, $2, $3, $4) 
                            RETURNING id
                        `, [urlId, subscriber.id, previousContent, content]);

                        // Send notifications
                        await Promise.all([
                            emailService.sendAlert(subscriber.email, websiteUrl)
                                .then(() => db.query(
                                    'UPDATE alerts_history SET email_sent = true WHERE id = $1',
                                    [alertRecord.rows[0].id]
                                )),
                            smsService.sendAlert(subscriber.phone_number, websiteUrl)
                                .then(() => db.query(
                                    'UPDATE alerts_history SET sms_sent = true WHERE id = $1',
                                    [alertRecord.rows[0].id]
                                ))
                        ]);
                    } catch (error) {
                        console.error(`Error notifying subscriber ${subscriber.id}:`, error);
                    }
                }
            }

            previousContent = content;

            // Check if monitoring should continue
            const activeSubscribers = await db.query(`
                SELECT COUNT(*) 
                FROM alert_subscribers 
                WHERE 
                    url_id = $1 
                    AND is_active = true
                    AND NOW() < created_at + (polling_duration || ' minutes')::interval
            `, [urlId]);

            if (parseInt(activeSubscribers.rows[0].count) === 0) {
                console.log(`No active subscribers left for URL ID ${urlId}, stopping monitoring`);
                task.stop();
                monitoringTasks.delete(urlId);
                await db.query('UPDATE monitored_urls SET is_active = false WHERE id = $1', [urlId]);
            }

        } catch (error) {
            console.error(`Error in monitoring task for URL ID ${urlId}:`, error);
        }
    });

    monitoringTasks.set(urlId, task);
}

// Test database connection
db.connect(async (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected successfully');
        try {
            // Initialize schema from schema.sql
            console.log('Initializing database schema...');
            const fs = require('fs');
            const path = require('path');
            const schemaPath = path.join(__dirname, 'models', 'schema.sql');
            const schema = fs.readFileSync(schemaPath, 'utf8');
            
            // Execute schema creation
            await db.query(schema);
            console.log('Database schema initialized successfully');

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
            console.error('Error initializing database schema:', error);
            console.error('Error details:', error.stack);
        }
    }
});

// Add specific routes for HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.get('/status.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/status.html'));
});

app.get('/MOVING.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/MOVING.html'));
});

// Keep the health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
        dbConnected: db.pool ? true : false
    });
});

// API endpoint to start monitoring
app.post('/api/monitor', async (req, res) => {
    const { websiteUrl, email, phone, duration } = req.body;

    try {
        // First, get or create the monitored URL
        let urlRecord = await db.query(
            'SELECT * FROM monitored_urls WHERE website_url = $1',
            [websiteUrl]
        );

        let urlId;
        if (urlRecord.rows.length === 0) {
            // New URL to monitor
            const newUrl = await db.query(
                'INSERT INTO monitored_urls (website_url, is_active) VALUES ($1, true) RETURNING id',
                [websiteUrl]
            );
            urlId = newUrl.rows[0].id;
        } else {
            urlId = urlRecord.rows[0].id;
        }

        // Create subscriber record
        const subscriber = await db.query(`
            INSERT INTO alert_subscribers 
                (url_id, email, phone_number, polling_duration) 
            VALUES ($1, $2, $3, $4) 
            RETURNING *
        `, [urlId, email, phone, duration]);

        // Start monitoring if not already active
        await startUrlMonitoring(urlId, websiteUrl);

        res.json({
            message: 'Monitoring started successfully',
            subscriber: subscriber.rows[0]
        });

    } catch (error) {
        console.error('Error starting monitoring:', error);
        res.status(500).json({ error: 'Failed to start monitoring' });
    }
});

// Modify the status endpoint
app.get('/api/status', async (req, res) => {
    try {
        console.log('Fetching status from database...');
        const result = await db.query(`
            SELECT 
                id,
                website_url,
                email,
                phone_number,
                polling_duration,
                check_count,
                last_check,
                is_active,
                created_at,
                EXTRACT(EPOCH FROM (created_at + (polling_duration || ' minutes')::interval) - NOW())/60 as minutes_left
            FROM web_alerts
            ORDER BY created_at DESC
        `);
        console.log('Status query result:', result.rows);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching status:', error);
        res.status(500).json({ error: 'Failed to fetch monitoring status' });
    }
});

// Add a test endpoint
app.get('/api/test-db', async (req, res) => {
    try {
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

// Add route logging middleware at the top
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
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
        console.log('Testing email service...');
        const result = await emailService.sendAlert(testEmail, testUrl);
        res.json({
            success: true,
            message: 'Test email sent successfully',
            details: result
        });
    } catch (error) {
        console.error('Test email failed:', error);
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
        // First test the connection
        const connectionTest = await smsService.testConnection();
        console.log('Twilio connection test:', connectionTest);

        if (connectionTest.status === 'error') {
            throw new Error(`Twilio connection failed: ${connectionTest.error}`);
        }

        // Then try to send a message
        console.log('Testing SMS service...');
        const result = await smsService.sendAlert(testPhone, testUrl);
        
        res.json({
            success: true,
            message: 'Test SMS sent successfully',
            connectionTest,
            smsResult: {
                sid: result.sid,
                status: result.status,
                to: result.to,
                from: result.from,
                direction: result.direction
            }
        });
    } catch (error) {
        console.error('Test SMS failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code,
            connectionTest: await smsService.testConnection(),
            twilioConfig: {
                accountSidExists: !!process.env.TWILIO_ACCOUNT_SID,
                authTokenExists: !!process.env.TWILIO_AUTH_TOKEN,
                phoneNumberExists: !!process.env.TWILIO_PHONE_NUMBER
            }
        });
    }
});

// Add an endpoint to check Twilio configuration
app.get('/api/check-twilio', async (req, res) => {
    try {
        const connectionTest = await smsService.testConnection();
        res.json({
            status: 'success',
            connection: connectionTest,
            config: {
                accountSidExists: !!process.env.TWILIO_ACCOUNT_SID,
                authTokenExists: !!process.env.TWILIO_AUTH_TOKEN,
                phoneNumberExists: !!process.env.TWILIO_PHONE_NUMBER,
                phoneNumber: process.env.TWILIO_PHONE_NUMBER
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message,
            code: error.code
        });
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

// Modify the server startup
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