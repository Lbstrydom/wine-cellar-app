#!/usr/bin/env python3
"""
Migrate wine cellar data from Excel/CSV to SQLite.
Run once to initialise the database from your existing files.
"""

import sqlite3
import pandas as pd
import re
import os
from pathlib import Path

DB_PATH = Path(__file__).parent / 'cellar.db'
DATA_DIR = Path(__file__).parent

def create_schema(conn):
    """Create tables from schema.sql"""
    schema_path = DATA_DIR / 'schema.sql'
    with open(schema_path, 'r') as f:
        conn.executescript(f.read())
    conn.commit()

def generate_slots(conn):
    """Pre-populate all physical storage slots"""
    cursor = conn.cursor()
    
    # Fridge: F1-F9 (row 1: F1-F4, row 2: F5-F9)
    for i in range(1, 10):
        row = 1 if i <= 4 else 2
        cursor.execute(
            "INSERT OR IGNORE INTO slots (zone, location_code, row_num, col_num) VALUES (?, ?, ?, ?)",
            ('fridge', f'F{i}', row, i)
        )
    
    # Cellar: R1 has 7 columns, R2-R19 have 9 columns
    for row in range(1, 20):
        max_col = 7 if row == 1 else 9
        for col in range(1, max_col + 1):
            location_code = f'R{row}C{col}'
            cursor.execute(
                "INSERT OR IGNORE INTO slots (zone, location_code, row_num, col_num) VALUES (?, ?, ?, ?)",
                ('cellar', location_code, row, col)
            )
    
    conn.commit()
    print(f"Created {cursor.rowcount} slots")

def parse_location_range(start_loc, end_loc):
    """
    Parse a location range like R10C1 to R10C3 into individual locations.
    Returns a list of location codes.
    """
    if pd.isna(end_loc) or not end_loc:
        return [start_loc]
    
    # Parse start
    if start_loc.startswith('F'):
        start_num = int(start_loc[1:])
        end_num = int(end_loc[1:])
        return [f'F{i}' for i in range(start_num, end_num + 1)]
    
    # Cellar location
    start_match = re.match(r'R(\d+)C(\d+)', start_loc)
    end_match = re.match(r'R(\d+)C(\d+)', end_loc)
    
    if not start_match or not end_match:
        return [start_loc]
    
    start_row, start_col = int(start_match.group(1)), int(start_match.group(2))
    end_row, end_col = int(end_match.group(1)), int(end_match.group(2))
    
    locations = []
    if start_row == end_row:
        # Same row, span columns
        for col in range(start_col, end_col + 1):
            locations.append(f'R{start_row}C{col}')
    else:
        # Multi-row span (less common)
        locations.append(start_loc)
    
    return locations

def normalise_colour(colour):
    """Normalise colour values"""
    colour = str(colour).lower().strip()
    if colour in ['red']:
        return 'red'
    elif colour in ['white']:
        return 'white'
    elif colour in ['rose', 'rosé']:
        return 'rose'
    elif 'sparkl' in colour or 'prosecco' in colour or 'champagne' in colour:
        return 'sparkling'
    return 'white'  # default

