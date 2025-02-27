const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });
    }

    async sendAlert(email, url) {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Web-Alert - Change Detected',
            text: `Web-Alert - Web Page change Detected on this URL: ${url}`,
            html: `<h1>Web-Alert</h1><p>A change has been detected on: <a href="${url}">${url}</a></p>`
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log('Alert email sent successfully');
        } catch (error) {
            console.error('Error sending email:', error);
            throw error;
        }
    }
}

module.exports = new EmailService(); 