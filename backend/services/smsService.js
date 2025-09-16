// Real Twilio SMS service
console.log('Initializing Twilio SMS service...');

const twilio = require('twilio');
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Email transport for email-to-SMS gateways (fallback)
const nodemailer = require('nodemailer');
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    },
    debug: true,
    logger: true
});

// Carrier gateway map (prefer MMS where available for better deliverability)
// Note: Some MVNOs use their host network's gateways. We map common aliases.
const CARRIER_GATEWAYS = {
    // AT&T and FirstNet (FirstNet rides on AT&T)
    'att': { sms: 'txt.att.net', mms: 'mms.att.net' },
    'at&t': { sms: 'txt.att.net', mms: 'mms.att.net' },
    'firstnet': { sms: 'txt.att.net', mms: 'mms.att.net' },
    // Alternative AT&T domains
    'att-alt': { sms: 'mobile.att.net', mms: 'mms.att.net' },

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

// Alias groups to try host networks when tryAll is enabled
const CARRIER_ALIASES = {
    'firstnet': ['att', 'att-alt'],
    'mint': ['tmobile'],
    'mint mobile': ['tmobile'],
    'xfinity': ['verizon'],
    'xfinity mobile': ['verizon'],
    'comcast': ['verizon'],
    'visible': ['verizon'],
    'consumer cellular': ['att', 'tmobile'],
    'straight talk': ['verizon', 'att', 'tmobile']
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

async function sendViaEmailGateway(phone, carrier, message, subject, preferMms = true, fallback = true, tryAll = false, options = {}) {
    try {
        const cleaned = String(phone).replace(/\D/g, '');
        if (cleaned.length < 10) throw new Error('Invalid phone number for gateway');

        const key = normalizeCarrierName(carrier);
        const entriesKeys = [key, ...(tryAll ? (CARRIER_ALIASES[key] || []) : [])];
        const entries = entriesKeys
            .map(k => ({ k, e: CARRIER_GATEWAYS[k] }))
            .filter(x => !!x.e);
        if (entries.length === 0) throw new Error(`Unsupported or unknown carrier: ${carrier}`);

        // Build ordered domain list across primary and alias carriers
        const domains = [];
        for (const { k: carrierKey, e } of entries) {
            if (preferMms && e.mms && !domains.includes(`${carrierKey}:${e.mms}`)) {
                domains.push(`${carrierKey}:${e.mms}`);
            }
            if (e.sms && !domains.includes(`${carrierKey}:${e.sms}`)) {
                domains.push(`${carrierKey}:${e.sms}`);
            }
            if (!preferMms && e.mms && !domains.includes(`${carrierKey}:${e.mms}`)) {
                domains.push(`${carrierKey}:${e.mms}`);
            }
        }

        const last10 = cleaned.slice(-10);
        const attempts = [];
        let lastError = null;

        for (const keyAndDomain of domains) {
            const [carrierKey, domain] = keyAndDomain.split(':');
            const toAddress = `${last10}@${domain}`;
            const mailOptions = {
                from: `"Web Alert" <${process.env.EMAIL_USER}>`,
                to: toAddress,
                subject: options.blankSubject ? '' : (subject || 'Web Alert'),
                text: options.shortMessage ? String(message || '').slice(0, 120) : message,
            };

            console.log('Sending Email-to-SMS via gateway:', { toAddress, carrier: carrierKey, domain });
            try {
                const info = await emailTransporter.sendMail(mailOptions);
                attempts.push({ carrier: carrierKey, domain, to: toAddress, success: true, messageId: info.messageId });
                if (!tryAll) {
                    return {
                        method: 'email-gateway',
                        to: toAddress,
                        carrier: carrierKey,
                        domain: domain,
                        messageId: info.messageId,
                        response: info.response,
                        accepted: info.accepted,
                        rejected: info.rejected,
                        attempts
                    };
                }
            } catch (err) {
                console.error('Gateway send failed for domain', domain, err.message);
                attempts.push({ carrier: carrierKey, domain, to: toAddress, success: false, error: err.message });
                lastError = err;
                if (!fallback) break;
            }
        }

        // If trying all, return a summary with overall success = any success
        if (tryAll) {
            const anySuccess = attempts.some(a => a.success);
            return {
                method: 'email-gateway',
                carrier: key,
                triedAll: true,
                success: anySuccess,
                attempts
            };
        }

        const error = lastError || new Error('All gateway attempts failed');
        error.attempts = attempts;
        throw error;
    } catch (error) {
        console.error('Error sending via email-to-SMS gateway:', {
            error: error.message,
            carrier,
            phone,
            attempts: error.attempts
        });
        throw error;
    }
}

// Twilio client is already initialized above

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
        
        console.log('Attempting to send SMS via Twilio...', {
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

        console.log('SMS sent successfully via Twilio:', {
            messageId: message.sid,
            status: message.status,
            to: message.to,
            from: message.from
        });

        return message;
    } catch (error) {
        console.error('Error sending SMS via Twilio:', {
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
        
        console.log('Sending welcome SMS via Twilio to:', formattedPhone);
        
        const message = await client.messages.create({
            body: `🎉 Welcome to Web Alert! We're now monitoring ${websiteUrl} for ${duration} minutes. Checks every 3 min.`,
            to: formattedPhone,
            from: process.env.TWILIO_PHONE_NUMBER
        });

        console.log('Welcome SMS sent successfully via Twilio:', message.sid);
        return message;
    } catch (error) {
        console.error('Error sending welcome SMS via Twilio:', error);
        throw error;
    }
}

async function sendSummarySMS(phone, websiteUrl, checkCount, changesDetected) {
    try {
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log('Sending summary SMS via Twilio to:', formattedPhone);
        
        const summaryText = changesDetected > 0 
            ? `We detected ${changesDetected} change(s)`
            : 'No changes were detected';
        
        const message = await client.messages.create({
            body: `📊 Monitoring Complete: ${websiteUrl}. ${summaryText}. Total checks: ${checkCount}. Thank you for using Web Alert!`,
            to: formattedPhone,
            from: process.env.TWILIO_PHONE_NUMBER
        });

        console.log('Summary SMS sent successfully via Twilio:', message.sid);
        return message;
    } catch (error) {
        console.error('Error sending summary SMS via Twilio:', error);
        throw error;
    }
}

// Add a test function
async function testConnection() {
    try {
        console.log('Testing Twilio SMS connection...');
        const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
        return {
            status: 'connected',
            accountStatus: account.status,
            accountType: account.type,
            friendlyName: account.friendlyName,
            phoneNumber: process.env.TWILIO_PHONE_NUMBER
        };
    } catch (error) {
        console.error('Twilio SMS connection test failed:', error);
        return {
            status: 'error',
            error: error.message,
            code: error.code
        };
    }
}

async function testAllCarriers(phone, message = 'Test') {
    const results = [];
    const carriers = Object.keys(CARRIER_GATEWAYS);
    
    for (const carrier of carriers) {
        try {
            console.log(`Testing carrier: ${carrier}`);
            const result = await sendViaEmailGateway(
                phone, 
                carrier, 
                message, 
                '', // blank subject
                true, // prefer MMS
                true, // fallback
                true, // try all
                { blankSubject: true, shortMessage: true }
            );
            results.push({ carrier, success: true, result });
        } catch (error) {
            results.push({ carrier, success: false, error: error.message, attempts: error.attempts });
        }
    }
    
    return results;
}

module.exports = {
    sendAlert,
    sendWelcomeSMS,
    sendSummarySMS,
    testConnection,
    formatPhoneNumber, // Export for testing
    sendViaEmailGateway,
    resolveGatewayAddress,
    testAllCarriers
}; 