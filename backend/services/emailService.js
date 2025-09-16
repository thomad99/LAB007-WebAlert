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

async function sendAlert(email, websiteUrl, contentBefore, contentAfter) {
    try {
        // Verify transporter configuration
        console.log('Verifying email configuration...');
        await transporter.verify();
        console.log('Email configuration verified');

        console.log('Sending email alert to:', email);
        console.log('Using email account:', process.env.EMAIL_USER);
        
        // Create LAB007 logo HTML (base64 encoded or hosted URL)
        const lab007Logo = `
            <div style="text-align: center; margin-bottom: 20px;">
                <img src="https://raw.githubusercontent.com/thomad99/LAB007-WebAlert/main/frontend/public/lab007-trans.PNG" 
                     alt="LAB007 Logo" 
                     style="max-width: 200px; height: auto; border-radius: 8px;">
            </div>
        `;
        
        // Extract text changes (simple diff for text content)
        let changesText = '';
        if (contentBefore && contentAfter) {
            // Simple text comparison - show what changed
            const beforeWords = contentBefore.split(/\s+/).filter(word => word.length > 0);
            const afterWords = contentAfter.split(/\s+/).filter(word => word.length > 0);
            
            // Find added/removed words (basic diff)
            const added = afterWords.filter(word => !beforeWords.includes(word));
            const removed = beforeWords.filter(word => !afterWords.includes(word));
            
            if (added.length > 0 || removed.length > 0) {
                changesText = `
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
                        <h4 style="color: #495057; margin-top: 0;">📝 Text Changes Detected:</h4>
                        ${added.length > 0 ? `<p><strong>Added:</strong> ${added.slice(0, 10).join(', ')}${added.length > 10 ? '...' : ''}</p>` : ''}
                        ${removed.length > 0 ? `<p><strong>Removed:</strong> ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? '...' : ''}</p>` : ''}
                        <p style="font-size: 12px; color: #6c757d;">Showing first 10 changes. Full content comparison available in monitoring logs.</p>
                    </div>
                `;
            }
        }
        
        const info = await transporter.sendMail({
            from: `"LAB007 Web Alert" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'LOVESAILING PAGE UPDATE',
            text: `HI,\n\nChange Detected on webpage: ${websiteUrl}\nDate and time: ${new Date().toLocaleString()}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .alert-box { background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 20px 0; }
                        .website-link { color: #007bff; text-decoration: none; }
                        .website-link:hover { text-decoration: underline; }
                        .timestamp { color: #6c757d; font-size: 14px; }
                        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; text-align: center; color: #6c757d; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        ${lab007Logo}
                        
                        <div class="header">
                            <h1 style="color: #dc3545; margin: 0;">🚨 LOVESAILING PAGE UPDATE</h1>
                        </div>
                        
                        <div class="alert-box">
                            <h2 style="margin-top: 0; color: #856404;">HI,</h2>
                            <p><strong>Change Detected on webpage:</strong> <a href="${websiteUrl}" class="website-link">${websiteUrl}</a></p>
                            <p class="timestamp"><strong>Date and time:</strong> ${new Date().toLocaleString()}</p>
                        </div>
                        
                        ${changesText}
                        
                        <div style="background-color: #e9ecef; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <h4 style="margin-top: 0; color: #495057;">🔍 What This Means:</h4>
                            <p>The content of the monitored webpage has changed. This could be:</p>
                            <ul style="margin: 10px 0; padding-left: 20px;">
                                <li>New content added</li>
                                <li>Existing content modified</li>
                                <li>Content removed</li>
                                <li>Page structure changes</li>
                            </ul>
                        </div>
                        
                        <div class="footer">
                            <p>This alert was sent by LAB007 Web Alert System</p>
                            <p>Monitoring frequency: Every 3 minutes</p>
                        </div>
                    </div>
                </body>
                </html>
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
                <p><strong>Check Frequency:</strong> Every 3 minutes</p>
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