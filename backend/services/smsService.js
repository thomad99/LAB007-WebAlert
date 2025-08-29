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

// Helper function to format phone numbers
function formatPhoneNumber(phone) {
    // Remove any non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // If it's a 10-digit US number without country code, add +1
    if (cleaned.length === 10) {
        return `+1${cleaned}`;
    }
    
    // If it already has country code (11 digits starting with 1)
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return `+${cleaned}`;
    }
    
    // If it already has a plus, return original
    if (phone.startsWith('+')) {
        return phone;
    }
    
    // Default to adding +1 if none of the above
    return `+1${cleaned}`;
}

async function sendAlert(phone, websiteUrl) {
    try {
        // Format the phone number
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log('Attempting to send SMS...', {
            originalPhone: phone,
            formattedPhone: formattedPhone,
            from: process.env.TWILIO_PHONE_NUMBER,
            websiteUrl
        });
        
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
            originalPhone: phone,
            twilioNumber: process.env.TWILIO_PHONE_NUMBER
        });
        throw error;
    }
}

async function sendWelcomeSMS(phone, websiteUrl, duration) {
    try {
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log('Sending welcome SMS to:', formattedPhone);
        
        const message = await client.messages.create({
            body: `🎉 Welcome to Web Alert! We're now monitoring ${websiteUrl} for ${duration} minutes. Checks every 5 min.`,
            to: formattedPhone,
            from: process.env.TWILIO_PHONE_NUMBER
        });

        console.log('Welcome SMS sent successfully:', message.sid);
        return message;
    } catch (error) {
        console.error('Error sending welcome SMS:', error);
        throw error;
    }
}

async function sendSummarySMS(phone, websiteUrl, checkCount, changesDetected) {
    try {
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log('Sending summary SMS to:', formattedPhone);
        
        const summaryText = changesDetected > 0 
            ? `We detected ${changesDetected} change(s)`
            : 'No changes were detected';
        
        const message = await client.messages.create({
            body: `📊 Monitoring Complete: ${websiteUrl}. ${summaryText}. Total checks: ${checkCount}. Thank you for using Web Alert!`,
            to: formattedPhone,
            from: process.env.TWILIO_PHONE_NUMBER
        });

        console.log('Summary SMS sent successfully:', message.sid);
        return message;
    } catch (error) {
        console.error('Error sending summary SMS:', error);
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
    sendWelcomeSMS,
    sendSummarySMS,
    testConnection,
    formatPhoneNumber // Export for testing
}; 