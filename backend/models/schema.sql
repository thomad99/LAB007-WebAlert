CREATE TABLE IF NOT EXISTS web_alerts (
    id SERIAL PRIMARY KEY,
    website_url TEXT NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    polling_duration INTEGER NOT NULL,
    last_check TIMESTAMP,
    last_content TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
); 