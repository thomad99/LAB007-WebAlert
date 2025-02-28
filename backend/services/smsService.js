const twilio = require('twilio');

const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

async function sendAlert(phone, websiteUrl) {
    try {
        console.log('Sending SMS alert to:', phone);
        const message = await client.messages.create({
            body: `Change detected on ${websiteUrl}`,
            to: phone,
            from: process.env.TWILIO_PHONE_NUMBER
        });
        console.log('SMS sent:', message.sid);
        return message;
    } catch (error) {
        console.error('Error sending SMS:', error);
        throw error;
    }
}

module.exports = {
    sendAlert
}; 