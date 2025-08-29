-- Table for monitored URLs
CREATE TABLE IF NOT EXISTS monitored_urls (
    id SERIAL PRIMARY KEY,
    website_url TEXT NOT NULL UNIQUE,
    last_check TIMESTAMP,
    last_content TEXT,
    last_debug JSONB,
    check_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for alert subscribers
CREATE TABLE IF NOT EXISTS alert_subscribers (
    id SERIAL PRIMARY KEY,
    url_id INTEGER REFERENCES monitored_urls(id),
    email VARCHAR(255) NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    polling_duration INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for alert history (modified)
CREATE TABLE IF NOT EXISTS alerts_history (
    id SERIAL PRIMARY KEY,
    url_id INTEGER REFERENCES monitored_urls(id),
    subscriber_id INTEGER REFERENCES alert_subscribers(id),
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    email_sent BOOLEAN DEFAULT false,
    sms_sent BOOLEAN DEFAULT false,
    content_before TEXT,
    content_after TEXT
); 