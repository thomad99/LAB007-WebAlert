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
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Store active monitoring tasks
const monitoringTasks = new Map();

// Test database connection
db.connect((err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected successfully');
    }
});

// API endpoint to start monitoring
app.post('/api/monitor', async (req, res) => {
    const { websiteUrl, email, phone, duration } = req.body;

    try {
        // Insert new monitoring request into database
        const result = await db.query(
            'INSERT INTO web_alerts (website_url, email, phone_number, polling_duration) VALUES ($1, $2, $3, $4) RETURNING id',
            [websiteUrl, email, phone, duration]
        );

        const alertId = result.rows[0].id;
        let checkCount = 0;
        let previousContent = null;

        // Create monitoring task
        const task = cron.schedule('* * * * *', async () => {
            try {
                checkCount++;
                const content = await scraper.scrape(websiteUrl);

                if (previousContent && content !== previousContent) {
                    await Promise.all([
                        emailService.sendAlert(email, websiteUrl),
                        smsService.sendAlert(phone, websiteUrl)
                    ]);

                    await db.query(
                        'UPDATE web_alerts SET last_check = NOW(), last_content = $1 WHERE id = $2',
                        [content, alertId]
                    );
                }

                previousContent = content;

                if (checkCount >= duration) {
                    task.stop();
                    monitoringTasks.delete(alertId);
                    await db.query(
                        'UPDATE web_alerts SET is_active = false WHERE id = $1',
                        [alertId]
                    );
                }
            } catch (error) {
                console.error('Error in monitoring task:', error);
            }
        });

        monitoringTasks.set(alertId, task);
        res.json({ message: 'Monitoring started successfully', alertId });
    } catch (error) {
        console.error('Error starting monitoring:', error);
        res.status(500).json({ error: 'Failed to start monitoring' });
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