def import_inventory(conn, xlsx_path):
    """Import inventory from Excel file"""
    df = pd.read_excel(xlsx_path)
    cursor = conn.cursor()
    
    wines_added = 0
    slots_filled = 0
    
    for _, row in df.iterrows():
        # Insert wine
        vintage = int(row['vintage']) if pd.notna(row['vintage']) else None
        colour = normalise_colour(row['colour'])
        
        cursor.execute("""
            INSERT INTO wines (style, colour, wine_name, vintage, vivino_rating, price_eur)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            row['style'],
            colour,
            row['wine_name'],
            vintage,
            row['vivino_rating'] if pd.notna(row['vivino_rating']) else None,
            row['netherlands_price_eur'] if pd.notna(row['netherlands_price_eur']) else None
        ))
        wine_id = cursor.lastrowid
        wines_added += 1
        
        # Assign to slots
        if pd.notna(row['location']):
            locations = parse_location_range(row['location'], row.get('loc_end'))
            bottle_count = int(row['bottle_count'])
            
            # Assign bottles to locations (up to bottle_count)
            for i, loc in enumerate(locations[:bottle_count]):
                cursor.execute(
                    "UPDATE slots SET wine_id = ? WHERE location_code = ?",
                    (wine_id, loc)
                )
                if cursor.rowcount > 0:
                    slots_filled += 1
    
    conn.commit()
    print(f"Imported {wines_added} wines, filled {slots_filled} slots")

def import_reduce_now(conn, csv_path):
    """Import reduce-now priorities"""
    df = pd.read_csv(csv_path)
    cursor = conn.cursor()
    
    added = 0
    for _, row in df.iterrows():
        # Find matching wine by name and vintage
        vintage = int(row['vintage']) if pd.notna(row['vintage']) else None
        
        cursor.execute("""
            SELECT id FROM wines 
            WHERE wine_name = ? AND (vintage = ? OR (vintage IS NULL AND ? IS NULL))
        """, (row['wine_name'], vintage, vintage))
        
        result = cursor.fetchone()
        if result:
            wine_id = result[0]
            cursor.execute("""
                INSERT OR REPLACE INTO reduce_now (wine_id, priority, reduce_reason)
                VALUES (?, ?, ?)
            """, (wine_id, row['priority'], row['reduce_reason']))
            added += 1
        else:
            print(f"Warning: Could not find wine '{row['wine_name']}' ({vintage})")
    
    conn.commit()
    print(f"Added {added} wines to reduce-now list")

def import_pairing_matrix(conn, csv_path):
    """Import pairing rules from matrix CSV"""
    df = pd.read_csv(csv_path, index_col=0)
    cursor = conn.cursor()
    
    rules_added = 0
    for food_signal in df.index:
        for wine_style in df.columns:
            match_level = df.loc[food_signal, wine_style]
            if pd.notna(match_level) and match_level in ['primary', 'good', 'fallback']:
                cursor.execute("""
                    INSERT OR REPLACE INTO pairing_rules (food_signal, wine_style_bucket, match_level)
                    VALUES (?, ?, ?)
                """, (food_signal, wine_style, match_level))
                rules_added += 1
    
    conn.commit()
    print(f"Added {rules_added} pairing rules")

def main():
    # Remove existing database
    if DB_PATH.exists():
        os.remove(DB_PATH)
        print(f"Removed existing database: {DB_PATH}")
    
    conn = sqlite3.connect(DB_PATH)
    
    try:
        print("Creating schema...")
        create_schema(conn)
        
        print("Generating storage slots...")
        generate_slots(conn)
        
        # Check for data files in current directory or uploads
        inventory_path = DATA_DIR / 'inventory_layout.xlsx'
        reduce_path = DATA_DIR / 'reduce_now_priority.csv'
        pairing_path = DATA_DIR / 'pairing_matrix.csv'
        
        # Also check uploads directory
        uploads_dir = Path('/mnt/user-data/uploads')
        if not inventory_path.exists() and (uploads_dir / 'inventory_layout.xlsx').exists():
            inventory_path = uploads_dir / 'inventory_layout.xlsx'
        if not reduce_path.exists() and (uploads_dir / 'reduce_now_priority.csv').exists():
            reduce_path = uploads_dir / 'reduce_now_priority.csv'
        if not pairing_path.exists() and (uploads_dir / 'pairing_matrix.csv').exists():
            pairing_path = uploads_dir / 'pairing_matrix.csv'
        
        if inventory_path.exists():
            print(f"Importing inventory from {inventory_path}...")
            import_inventory(conn, inventory_path)
        else:
            print(f"Warning: {inventory_path} not found")
        
        if reduce_path.exists():
            print(f"Importing reduce-now list from {reduce_path}...")
            import_reduce_now(conn, reduce_path)
        else:
            print(f"Warning: {reduce_path} not found")
        
        if pairing_path.exists():
            print(f"Importing pairing matrix from {pairing_path}...")
            import_pairing_matrix(conn, pairing_path)
        else:
            print(f"Warning: {pairing_path} not found")
        
        # Print summary
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM wines")
        print(f"\nDatabase ready: {cursor.fetchone()[0]} wines")
        cursor.execute("SELECT COUNT(*) FROM slots WHERE wine_id IS NOT NULL")
        print(f"Bottles in storage: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM reduce_now")
        print(f"Wines in reduce-now: {cursor.fetchone()[0]}")
        cursor.execute("SELECT COUNT(*) FROM pairing_rules")
        print(f"Pairing rules: {cursor.fetchone()[0]}")
        
    finally:
        conn.close()

if __name__ == '__main__':
    main()
