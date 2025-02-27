document.getElementById('alertForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
        websiteUrl: document.getElementById('websiteUrl').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value.replace(/\D/g, ''), // Remove non-digits
        duration: parseInt(document.getElementById('duration').value)
    };

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
            alert('Monitoring started successfully!');
            e.target.reset();
        } else {
            throw new Error(data.error || 'Failed to start monitoring');
        }
    } catch (error) {
        alert(error.message);
    }
}); 