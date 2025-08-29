const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    },
    debug: true, // Enable debug logging
    logger: true  // Enable logger
});

async function sendAlert(email, websiteUrl) {
    try {
        // Verify transporter configuration
        console.log('Verifying email configuration...');
        await transporter.verify();
        console.log('Email configuration verified');

        console.log('Sending email alert to:', email);
        console.log('Using email account:', process.env.EMAIL_USER);
        
        const info = await transporter.sendMail({
            from: `"Web Alert Service" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Website Change Detected',
            text: `A change has been detected on ${websiteUrl}`,
            html: `
                <h2>Website Change Alert</h2>
                <p>A change has been detected on: <a href="${websiteUrl}">${websiteUrl}</a></p>
                <p>Time: ${new Date().toLocaleString()}</p>
            `
        });
        
        console.log('Email sent:', {
            messageId: info.messageId,
            response: info.response,
            accepted: info.accepted,
            rejected: info.rejected
        });
        
        return info;
    } catch (error) {
        console.error('Error sending email:', {
            error: error.message,
            stack: error.stack,
            emailUser: process.env.EMAIL_USER,
            hasPassword: !!process.env.EMAIL_PASSWORD
        });
        throw error;
    }
}

async function sendWelcomeEmail(email, websiteUrl, duration) {
    try {
        console.log('Sending welcome email to:', email);
        
        const info = await transporter.sendMail({
            from: `"Web Alert Service" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Web Monitoring Started',
            text: `Welcome! We're now monitoring ${websiteUrl} for changes. Duration: ${duration} minutes.`,
            html: `
                <h2>🎉 Welcome to Web Alert!</h2>
                <p>We've successfully started monitoring: <a href="${websiteUrl}">${websiteUrl}</a></p>
                <p><strong>Monitoring Duration:</strong> ${duration} minutes</p>
                <p><strong>Start Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Check Frequency:</strong> Every 5 minutes</p>
                <hr>
                <p>You'll receive notifications if any changes are detected on the website.</p>
                <p>Monitoring will automatically stop after ${duration} minutes.</p>
            `
        });
        
        console.log('Welcome email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending welcome email:', error);
        throw error;
    }
}

async function sendSummaryEmail(email, websiteUrl, duration, checkCount, changesDetected, lastCheck) {
    try {
        console.log('Sending summary email to:', email);
        
        const summaryText = changesDetected > 0 
            ? `We detected ${changesDetected} change(s) during monitoring.`
            : 'No changes were detected during monitoring.';
        
        const info = await transporter.sendMail({
            from: `"Web Alert Service" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Web Monitoring Complete - Summary',
            text: `Monitoring completed for ${websiteUrl}. ${summaryText} Total checks: ${checkCount}`,
            html: `
                <h2>📊 Monitoring Summary</h2>
                <p><strong>Website:</strong> <a href="${websiteUrl}">${websiteUrl}</a></p>
                <p><strong>Duration:</strong> ${duration} minutes</p>
                <p><strong>Total Checks:</strong> ${checkCount}</p>
                <p><strong>Changes Detected:</strong> ${changesDetected}</p>
                <p><strong>Last Check:</strong> ${lastCheck ? new Date(lastCheck).toLocaleString() : 'N/A'}</p>
                <p><strong>End Time:</strong> ${new Date().toLocaleString()}</p>
                <hr>
                <p>${summaryText}</p>
                <p>Monitoring has been completed and stopped automatically.</p>
                <p>Thank you for using Web Alert!</p>
            `
        });
        
        console.log('Summary email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending summary email:', error);
        throw error;
    }
}

module.exports = {
    sendAlert,
    sendWelcomeEmail,
    sendSummaryEmail
}; 