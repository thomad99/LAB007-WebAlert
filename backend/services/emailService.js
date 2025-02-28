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

module.exports = {
    sendAlert
}; 