import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { presentOperation, validateOperationDisplay, type OperationDisplay } from '../../src/index.js';
const cases = JSON.parse(readFileSync(new URL('../../../../conformance/plugin-presentation/cases.json', import.meta.url), 'utf8'));
describe('shared plugin presentation conformance', () => {
  for (const fixture of cases) it(fixture.name, () => {
    const operation = { executionPayloadSchema: fixture.schema, display: fixture.display };
    const errors = validateOperationDisplay('test', operation).filter(d => d.severity === 'error');
    if (fixture.error) { expect(errors.map(d => d.code)).toContain(fixture.error); return; }
    expect(errors).toEqual([]);
    const result = presentOperation('test', operation, fixture.payload);
    expect(result).toMatchObject(fixture.expected);
    if (fixture.omitsSummary) expect(result.interpolatedTitle).toBeUndefined();
  });
  it('rejects unsafe numbers throughout nested and generic views', () => {
    for (const display of [undefined, { title: 'Test', fields: [{ path: '/args' }] }]) {
      expect(() => presentOperation('test', { executionPayloadSchema: {}, display }, { args: { number: 9007199254740992 } })).toThrow(/exact/);
    }
  });
  it('enforces field, enum and link text limits and bounds summaries', () => {
    const display: OperationDisplay = { title: 'Test', fields: [{ path: '/x', title: 'x'.repeat(2049), description: 'x'.repeat(8193) }], links: [{ title: 'x'.repeat(2049), urlTemplate: 'https://example.com/' }] };
    expect(validateOperationDisplay('test', { executionPayloadSchema: {}, display }).filter(d => d.severity === 'error')).toHaveLength(3);
    display.fields = [{ path: '/x' }]; display.links = []; display.interpolatedTitle = 'Value {/x}';
    expect(presentOperation('test', { executionPayloadSchema: {}, display }, { x: 'x'.repeat(3000) }).interpolatedTitle).toBeUndefined();
  });
});
