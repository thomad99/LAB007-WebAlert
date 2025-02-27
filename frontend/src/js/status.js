async function fetchStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        const monitoringList = document.getElementById('monitoringList');
        
        if (data.length === 0) {
            monitoringList.innerHTML = '<p>No active monitoring tasks</p>';
            return;
        }

        monitoringList.innerHTML = data.map(item => {
            const minutesLeft = Math.max(0, Math.round(item.minutes_left));
            const isActive = minutesLeft > 0;
            
            return `
                <div class="monitoring-item ${isActive ? 'active' : ''}">
                    <h3>
                        ${item.website_url}
                        <span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">
                            ${isActive ? 'Active' : 'Completed'}
                        </span>
                    </h3>
                    <p>📧 Email: ${item.email}</p>
                    <p>📱 Phone: ${formatPhoneNumber(item.phone_number)}</p>
                    <p>⏱️ Duration: ${item.polling_duration} minutes</p>
                    <p class="time-remaining">
                        ${isActive 
                            ? `Time Remaining: ${minutesLeft} minutes` 
                            : 'Monitoring Complete'}
                    </p>
                    <p>🕒 Started: ${new Date(item.created_at).toLocaleString()}</p>
                    ${item.last_check 
                        ? `<p>🔄 Last Check: ${new Date(item.last_check).toLocaleString()}</p>` 
                        : ''}
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error fetching status:', error);
        document.getElementById('monitoringList').innerHTML = 
            '<p>Error loading monitoring status</p>';
    }
}

function formatPhoneNumber(phone) {
    const cleaned = phone.replace(/\D/g, '');
    const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return phone;
}

// Fetch status immediately and then every 30 seconds
fetchStatus();
setInterval(fetchStatus, 30000); 