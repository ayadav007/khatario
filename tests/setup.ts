/**
 * Jest Test Setup
 * 
 * Global test configuration and mocks
 */

// Mock environment variables
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db';
process.env.NODE_ENV = 'test';

// Increase timeout for async operations
jest.setTimeout(10000);

// Global test utilities
global.console = {
  ...console,
  // Suppress console.log in tests (uncomment if needed)
  // log: jest.fn(),
  // error: jest.fn(),
  // warn: jest.fn(),
};
