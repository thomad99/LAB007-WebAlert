document.getElementById('alertForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const statusBox = document.getElementById('statusContent');
    const formData = {
        websiteUrl: document.getElementById('websiteUrl').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value.replace(/\D/g, ''),
        duration: parseInt(document.getElementById('duration').value)
    };

    // Show the data being sent
    statusBox.innerHTML = `
        <p>⏳ Sending request with:</p>
        <p>🔗 URL: ${formData.websiteUrl}</p>
        <p>📧 Email: ${formData.email}</p>
        <p>📱 Phone: ${formData.phone}</p>
        <p>⏱️ Duration: ${formData.duration} minutes</p>
    `;
    document.getElementById('statusBox').classList.add('status-active');

    try {
        console.log('Sending form data:', formData);
        statusBox.innerHTML += '<p>📡 Connecting to server...</p>';
        
        const response = await fetch('/api/monitor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        statusBox.innerHTML += '<p>⌛ Processing response...</p>';
        
        const data = await response.json();
        console.log('Server response:', data);
        
        if (response.ok) {
            statusBox.innerHTML = `
                <p>✅ Success! Monitoring started</p>
                <p>🆔 Alert ID: ${data.alert.id}</p>
                <p>🔗 URL: ${formData.websiteUrl}</p>
                <p>⏱️ Duration: ${formData.duration} minutes</p>
                <p>📧 Email: ${formData.email}</p>
                <p>📱 Phone: ${formatPhoneNumber(formData.phone)}</p>
                <p>🔄 First check will begin in about 1 minute</p>
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