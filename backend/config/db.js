const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test the pool immediately
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Initial pool test failed:', err);
    } else {
        console.log('Pool initialized successfully, timestamp:', res.rows[0].now);
    }
});

const query = async (text, params) => {
    const start = Date.now();
    try {
        console.log('DB Query starting:', {
            text,
            params,
            stack: new Error().stack.split('\n').slice(2).join('\n')
        });
        
        const res = await pool.query(text, params);
        
        const duration = Date.now() - start;
        console.log('DB Query complete:', {
            text,
            duration,
            rows: res.rows.length,
            result: res.rows
        });
        
        return res;
    } catch (err) {
        console.error('DB Query failed:', {
            text,
            params,
            error: err.message,
            code: err.code,
            detail: err.detail
        });
        throw err;
    }
};

module.exports = {
    query,
    connect: (callback) => pool.connect(callback),
    pool
}; 