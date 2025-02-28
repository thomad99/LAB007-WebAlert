const twilio = require('twilio');

// Add debug logging for Twilio client initialization
let client;
try {
    console.log('Initializing Twilio client...');
    console.log('Account SID exists:', !!process.env.TWILIO_ACCOUNT_SID);
    console.log('Auth Token exists:', !!process.env.TWILIO_AUTH_TOKEN);
    console.log('Phone number:', process.env.TWILIO_PHONE_NUMBER);
    
    client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );
    console.log('Twilio client initialized successfully');
} catch (error) {
    console.error('Error initializing Twilio client:', error);
    throw error;
}

async function sendAlert(phone, websiteUrl) {
    try {
        console.log('Attempting to send SMS...', {
            to: phone,
            from: process.env.TWILIO_PHONE_NUMBER,
            websiteUrl
        });

        // Format the phone number if it doesn't start with +
        const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
        
        const message = await client.messages.create({
            body: `Change detected on ${websiteUrl}`,
            to: formattedPhone,
            from: process.env.TWILIO_PHONE_NUMBER
        });

        console.log('SMS sent successfully:', {
            messageId: message.sid,
            status: message.status,
            to: message.to,
            from: message.from
        });

        return message;
    } catch (error) {
        console.error('Error sending SMS:', {
            error: error.message,
            code: error.code,
            moreInfo: error.moreInfo,
            status: error.status,
            phone,
            twilioNumber: process.env.TWILIO_PHONE_NUMBER
        });
        throw error;
    }
}

// Add a test function
async function testConnection() {
    try {
        console.log('Testing Twilio connection...');
        const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
        return {
            status: 'connected',
            accountStatus: account.status,
            accountType: account.type,
            friendlyName: account.friendlyName
        };
    } catch (error) {
        console.error('Twilio connection test failed:', error);
        return {
            status: 'error',
            error: error.message,
            code: error.code
        };
    }
}

module.exports = {
    sendAlert,
    testConnection
}; 