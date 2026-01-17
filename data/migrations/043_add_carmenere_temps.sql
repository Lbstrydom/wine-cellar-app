-- Migration 043: Add Carmenere and other missing grape varietals to serving temperatures
-- Fixes issue where Carmenere was incorrectly matching to Beaujolais

-- Add South American and Chilean varietals
INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Carmenere', 'red', 'medium_structured', 'Carmenere', 'Chile, Maipo, Colchagua', 'medium-full', 16, 18, 61, 64, 'Chilean signature grape, serve at cellar temperature'),
('Chilean Carmenere', 'red', 'medium_structured', 'Carmenere', 'Chile, Maipo Valley, Colchagua', 'medium-full', 16, 18, 61, 64, 'Softer tannins than Cabernet, classic cellar temp'),
('Malbec', 'red', 'full_rich', 'Malbec', 'Argentina, Mendoza, Cahors', 'full', 16, 18, 61, 64, 'Argentinian flagship grape'),
('Argentinian Malbec', 'red', 'full_rich', 'Malbec', 'Mendoza, Salta, Patagonia', 'full', 16, 18, 61, 64, 'Full-bodied, serve at cellar temperature'),
('Tannat', 'red', 'full_tannic', 'Tannat', 'Uruguay, Madiran', 'full', 17, 19, 63, 66, 'Very tannic, benefits from warmth'),
('Bonarda', 'red', 'medium_structured', 'Bonarda', 'Argentina', 'medium', 15, 17, 59, 63, 'Argentinian red, softer style'),
('Pais', 'red', 'light_fruity', 'Pais, Mission', 'Chile, Itata, Maule', 'light', 13, 15, 55, 59, 'Light Chilean native grape')
ON CONFLICT DO NOTHING;

-- Add more Mediterranean varietals often missing
INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Touriga Nacional', 'red', 'full_rich', 'Touriga Nacional', 'Douro, Portugal', 'full', 16, 18, 61, 64, 'Portuguese flagship, aromatic and powerful'),
('Alvarinho', 'white', 'light_crisp', 'Alvarinho, Albarino', 'Vinho Verde, Rias Baixas', 'light', 7, 10, 45, 50, 'Aromatic white from Iberia'),
('Verdejo', 'white', 'light_crisp', 'Verdejo', 'Rueda, Spain', 'light', 7, 10, 45, 50, 'Spanish aromatic white'),
('Godello', 'white', 'aromatic', 'Godello', 'Galicia, Spain', 'medium', 9, 12, 48, 54, 'Full-bodied Spanish white'),
('Assyrtiko', 'white', 'light_crisp', 'Assyrtiko', 'Santorini, Greece', 'medium', 8, 11, 46, 52, 'Minerally Greek white'),
('Viura', 'white', 'light_crisp', 'Viura, Macabeo', 'Rioja, Spain', 'light', 7, 10, 45, 50, 'Spanish white Rioja grape')
ON CONFLICT DO NOTHING;

-- Add South African varietals
INSERT INTO wine_serving_temperatures (wine_type, category, subcategory, grape_varieties, regions, body, temp_min_celsius, temp_max_celsius, temp_min_fahrenheit, temp_max_fahrenheit, notes) VALUES
('Pinotage', 'red', 'medium_structured', 'Pinotage', 'South Africa, Stellenbosch, Swartland', 'medium-full', 15, 17, 59, 63, 'South African cross, smoky character'),
('South African Pinotage', 'red', 'medium_structured', 'Pinotage', 'Stellenbosch, Paarl, Swartland', 'medium-full', 15, 17, 59, 63, 'Unique South African grape'),
('Cape Blend', 'red', 'full_rich', 'Pinotage, Cabernet Sauvignon, Shiraz', 'South Africa', 'full', 16, 18, 61, 64, 'South African blend with Pinotage'),
('Chenin Blanc (South Africa)', 'white', 'full_bodied', 'Chenin Blanc, Steen', 'South Africa, Swartland, Stellenbosch', 'medium-full', 10, 13, 50, 55, 'South African Chenin, often oaked'),
('Steen', 'white', 'aromatic', 'Chenin Blanc', 'South Africa', 'medium', 9, 12, 48, 54, 'Local name for Chenin Blanc')
ON CONFLICT DO NOTHING;
