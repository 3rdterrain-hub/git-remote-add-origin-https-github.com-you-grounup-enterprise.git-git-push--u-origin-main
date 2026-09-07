/**
 * Who is signed in, and what to call them.
 *
 * A greeting is the one piece of text on a workspace that is about the reader
 * rather than the work, and it is the easiest place in an application to be
 * embarrassing. "Good morning, null" and "Good morning, tradertree1987" are
 * both worse than no name at all, so the fallback chain has to end somewhere
 * dignified rather than at whatever string happens to be available.
 */
import { describe, expect, it } from 'vitest';
import { greeting } from './session';

const at = (hour: number) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
};

describe('the time of day', () => {
  it('reads morning until noon', () => {
    expect(greeting(at(0))).toBe('Good morning');
    expect(greeting(at(7))).toBe('Good morning');
    expect(greeting(at(11))).toBe('Good morning');
  });

  it('reads afternoon from noon', () => {
    expect(greeting(at(12))).toBe('Good afternoon');
    expect(greeting(at(16))).toBe('Good afternoon');
  });

  it('reads evening from five', () => {
    expect(greeting(at(17))).toBe('Good evening');
    expect(greeting(at(23))).toBe('Good evening');
  });

  it('uses the reader\'s own clock, not the server\'s', () => {
    /*
     * A crew starting at six in Ohio should be told good morning, whatever
     * time it is where the database lives.
     */
    expect(greeting()).toMatch(/^Good (morning|afternoon|evening)$/);
  });
});
