const { Pool, Client } = require('pg');

// Helper function to extract hostname from database URL if provided
function parseHostname(hostValue) {
    if (!hostValue) return null;
    
    // If it's a full URL (starts with postgresql:// or postgres://), extract the hostname
    if (hostValue.startsWith('postgresql://') || hostValue.startsWith('postgres://')) {
        try {
            const url = new URL(hostValue);
            return url.hostname;
        } catch (e) {
            console.warn('Failed to parse hostname as URL, using as-is:', e.message);
            return hostValue;
        }
    }
    
    // Otherwise, use it as-is (should be just the hostname)
    return hostValue;
}

// Get list of hostnames to try in order
function getHostnameCandidates() {
    const candidates = [];
    
    // Add DB_HOST if set
    if (process.env.DB_HOST) {
        candidates.push({ name: 'DB_HOST', value: parseHostname(process.env.DB_HOST) });
    }
    
    // Add DB_INTERNAL if set
    if (process.env.DB_INTERNAL) {
        candidates.push({ name: 'DB_INTERNAL', value: parseHostname(process.env.DB_INTERNAL) });
    }
    
    // Add DB_EXTERNAL if set
    if (process.env.DB_EXTERNAL) {
        candidates.push({ name: 'DB_EXTERNAL', value: parseHostname(process.env.DB_EXTERNAL) });
    }
    
    return candidates;
}

// Test connection to a specific hostname
async function testHostname(hostname, hostnameName) {
    const testClient = new Client({
        host: hostname,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000
    });
    
    try {
        await testClient.connect();
        const result = await testClient.query('SELECT NOW() as now');
        await testClient.end();
        console.log(`✓ Connection test successful with ${hostnameName}: ${hostname}`);
        return { success: true, hostname, hostnameName };
    } catch (err) {
        await testClient.end().catch(() => {}); // Ignore errors when closing
        console.warn(`✗ Connection test failed with ${hostnameName} (${hostname}): ${err.code || err.message}`);
        return { success: false, hostname, hostnameName, error: err };
    }
}

// Find the first working hostname
async function findWorkingHostname() {
    const candidates = getHostnameCandidates();
    
    if (candidates.length === 0) {
        console.warn('No database hostname environment variables found (DB_HOST, DB_INTERNAL, DB_EXTERNAL)');
        return null;
    }
    
    console.log(`Testing ${candidates.length} database hostname(s) in order...`);
    
    for (const candidate of candidates) {
        const result = await testHostname(candidate.value, candidate.name);
        if (result.success) {
            console.log(`Using ${result.hostnameName}: ${result.hostname}`);
            return result.hostname;
        }
    }
    
    console.error('All database hostname connection tests failed');
    // Return the first candidate anyway (DB_HOST), the pool will handle errors gracefully
    return candidates[0].value;
}

// Initialize with a placeholder pool (will be replaced after testing)
let dbHost = null;
let pool = null;

// Initialize database connection with hostname testing
(async () => {
    dbHost = await findWorkingHostname();
    
    if (!dbHost) {
        console.error('No database hostname available - database queries will fail');
        // Create a dummy pool that will fail gracefully
        pool = new Pool({
            host: 'invalid-host',
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 20
        });
        return;
    }
    
    // Create the pool with the working hostname
    pool = new Pool({
        host: dbHost,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT,
        ssl: {
            rejectUnauthorized: false
        },
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 20
    });
    
    // Handle pool errors (non-fatal - just log the error)
    pool.on('error', (err) => {
        console.error('Unexpected error on idle database client:', err);
        console.warn('Database pool error - server will continue running');
        // Don't exit - allow the server to continue and retry connections when needed
    });
    
    console.log('Database pool initialized with hostname:', dbHost);
})();

// Test the pool after initialization (non-blocking, non-fatal)
// The server will start even if the database connection fails initially
setTimeout(async () => {
    if (!pool) {
        console.warn('Database pool not yet initialized - will retry later');
        return;
    }
    
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW() as now');
        client.release();
        console.log('Database pool connection test successful:', result.rows[0]);
    } catch (err) {
        console.warn('Database pool connection test failed (non-fatal):', err.message);
        console.warn('Database will be retried when API endpoints are accessed');
    }
}, 3000); // Wait 3 seconds for initialization to complete

const query = async (text, params) => {
    const start = Date.now();
    let client;
    let retries = 3;
    let lastError;

    // Retry logic for connection issues
    while (retries > 0) {
        try {
            client = await pool.connect();
            console.log('Got client for query:', { text, params });
            break; // Success, exit retry loop
        } catch (err) {
            lastError = err;
            retries--;
            if (retries > 0 && (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED')) {
                console.warn(`Database connection attempt failed (${err.code}), retrying... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
            } else {
                throw err; // Re-throw if not a retryable error or out of retries
            }
        }
    }

    if (!client) {
        throw lastError || new Error('Failed to get database client after retries');
    }

    try {

        const res = await client.query(text, params);
        const duration = Date.now() - start;
        
        console.log('Query executed successfully:', {
            text,
            duration,
            rows: res.rows.length,
            result: res.rows
        });
        
        return res;
    } catch (err) {
        console.error('Query failed:', {
            text,
            params,
            error: err.message,
            code: err.code,
            detail: err.detail,
            stack: err.stack
        });
        throw err;
    } finally {
        if (client) {
            client.release();
            console.log('Client released after query:', { text });
        }
    }
};

// Export a function to check database health
const checkHealth = async () => {
    try {
        const result = await query('SELECT NOW() as now');
        return {
            status: 'healthy',
            timestamp: result.rows[0].now,
            poolStatus: {
                totalCount: pool.totalCount,
                idleCount: pool.idleCount,
                waitingCount: pool.waitingCount
            }
        };
    } catch (err) {
        return {
            status: 'unhealthy',
            error: err.message,
            details: {
                code: err.code,
                detail: err.detail
            }
        };
    }
};

module.exports = {
    query,
    connect: (callback) => {
        if (!pool) {
            console.warn('Database pool not yet initialized - connect() called too early');
            return callback(new Error('Database pool not yet initialized'));
        }
        return pool.connect(callback);
    },
    pool,
    checkHealth
}; 