const twilio = require('twilio');

class SMSService {
    constructor() {
        this.client = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );
    }

    async sendAlert(phoneNumber, url) {
        try {
            await this.client.messages.create({
                body: `Web-Alert - Web Page change Detected on this URL: ${url}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phoneNumber
            });
            console.log('Alert SMS sent successfully');
        } catch (error) {
            console.error('Error sending SMS:', error);
            throw error;
        }
    }
}

module.exports = new SMSService(); 