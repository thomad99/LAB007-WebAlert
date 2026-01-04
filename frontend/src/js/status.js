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
        const response = await fetch('api/status');
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
                fetch(`api/alerts-history/${item.id}`)
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
                    <p>🔄 Scrape Progress: ${item.check_count} of ${item.polling_duration}</p>
                    <p>🔔 Changes Detected: ${alertCount}</p>
                    <div class="button-group">
                        <button onclick="viewContent(${item.id})" class="view-content-btn">
                            View Content
                        </button>
                        <button onclick="viewDebug(${item.id})" class="debug-btn">
                            View Debug Info
                        </button>
                    </div>
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
        const response = await fetch('api/health');
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

// Add this function to view content
async function viewContent(alertId) {
    try {
        const response = await fetch(`api/content/${alertId}`);
        const data = await response.json();
        
        const modal = document.createElement('div');
        modal.className = 'content-modal';
        
        const content = `
            <div class="modal-content">
                <h2>Content History</h2>
                <button onclick="this.parentElement.parentElement.remove()" class="close-button">×</button>
                
                <h3>Current Content</h3>
                <div class="content-box">
                    <p><strong>URL:</strong> ${data.current?.website_url || 'N/A'}</p>
                    <p><strong>Last Check:</strong> ${data.current?.last_check ? new Date(data.current.last_check).toLocaleString() : 'N/A'}</p>
                    <pre>${data.current?.last_content || 'No content stored'}</pre>
                </div>

                <h3>Change History</h3>
                ${data.history.map(h => `
                    <div class="history-item">
                        <p><strong>Detected:</strong> ${new Date(h.detected_at).toLocaleString()}</p>
                        <div class="content-diff">
                            <div class="before">
                                <h4>Before:</h4>
                                <pre>${h.content_before || 'N/A'}</pre>
                            </div>
                            <div class="after">
                                <h4>After:</h4>
                                <pre>${h.content_after || 'N/A'}</pre>
                            </div>
                        </div>
                    </div>
                `).join('') || '<p>No changes detected yet</p>'}
            </div>
        `;
        
        modal.innerHTML = content;
        document.body.appendChild(modal);
    } catch (error) {
        console.error('Error viewing content:', error);
        alert('Failed to load content history');
    }
}

// Add this function to view debug info
async function viewDebug(alertId) {
    try {
        const response = await fetch(`api/debug/${alertId}`);
        const data = await response.json();
        
        const modal = document.createElement('div');
        modal.className = 'content-modal';
        
        const content = `
            <div class="modal-content debug-view">
                <h2>Scraping Debug Info</h2>
                <button onclick="this.parentElement.parentElement.remove()" class="close-button">×</button>
                
                <div class="debug-info">
                    <h3>Basic Info</h3>
                    <p><strong>URL:</strong> ${data.website_url}</p>
                    <p><strong>Last Check:</strong> ${new Date(data.last_check).toLocaleString()}</p>
                    <p><strong>Progress:</strong> ${data.check_count} of ${data.polling_duration}</p>
                    
                    ${data.last_debug ? `
                        <h3>Scraping Steps</h3>
                        <div class="steps-log">
                            ${data.last_debug.steps.map(step => `
                                <div class="step">${step}</div>
                            `).join('')}
                        </div>
                        
                        ${data.last_debug.screenshot ? `
                            <h3>Screenshot</h3>
                            <img src="${data.last_debug.screenshot}" alt="Page screenshot" class="debug-screenshot">
                        ` : ''}
                        
                        <h3>Raw Content</h3>
                        <div class="content-box">
                            <pre>${data.last_content || 'No content'}</pre>
                        </div>
                        
                        ${data.last_debug.error ? `
                            <h3>Error</h3>
                            <div class="error-box">
                                <p><strong>Message:</strong> ${data.last_debug.error.message}</p>
                                <pre>${data.last_debug.error.stack}</pre>
                            </div>
                        ` : ''}
                    ` : '<p>No debug information available</p>'}
                </div>
            </div>
        `;
        
        modal.innerHTML = content;
        document.body.appendChild(modal);
    } catch (error) {
        console.error('Error viewing debug info:', error);
        alert('Failed to load debug information');
    }
} 