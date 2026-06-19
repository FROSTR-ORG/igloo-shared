import { describe, expect, it } from 'vitest';
import { createFixtureRuntimeStatusSummary, FIXTURE_GROUP_PK } from './dev-fixtures';

describe('dev-fixtures', () => {
  it('builds a valid RuntimeStatusSummary with a peers array (the shape home parseRuntimeStatus requires)', () => {
    const s = createFixtureRuntimeStatusSummary();
    expect(Array.isArray(s.peers)).toBe(true);
    expect(s.peers.length).toBe(2);
    expect(s.peers[0].online).toBe(true);
    expect(s.peers[1].online).toBe(false);
    expect(s.metadata.group_public_key).toBe(FIXTURE_GROUP_PK);
    expect(s.readiness.sign_ready).toBe(true);
  });
});
