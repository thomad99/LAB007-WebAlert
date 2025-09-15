// Mock SMS service - logs messages instead of sending them
console.log('Initializing Mock SMS service...');
console.log('SMS messages will be logged to console instead of sent');

// Email transport for email-to-SMS gateways
const nodemailer = require('nodemailer');
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Carrier gateway map (prefer MMS where available for better deliverability)
// Note: Some MVNOs use their host network's gateways. We map common aliases.
const CARRIER_GATEWAYS = {
    // AT&T and FirstNet (FirstNet rides on AT&T)
    'att': { sms: 'txt.att.net', mms: 'mms.att.net' },
    'at&t': { sms: 'txt.att.net', mms: 'mms.att.net' },
    'firstnet': { sms: 'txt.att.net', mms: 'mms.att.net' },

    // Verizon and Xfinity Mobile (Xfinity uses Verizon network)
    'verizon': { sms: 'vtext.com', mms: 'vzwpix.com' },
    'xfinity': { sms: 'vtext.com', mms: 'vzwpix.com' },
    'xfinity mobile': { sms: 'vtext.com', mms: 'vzwpix.com' },
    'comcast': { sms: 'vtext.com', mms: 'vzwpix.com' },

    // T-Mobile and MVNOs (Mint Mobile, Google Fi often route via tmomail)
    'tmobile': { sms: 'tmomail.net', mms: 'tmomail.net' },
    't-mobile': { sms: 'tmomail.net', mms: 'tmomail.net' },
    'mint': { sms: 'tmomail.net', mms: 'tmomail.net' },
    'mint mobile': { sms: 'tmomail.net', mms: 'tmomail.net' },

    // Google Fi direct
    'google fi': { sms: 'msg.fi.google.com', mms: 'msg.fi.google.com' },

    // Cricket (AT&T)
    'cricket': { sms: 'sms.cricketwireless.net', mms: 'mms.cricketwireless.net' },

    // US Cellular
    'us cellular': { sms: 'email.uscc.net', mms: 'mms.uscc.net' },
    'uscellular': { sms: 'email.uscc.net', mms: 'mms.uscc.net' },

    // Metro by T-Mobile
    'metro': { sms: 'metropcs.sms.us', mms: 'mymetropcs.com' },
    'metropcs': { sms: 'metropcs.sms.us', mms: 'mymetropcs.com' },
    'metro by t-mobile': { sms: 'metropcs.sms.us', mms: 'mymetropcs.com' },

    // Boost (varies by network; historically Sprint/T-Mobile)
    'boost': { sms: 'sms.myboostmobile.com', mms: 'myboostmobile.com' },
    'boost mobile': { sms: 'sms.myboostmobile.com', mms: 'myboostmobile.com' },

    // Ting (multiple backends; try both)
    'ting': { sms: 'message.ting.com', mms: 'message.ting.com' },

    // Consumer Cellular (AT&T/T-Mobile MVNO)
    'consumer cellular': { sms: 'mailmymobile.net', mms: 'mailmymobile.net' },

    // Straight Talk (multiple networks)
    'straight talk': { sms: 'vtext.com', mms: 'mypixmessages.com' },

    // Tracfone (multiple networks)
    'tracfone': { sms: 'mmst5.tracfone.com', mms: 'mmst5.tracfone.com' },

    // Visible (Verizon)
    'visible': { sms: 'vtext.com', mms: 'vzwpix.com' },
};

function normalizeCarrierName(carrier) {
    if (!carrier) return '';
    return String(carrier).trim().toLowerCase();
}

function resolveGatewayAddress(phone, carrier, preferMms = true) {
    const cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.length < 10) {
        throw new Error('Invalid phone number for gateway');
    }
    const last10 = cleaned.slice(-10);
    const key = normalizeCarrierName(carrier);
    const entry = CARRIER_GATEWAYS[key];
    if (!entry) {
        throw new Error(`Unsupported or unknown carrier: ${carrier}`);
    }
    const domain = preferMms && entry.mms ? entry.mms : entry.sms;
    if (!domain) {
        throw new Error(`No gateway domain available for carrier: ${carrier}`);
    }
    return `${last10}@${domain}`;
}

async function sendViaEmailGateway(phone, carrier, message, subject, preferMms = true) {
    try {
        const toAddress = resolveGatewayAddress(phone, carrier, preferMms);
        const mailOptions = {
            from: `"Web Alert" <${process.env.EMAIL_USER}>`,
            to: toAddress,
            subject: subject || 'Web Alert',
            text: message,
        };

        console.log('Sending Email-to-SMS via gateway:', { toAddress, carrier, preferMms });
        const info = await emailTransporter.sendMail(mailOptions);
        console.log('Gateway email sent:', {
            messageId: info.messageId,
            response: info.response,
            accepted: info.accepted,
            rejected: info.rejected
        });
        return {
            method: 'email-gateway',
            to: toAddress,
            carrier: normalizeCarrierName(carrier),
            messageId: info.messageId,
            response: info.response,
            accepted: info.accepted,
            rejected: info.rejected
        };
    } catch (error) {
        console.error('Error sending via email-to-SMS gateway:', {
            error: error.message,
            carrier,
            phone
        });
        throw error;
    }
}

// Mock client for compatibility
const client = {
    messages: {
        create: async (messageData) => {
            console.log('📱 MOCK SMS SENT:', messageData);
            return {
                sid: 'mock_' + Date.now(),
                status: 'delivered',
                to: messageData.to,
                from: messageData.from
            };
        }
    },
    api: {
        accounts: () => ({
            fetch: async () => ({
                status: 'active',
                type: 'mock',
                friendlyName: 'Mock SMS Service'
            })
        })
    }
};

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
        console.log('Testing Mock SMS connection...');
        // Simulate a successful connection test
        return {
            status: 'connected',
            accountStatus: 'active',
            accountType: 'mock',
            friendlyName: 'Mock SMS Service'
        };
    } catch (error) {
        console.error('Mock SMS connection test failed:', error);
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