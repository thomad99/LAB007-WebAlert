document.getElementById('alertForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const statusBox = document.getElementById('statusContent');
    const formData = {
        websiteUrl: document.getElementById('websiteUrl').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value.replace(/\D/g, ''),
        duration: parseInt(document.getElementById('duration').value)
    };

    statusBox.innerHTML = 'Starting monitoring...';
    document.getElementById('statusBox').classList.add('status-active');

    try {
        const response = await fetch('/api/monitor', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();
        if (response.ok) {
            statusBox.innerHTML = `
                <p>✅ Monitoring started successfully!</p>
                <p>Monitoring URL: ${formData.websiteUrl}</p>
                <p>Duration: ${formData.duration} minutes</p>
                <p>Notifications will be sent to:</p>
                <p>📧 ${formData.email}</p>
                <p>📱 ${formData.phone}</p>
            `;
            e.target.reset();
        } else {
            throw new Error(data.error || 'Failed to start monitoring');
        }
    } catch (error) {
        statusBox.innerHTML = `❌ Error: ${error.message}`;
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