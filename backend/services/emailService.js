const nodemailer = require('nodemailer');

// SendGrid support (for free Render plans that block SMTP)
let sendgrid = null;
if (process.env.SENDGRID_API_KEY) {
    try {
        sendgrid = require('@sendgrid/mail');
        sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
        console.log('[Web-Alert Email] SendGrid initialized (using API instead of SMTP)');
    } catch (err) {
        console.error('[Web-Alert Email] Failed to initialize SendGrid:', err.message);
    }
}

// SMTP configuration (same as 3D Print)
const smtpPort = parseInt(process.env.SMTP_PORT || '587');
const smtpSecure = process.env.SMTP_SECURE !== undefined 
    ? process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1'
    : smtpPort === 465; // Default: port 465 = secure, port 587 = STARTTLS

const smtpConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: smtpPort,
    secure: smtpSecure, // true = SSL/TLS, false = STARTTLS
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    },
    requireTLS: !smtpSecure, // Require TLS upgrade for STARTTLS (port 587 with secure: false)
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    debug: false, // Disable verbose debug output
    logger: false, // Disable verbose logging
    tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
    }
};

// Create transporter (only if SMTP credentials are available)
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
        transporter = nodemailer.createTransport(smtpConfig);
        console.log('[Web-Alert Email] SMTP transporter initialized');
    } catch (error) {
        console.warn('[Web-Alert Email] Failed to initialize SMTP transporter:', error.message);
    }
} else {
    console.warn('[Web-Alert Email] SMTP credentials not configured (SMTP_USER or SMTP_PASS missing)');
}

async function sendAlert(email, websiteUrl, contentBefore, contentAfter, subscriberId = null) {
    console.log('[Web-Alert Email] Sending alert email...');
    console.log('[Web-Alert Email] To:', email);
    console.log('[Web-Alert Email] Website:', websiteUrl);
    console.log('[Web-Alert Email] Subscriber ID:', subscriberId);
    
    try {
        // Use ALERT_SUBJECT environment variable, fallback to default
        const emailSubject = process.env.ALERT_SUBJECT || 'Page Change Detected';
        
        // Create LAB007 logo HTML (2x bigger - was 200px, now 400px) with small spacing
        const lab007Logo = `
            <div style="text-align: center; margin-bottom: 10px;">
                <img src="https://raw.githubusercontent.com/thomad99/LAB007-Main/master/LAB007/Images/lab007-trans.PNG" 
                     alt="LAB007 Logo" 
                     style="max-width: 400px; height: auto; border-radius: 8px;">
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
            
            // Get all changes (added and removed) for display
            const allChanges = [...added, ...removed].slice(0, 50); // Show up to 50 changes
            
            if (allChanges.length > 0) {
                changesText = allChanges.join(', ');
            }
        }
        
        // Footer logo with stop link (larger logo)
        const stopUrl = subscriberId ? `https://lab007-main.onrender.com/webalert/stop/${subscriberId}` : 'https://lab007-main.onrender.com/webalert';
        const footerLogo = `
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                <img src="https://raw.githubusercontent.com/thomad99/LAB007-Main/master/LAB007/Images/lab007-trans.PNG" 
                     alt="LAB007 Logo" 
                     style="max-width: 200px; height: auto; margin-bottom: 10px;">
                <p style="margin: 5px 0;"><a href="https://lab007-main.onrender.com/webalert" style="color: #0066cc; text-decoration: none;">Web Alert Main Page</a></p>
                ${subscriberId ? `<p style="margin: 5px 0;"><a href="${stopUrl}" style="color: #dc3545; text-decoration: none; font-weight: bold;">Stop Alerts</a></p>` : ''}
            </div>
        `;
        
        const mailOptions = {
            from: `"LAB007 Web Alert" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`,
            to: email,
            subject: emailSubject,
            text: `Page Change Detected\n\nURL: ${websiteUrl}\n\nText changes detected:\n${changesText || 'Content has changed'}\n\nDate and time: ${new Date().toLocaleString()}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .content-box { background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 20px 0; }
                        .website-link { color: #007bff; text-decoration: none; }
                        .website-link:hover { text-decoration: underline; }
                        .timestamp { color: #6c757d; font-size: 14px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        ${lab007Logo}
                        
                        <div class="header">
                            <h1 style="color: #333; margin: 0;">Page Change Detected</h1>
                        </div>
                        
                        <div class="content-box">
                            <p><strong>URL:</strong> <a href="${websiteUrl}" class="website-link">${websiteUrl}</a></p>
                        </div>
                        
                        ${changesText ? `
                        <div class="content-box">
                            <h3 style="margin-top: 0; color: #495057;">Text changes detected</h3>
                            <p style="white-space: pre-wrap; word-wrap: break-word;">${changesText}</p>
                        </div>
                        ` : ''}
                        
                        ${footerLogo}
                    </div>
                </body>
                </html>
            `
        };
        
        // Send via SendGrid if available, otherwise use SMTP
        if (sendgrid) {
            console.log('[Web-Alert Email] Using SendGrid API...');
            const msg = {
                to: email,
                from: process.env.SMTP_USER || process.env.EMAIL_USER,
                subject: emailSubject,
                text: mailOptions.text,
                html: mailOptions.html
            };
            await sendgrid.send(msg);
            console.log('[Web-Alert Email] Email sent successfully via SendGrid');
            return { messageId: 'sendgrid-' + Date.now() };
        } else if (transporter) {
            console.log('[Web-Alert Email] Using SMTP...');
            const info = await transporter.sendMail(mailOptions);
            console.log('[Web-Alert Email] Email sent successfully via SMTP:', info.messageId);
            return info;
        } else {
            throw new Error('Email service not configured. Please set SMTP_USER/SMTP_PASS or SENDGRID_API_KEY');
        }
    } catch (error) {
        console.error('[Web-Alert Email] Error sending email:', error.message);
        throw error;
    }
}

