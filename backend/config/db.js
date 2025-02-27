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

module.exports = {
    query: (text, params) => {
        console.log('Executing query:', { text, params });
        return pool.query(text, params)
            .then(res => {
                console.log('Query successful:', res.rowCount, 'rows affected');
                return res;
            })
            .catch(err => {
                console.error('Query failed:', err);
                throw err;
            });
    },
    connect: (callback) => {
        return pool.connect(callback);
    },
    pool
}; 