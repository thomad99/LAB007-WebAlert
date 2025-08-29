const { Pool } = require('pg');

// First, log the connection details we're using
console.log('Initializing database connection with:', {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: true
});

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false
    },
    // Add connection timeout and retry settings
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 20
});

// Handle pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Test the pool immediately
const testConnection = async () => {
    let client;
    try {
        client = await pool.connect();
        console.log('Database connection test - getting client successful');
        
        const result = await client.query('SELECT NOW() as now');
        console.log('Database connection test - query successful:', result.rows[0]);
        
        return true;
    } catch (err) {
        console.error('Database connection test failed:', err);
        return false;
    } finally {
        if (client) {
            client.release();
            console.log('Database connection test - client released');
        }
    }
};

// Execute the test immediately
testConnection().then(success => {
    if (!success) {
        console.error('Initial database connection test failed');
        process.exit(1);
    }
});

const query = async (text, params) => {
    const start = Date.now();
    let client;

    try {
        client = await pool.connect();
        console.log('Got client for query:', { text, params });

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
    connect: (callback) => pool.connect(callback),
    pool,
    checkHealth
}; 