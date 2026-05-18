#!/bin/bash

# GST Compliance Migrations Runner for Linux/Mac
# This script helps run the Node.js migration script

echo "========================================"
echo "GST Compliance Migrations Runner"
echo "========================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed or not in PATH"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "WARNING: .env file not found"
    echo "Please create .env file with database connection details"
    echo ""
    echo "Example .env content:"
    echo "DATABASE_URL=postgresql://username:password@localhost:5432/khatario"
    echo ""
    read -p "Press enter to continue anyway..."
fi

echo "Running migrations..."
echo ""

# Run the migration script
node scripts/run_gst_migrations.js

echo ""
echo "========================================"
echo "Migration process completed"
echo "========================================"

