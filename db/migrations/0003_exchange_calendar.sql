CREATE TABLE exchange_holidays (
  holiday_date DATE PRIMARY KEY,
  exchange_id TEXT NOT NULL DEFAULT 'US',
  description TEXT NOT NULL
);

INSERT INTO exchange_holidays (holiday_date, exchange_id, description) VALUES
('2024-01-01', 'US', 'New Year''s Day'),
('2024-01-15', 'US', 'Martin Luther King Jr. Day'),
('2024-02-19', 'US', 'Presidents'' Day'),
('2024-03-29', 'US', 'Good Friday'),
('2024-05-27', 'US', 'Memorial Day'),
('2024-06-19', 'US', 'Juneteenth National Independence Day'),
('2024-07-04', 'US', 'Independence Day'),
('2024-09-02', 'US', 'Labor Day'),
('2024-11-28', 'US', 'Thanksgiving Day'),
('2024-12-25', 'US', 'Christmas Day'),

('2025-01-01', 'US', 'New Year''s Day'),
('2025-01-20', 'US', 'Martin Luther King Jr. Day'),
('2025-02-17', 'US', 'Presidents'' Day'),
('2025-04-18', 'US', 'Good Friday'),
('2025-05-26', 'US', 'Memorial Day'),
('2025-06-19', 'US', 'Juneteenth National Independence Day'),
('2025-07-04', 'US', 'Independence Day'),
('2025-09-01', 'US', 'Labor Day'),
('2025-11-27', 'US', 'Thanksgiving Day'),
('2025-12-25', 'US', 'Christmas Day');
