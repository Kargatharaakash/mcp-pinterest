import { describe, expect, test } from '@jest/globals';

describe('Basic Test Suite', () => {
  test('should pass simple truthy test', () => {
    expect(1 + 1).toBe(2);
  });
});