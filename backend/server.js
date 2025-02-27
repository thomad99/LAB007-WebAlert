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

// Serve static files from the frontend/public directory
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Store active monitoring tasks
const monitoringTasks = new Map();

// Test database connection
db.connect(async (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected successfully');
        try {
            // Create tables if they don't exist
            await db.query(`
                CREATE TABLE IF NOT EXISTS web_alerts (
                    id SERIAL PRIMARY KEY,
                    website_url TEXT NOT NULL,
                    email VARCHAR(255) NOT NULL,
                    phone_number VARCHAR(20) NOT NULL,
                    polling_duration INTEGER NOT NULL,
                    last_check TIMESTAMP,
                    last_content TEXT,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('Database schema initialized');
        } catch (error) {
            console.error('Error initializing database schema:', error);
        }
    }
});

// Serve the main HTML page for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
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
    console.log('Received monitoring request:', { websiteUrl, email, phone, duration });

    try {
        // Test database connection first
        console.log('Testing database connection...');
        await db.query('SELECT NOW()');
        console.log('Database connection test successful');

        // Insert new monitoring request into database
        console.log('Attempting to insert into database with values:', [websiteUrl, email, phone, duration]);
        const result = await db.query(
            'INSERT INTO web_alerts (website_url, email, phone_number, polling_duration) VALUES ($1, $2, $3, $4) RETURNING *',
            [websiteUrl, email, phone, duration]
        );
        
        console.log('Insert result:', result);
        console.log('Inserted row:', result.rows[0]);

        if (!result.rows[0]) {
            throw new Error('Insert succeeded but no row was returned');
        }

        const alertId = result.rows[0].id;
        let checkCount = 0;
        let previousContent = null;

        // Create monitoring task
        console.log('Setting up monitoring task for alert ID:', alertId);
        const task = cron.schedule('* * * * *', async () => {
            try {
                checkCount++;
                console.log(`Running check ${checkCount}/${duration} for alert ID ${alertId}`);
                
                const content = await scraper.scrape(websiteUrl);
                console.log(`Content fetched for ${websiteUrl}, length: ${content.length} characters`);

                if (previousContent && content !== previousContent) {
                    console.log('Change detected, sending notifications...');
                    await Promise.all([
                        emailService.sendAlert(email, websiteUrl),
                        smsService.sendAlert(phone, websiteUrl)
                    ]);
                    console.log('Notifications sent successfully');

                    await db.query(
                        'UPDATE web_alerts SET last_check = NOW(), last_content = $1 WHERE id = $2',
                        [content, alertId]
                    );
                    console.log('Database updated with new content');
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
        console.log('Monitoring task created and stored');
        
        res.json({ 
            message: 'Monitoring started successfully', 
            alertId,
            debug: {
                taskCreated: true,
                taskStored: monitoringTasks.has(alertId),
                activeTasksCount: monitoringTasks.size
            }
        });
    } catch (error) {
        console.error('Detailed error:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            detail: error.detail,
            table: error.table,
            constraint: error.constraint
        });
        
        res.status(500).json({ 
            error: 'Failed to start monitoring',
            details: error.message,
            debug: {
                errorType: error.name,
                errorStack: error.stack,
                errorCode: error.code,
                errorDetail: error.detail
            }
        });
        return;
    }
});

// Add this new route after your existing routes
app.get('/api/status', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                id,
                website_url,
                email,
                phone_number,
                polling_duration,
                last_check,
                is_active,
                created_at,
                EXTRACT(EPOCH FROM (created_at + (polling_duration || ' minutes')::interval) - NOW())/60 as minutes_left
            FROM web_alerts
            WHERE is_active = true
            ORDER BY created_at DESC
        `);
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
    console.error('Server failed to start:', err);
}); 