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

async function fetchStatus() {
    try {
        console.log('Fetching status...');
        const response = await fetch('/api/status');
        const data = await response.json();
        console.log('Status data:', data);
        
        const monitoringList = document.getElementById('monitoringList');
        
        if (data.length === 0) {
            monitoringList.innerHTML = '<p>No active monitoring tasks</p>';
            return;
        }

        // Fetch alert counts for each monitoring task
        const alertCounts = await Promise.all(
            data.map(item => 
                fetch(`/api/alerts-history/${item.id}`)
                    .then(res => res.json())
                    .then(alerts => ({
                        alertId: item.id,
                        count: alerts.length
                    }))
                    .catch(() => ({
                        alertId: item.id,
                        count: 0
                    }))
            )
        );

        monitoringList.innerHTML = data.map(item => {
            const minutesLeft = Math.max(0, Math.round(item.minutes_left));
            const isActive = minutesLeft > 0;
            const alertCount = alertCounts.find(ac => ac.alertId === item.id)?.count || 0;
            
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
                    <p>🔔 Changes Detected: ${alertCount}</p>
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

// Add this test function
async function testDatabaseConnection() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        console.log('Database health check:', data);
    } catch (error) {
        console.error('Health check failed:', error);
    }
}

// Call both functions
testDatabaseConnection();
fetchStatus();
setInterval(fetchStatus, 30000); 