async function sendWelcomeEmail(email, websiteUrl, duration, subscriberId = null) {
    console.log('[Web-Alert Email] Sending welcome email to:', email);
    console.log('[Web-Alert Email] Website:', websiteUrl);
    console.log('[Web-Alert Email] Duration:', duration);
    console.log('[Web-Alert Email] Subscriber ID:', subscriberId);
    
    try {
        const mailOptions = {
            from: `"Web Alert Service" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`,
            to: email,
            subject: 'LAB007-ALERTS-STARTED',
            text: `Web Alerts Activated\n\nURL: ${websiteUrl}\nPoll Period: Every 3 minutes\nDuration: ${duration} minutes\n\nMonitoring has started successfully. You will receive notifications if any changes are detected.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #0066cc;">Web Alerts Activated</h2>
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>URL:</strong> <a href="${websiteUrl}">${websiteUrl}</a></p>
                        <p><strong>Poll Period:</strong> Every 3 minutes</p>
                        <p><strong>Duration:</strong> ${duration} minutes</p>
                        <p><strong>Start Time:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    <p>Monitoring has started successfully. You will receive notifications if any changes are detected on the website.</p>
                    <p>Monitoring will automatically stop after ${duration} minutes.</p>
                    ${subscriberId ? `
                    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                        <img src="https://raw.githubusercontent.com/thomad99/LAB007-Main/master/LAB007/Images/lab007-trans.PNG" 
                             alt="LAB007 Logo" 
                             style="max-width: 200px; height: auto; margin-bottom: 10px;">
                        <p style="margin: 5px 0;"><a href="https://lab007-main.onrender.com/webalert" style="color: #0066cc; text-decoration: none;">Web Alert Main Page</a></p>
                        <p style="margin: 5px 0;"><a href="https://lab007-main.onrender.com/webalert/stop/${subscriberId}" style="color: #dc3545; text-decoration: none; font-weight: bold;">Stop Alerts</a></p>
                    </div>
                    ` : ''}
                </div>
            `
        };
        
        console.log('[Web-Alert Email] Mail options prepared:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });
        
        if (sendgrid) {
            console.log('[Web-Alert Email] Using SendGrid API...');
            const msg = {
                to: email,
                from: process.env.SMTP_USER || process.env.EMAIL_USER,
                subject: mailOptions.subject,
                text: mailOptions.text,
                html: mailOptions.html
            };
            await sendgrid.send(msg);
            console.log('[Web-Alert Email] Welcome email sent successfully via SendGrid');
            return { messageId: 'sendgrid-' + Date.now() };
        } else if (transporter) {
            console.log('[Web-Alert Email] Using SMTP...');
            const info = await transporter.sendMail(mailOptions);
            console.log('[Web-Alert Email] Welcome email sent successfully via SMTP:', info.messageId);
            return info;
        } else {
            console.error('[Web-Alert Email] Email service not configured - SMTP_USER/SMTP_PASS or SENDGRID_API_KEY required');
            throw new Error('Email service not configured. Please set SMTP_USER/SMTP_PASS or SENDGRID_API_KEY');
        }
    } catch (error) {
        console.error('[Web-Alert Email] Error sending welcome email:', error.message);
        console.error('[Web-Alert Email] Error stack:', error.stack);
        throw error;
    }
}

async function sendSummaryEmail(email, websiteUrl, duration, checkCount, changesDetected, lastCheck, subscriberId = null) {
    console.log('[Web-Alert Email] Sending summary email to:', email);
    console.log('[Web-Alert Email] Subscriber ID:', subscriberId);
    
    try {
        const summaryText = changesDetected > 0 
            ? `We detected ${changesDetected} change(s) during monitoring.`
            : 'No changes were detected during monitoring.';
        
        // LAB007 logo at top
        const lab007Logo = `
            <div style="text-align: center; margin-bottom: 20px;">
                <img src="https://raw.githubusercontent.com/thomad99/LAB007-WebAlert/main/frontend/public/lab007-trans.PNG" 
                     alt="LAB007 Logo" 
                     style="max-width: 200px; height: auto; border-radius: 8px;">
            </div>
        `;
        
        // Footer logo with stop link (larger logo)
        const stopUrl = subscriberId ? `https://lab007-main.onrender.com/webalert/stop/${subscriberId}` : 'https://lab007-main.onrender.com/webalert';
        const footerLogo = `
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6;">
                <img src="https://raw.githubusercontent.com/thomad99/LAB007-Main/master/LAB007/Images/lab007-trans.PNG" 
                     alt="LAB007 Logo" 
                     style="max-width: 200px; height: auto; margin-bottom: 10px;">
                <p style="margin: 5px 0;"><a href="https://lab007-main.onrender.com/webalert" style="color: #0066cc; text-decoration: none;">Web Alert Main Page</a></p>
                ${subscriberId ? `<p style="margin: 5px 0;"><a href="${stopUrl}" style="color: #dc3545; text-decoration: none; font-weight: bold;">Stop Alerts</a></p>` : ''}
            </div>
        `;
        
        const mailOptions = {
            from: `"Web Alert Service" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`,
            to: email,
            subject: 'LAB007-ALERTS-ENDED',
            text: `Monitoring completed for ${websiteUrl}. ${summaryText} Total checks: ${checkCount}`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .content-box { background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin: 20px 0; }
                        .website-link { color: #007bff; text-decoration: none; }
                        .website-link:hover { text-decoration: underline; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        ${lab007Logo}
                        
                        <div class="content-box">
                            <p><strong>Website:</strong> <a href="${websiteUrl}" class="website-link">${websiteUrl}</a></p>
                            <p><strong>Duration:</strong> ${duration} minutes</p>
                            <p><strong>Total Checks:</strong> ${checkCount}</p>
                            <p><strong>Changes Detected:</strong> ${changesDetected}</p>
                            <p><strong>Last Check:</strong> ${lastCheck ? new Date(lastCheck).toLocaleString() : 'N/A'}</p>
                            <p><strong>End Time:</strong> ${new Date().toLocaleString()}</p>
                        </div>
                        
                        <p>${summaryText}</p>
                        <p>Monitoring has been completed and stopped automatically.</p>
                        <p>Thank you for using Web Alert!</p>
                        
                        ${footerLogo}
                    </div>
                </body>
                </html>
            `
        };
        
        if (sendgrid) {
            const msg = {
                to: email,
                from: process.env.SMTP_USER || process.env.EMAIL_USER,
                subject: mailOptions.subject,
                text: mailOptions.text,
                html: mailOptions.html
            };
            await sendgrid.send(msg);
            return { messageId: 'sendgrid-' + Date.now() };
        } else if (transporter) {
            const info = await transporter.sendMail(mailOptions);
            return info;
        } else {
            throw new Error('Email service not configured');
        }
    } catch (error) {
        console.error('[Web-Alert Email] Error sending summary email:', error.message);
        throw error;
    }
}

module.exports = {
    sendAlert,
    sendWelcomeEmail,
    sendSummaryEmail
}; 