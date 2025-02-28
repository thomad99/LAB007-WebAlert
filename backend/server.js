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

// Test database connection
db.connect(async (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected successfully');
        try {
            // First, check if the column exists
            const columnCheck = await db.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'web_alerts' AND column_name = 'check_count'
            `);

            if (columnCheck.rows.length === 0) {
                console.log('Adding check_count column...');
                // Add the column if it doesn't exist
                await db.query(`
                    ALTER TABLE web_alerts 
                    ADD COLUMN IF NOT EXISTS check_count INTEGER DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS last_debug JSONB
                `);
                console.log('Added check_count and last_debug columns');
            }

            // Create web_alerts table if it doesn't exist
            await db.query(`
                CREATE TABLE IF NOT EXISTS web_alerts (
                    id SERIAL PRIMARY KEY,
                    website_url TEXT NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    phone_number VARCHAR(20) NOT NULL,
                    polling_duration INTEGER NOT NULL,
                    check_count INTEGER DEFAULT 0,
                    last_check TIMESTAMP,
                    last_content TEXT,
                    last_debug JSONB,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Create alerts_history table
            await db.query(`
                CREATE TABLE IF NOT EXISTS alerts_history (
                    id SERIAL PRIMARY KEY,
                    alert_id INTEGER REFERENCES web_alerts(id),
                    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    email_sent BOOLEAN DEFAULT false,
                    sms_sent BOOLEAN DEFAULT false,
                    content_before TEXT,
                    content_after TEXT
                );
            `);
            console.log('Database schema initialized');
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
    console.log('POST /api/monitor received:', req.body);
    
    const { websiteUrl, email, phone, duration } = req.body;
    
    if (!websiteUrl || !email || !phone || !duration) {
        console.error('Missing required fields:', { websiteUrl, email, phone, duration });
        return res.status(400).json({ 
            error: 'Missing required fields',
            received: { websiteUrl, email, phone, duration }
        });
    }

    try {
        // Test connection first
        console.log('Testing database connection...');
        const testResult = await db.query('SELECT NOW() as time');
        console.log('Database test successful:', testResult.rows[0]);

        // Insert the monitoring request
        console.log('Inserting monitoring request...');
        const insertQuery = `
            INSERT INTO web_alerts 
                (website_url, email, phone_number, polling_duration) 
            VALUES 
                ($1, $2, $3, $4) 
            RETURNING *`;
        
        const values = [websiteUrl, email, phone, duration];
        console.log('Insert query:', { query: insertQuery, values });

        const result = await db.query(insertQuery, values);
        
        if (!result.rows[0]) {
            throw new Error('Insert did not return the created row');
        }

        const newAlert = result.rows[0];
        console.log('Successfully inserted alert:', newAlert);

        // Set up monitoring task
        const alertId = newAlert.id;
        let checkCount = 0;
        let previousContent = null;

        console.log('Setting up cron task for alert:', alertId);
        const task = cron.schedule('* * * * *', async () => {
            try {
                checkCount++;
                console.log(`Running check ${checkCount}/${duration} for alert ID ${alertId}`);
                
                // Update check count in database
                await db.query(
                    'UPDATE web_alerts SET check_count = check_count + 1 WHERE id = $1',
                    [alertId]
                );

                const { content, debug } = await scraper.scrape(websiteUrl);
                console.log('Scrape debug info:', debug);

                // Always update last_check and content
                await db.query(
                    'UPDATE web_alerts SET last_check = NOW(), last_content = $1, last_debug = $2 WHERE id = $3',
                    [content, JSON.stringify(debug), alertId]
                );

                if (previousContent) {
                    const contentChanged = content !== previousContent;
                    console.log('Content comparison:', {
                        contentChanged,
                        currentLength: content.length,
                        previousLength: previousContent.length,
                        firstDifference: contentChanged ? findFirstDifference(content, previousContent) : null
                    });

                    if (contentChanged) {
                        console.log('Change detected, sending notifications...');
                        
                        // Record the change in history
                        const alertRecord = await db.query(`
                            INSERT INTO alerts_history 
                                (alert_id, content_before, content_after, email_sent, sms_sent) 
                            VALUES ($1, $2, $3, false, false) 
                            RETURNING *
                        `, [alertId, previousContent, content]);
                        
                        console.log('Alert recorded:', alertRecord.rows[0]);

                        try {
                            // Send email notification
                            await emailService.sendAlert(email, websiteUrl)
                                .then(async () => {
                                    await db.query(
                                        'UPDATE alerts_history SET email_sent = true WHERE id = $1',
                                        [alertRecord.rows[0].id]
                                    );
                                    console.log('Email notification sent and recorded');
                                })
                                .catch(error => {
                                    console.error('Failed to send email:', error);
                                });

                            // Send SMS notification
                            await smsService.sendAlert(phone, websiteUrl)
                                .then(async () => {
                                    await db.query(
                                        'UPDATE alerts_history SET sms_sent = true WHERE id = $1',
                                        [alertRecord.rows[0].id]
                                    );
                                    console.log('SMS notification sent and recorded');
                                })
                                .catch(error => {
                                    console.error('Failed to send SMS:', error);
                                });
                        } catch (error) {
                            console.error('Error sending notifications:', error);
                        }
                    }
                } else {
                    console.log('First check - storing initial content');
                }

                previousContent = content;

                if (checkCount >= duration) {
                    console.log(`Monitoring complete for alert ID ${alertId}`);
                    task.stop();
                    monitoringTasks.delete(alertId);
                    await db.query(
                        'UPDATE web_alerts SET is_active = false WHERE id = $1',
                        [alertId]
                    );
                }
            } catch (error) {
                console.error(`Error in monitoring task for alert ID ${alertId}:`, error);
            }
        });

        monitoringTasks.set(alertId, task);
        console.log('Monitoring task created:', { alertId, taskCount: monitoringTasks.size });

        // Verify the insert with a select
        const verify = await db.query('SELECT * FROM web_alerts WHERE id = $1', [alertId]);
        console.log('Verification query result:', verify.rows[0]);

        return res.json({
            message: 'Monitoring started successfully',
            alert: newAlert,
            debug: {
                taskCreated: true,
                taskStored: monitoringTasks.has(alertId),
                activeTasksCount: monitoringTasks.size,
                verificationResult: verify.rows[0] ? 'found' : 'not found'
            }
        });

    } catch (error) {
        console.error('Error in /api/monitor:', {
            error: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail
        });

        return res.status(500).json({
            error: 'Failed to start monitoring',
            details: error.message,
            debug: {
                errorType: error.name,
                errorCode: error.code,
                errorDetail: error.detail
            }
        });
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

app.get('/api/test-sms', async (req, res) => {
    const testPhone = req.query.phone || '+1234567890';
    const testUrl = req.query.url || 'https://example.com';
    
    try {
        console.log('Testing SMS service...');
        const result = await smsService.sendAlert(testPhone, testUrl);
        res.json({
            success: true,
            message: 'Test SMS sent successfully',
            details: result
        });
    } catch (error) {
        console.error('Test SMS failed:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
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