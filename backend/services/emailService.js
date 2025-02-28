const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD // This should be an app-specific password
    }
});

async function sendAlert(email, websiteUrl) {
    try {
        console.log('Sending email alert to:', email);
        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Website Change Detected',
            text: `A change has been detected on ${websiteUrl}`,
            html: `
                <h2>Website Change Alert</h2>
                <p>A change has been detected on: <a href="${websiteUrl}">${websiteUrl}</a></p>
                <p>Time: ${new Date().toLocaleString()}</p>
            `
        });
        console.log('Email sent:', info.messageId);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

module.exports = {
    sendAlert
}; 