const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'dpg-culanb8gph6c73d9jl50-a',
    user: process.env.DB_USER || 'sail1',
    password: process.env.DB_PASSWORD || '5p2GYOeXinvhRvhfOjkK30zItFISFcxs',
    database: process.env.DB_NAME || 'sail_exks',
    port: parseInt(process.env.DB_PORT || '5432'),
    ssl: {
        rejectUnauthorized: false
    }
});

module.exports = pool; 