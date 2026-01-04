window.onerror = function(msg, url, lineNo, columnNo, error) {
    console.error('Global error:', {
        message: msg,
        url: url,
        line: lineNo,
        column: columnNo,
        error: error
    });
    return false;
};

// Terms and Conditions Popup Functions
function showTermsPopup() {
    document.getElementById('termsPopup').style.display = 'block';
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function hideTermsPopup() {
    document.getElementById('termsPopup').style.display = 'none';
    document.body.style.overflow = 'auto'; // Restore scrolling
}

// Close popup with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        hideTermsPopup();
    }
});

document.getElementById('alertForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const statusBox = document.getElementById('statusContent');
    const phone = document.getElementById('phone').value.replace(/\D/g, '');
    const smsConsent = document.getElementById('smsConsent');
    
    // Only require SMS consent if phone number is provided
    if (phone && !smsConsent.checked) {
        alert('Please check the SMS consent checkbox to continue.');
        return;
    }

    const formData = {
        websiteUrl: document.getElementById('websiteUrl').value,
        email: document.getElementById('email').value,
        phone: phone || null,
        duration: parseInt(document.getElementById('duration').value),
        smsConsent: smsConsent.checked
    };

    // Show the data being sent
    statusBox.innerHTML = `
        <p>⏳ Sending request with:</p>
        <p>🔗 URL: ${formData.websiteUrl}</p>
        <p>📧 Email: ${formData.email}</p>
        <p>📱 Phone: ${formData.phone || 'Not provided (email only)'}</p>
        <p>🔄 Polling Interval: ${formData.pollingInterval} minutes</p>
        <p>⏱️ Duration: ${formData.duration} minutes</p>
    `;
    document.getElementById('statusBox').classList.add('status-active');

    try {
        console.log('Sending form data:', formData);
        statusBox.innerHTML += '<p>📡 Connecting to server...</p>';
        
        const response = await fetch('api/monitor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        statusBox.innerHTML += '<p>⌛ Processing response...</p>';
        
        // Check if response is JSON before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(`Server returned ${response.status}: ${text.substring(0, 200)}`);
        }
        
        const data = await response.json();
        console.log('Server response:', data);
        
        if (response.ok) {
            statusBox.innerHTML = `
                <p>✅ Success! Monitoring started</p>
                <p>🆔 Alert ID: ${data.data.subscriber.id}</p>
                <p>🔗 URL: ${formData.websiteUrl}</p>
                <p>🔄 Polling Interval: ${formData.pollingInterval} minutes</p>
                <p>⏱️ Duration: ${formData.duration} minutes</p>
                <p>📧 Email: ${formData.email}</p>
                <p>📱 Phone: ${formData.phone ? formatPhoneNumber(formData.phone) : 'Not provided (email only)'}</p>
                <p>🔄 First check will begin in about ${formData.pollingInterval} minute(s)</p>
                <p><a href="/status.html" class="status-link">View All Monitoring Tasks</a></p>
            `;
            e.target.reset();
        } else {
            throw new Error(data.error || 'Failed to start monitoring');
        }
    } catch (error) {
        console.error('Form submission error:', error);
        statusBox.innerHTML = `
            <p>❌ Error occurred:</p>
            <p>${error.message}</p>
            <p>Please try again or contact support if the problem persists.</p>
        `;
        document.getElementById('statusBox').classList.remove('status-active');
    }
});

// Format phone number for display
function formatPhoneNumber(phone) {
    if (!phone) return 'Not provided';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
        return `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
    }
    return phone;
}

// Format phone number as user types
document.getElementById('phone').addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 0) {
        if (value.length <= 3) {
            value = value;
        } else if (value.length <= 6) {
            value = value.slice(0,3) + "-" + value.slice(3);
        } else {
            value = value.slice(0,3) + "-" + value.slice(3,6) + "-" + value.slice(6,10);
        }
        e.target.value = value;
    }
}); 