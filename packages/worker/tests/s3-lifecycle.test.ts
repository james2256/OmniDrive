import { describe, it, expect } from 'vitest';
import { parseLifecycleXml, serializeLifecycleXml } from '../src/services/s3-lifecycle';

describe('parseLifecycleXml', () => {
  it('parses a standard PutBucketLifecycleConfiguration', () => {
    const xml = `<?xml version="1.0"?>
<LifecycleConfiguration>
  <Rule>
    <ID>r1</ID>
    <Filter><Prefix>logs/</Prefix></Filter>
    <Status>Enabled</Status>
    <Expiration><Days>30</Days></Expiration>
  </Rule>
</LifecycleConfiguration>`;
    const rules = parseLifecycleXml(xml);
    expect(rules).toEqual([{ prefix: 'logs/', days: 30, enabled: true }]);
  });

  it('honors Disabled status and empty prefix', () => {
    const xml = `<Rule><Status>Disabled</Status><Expiration><Days>7</Days></Expiration></Rule>`;
    expect(parseLifecycleXml(xml)).toEqual([{ prefix: '', days: 7, enabled: false }]);
  });

  it('ignores rules without Days or with invalid Days', () => {
    const xml = `<Rule><Prefix>a/</Prefix></Rule><Rule><Prefix>b/</Prefix><Expiration><Days>0</Days></Expiration></Rule>`;
    expect(parseLifecycleXml(xml)).toEqual([]);
  });

  it('round-trips through serialize', () => {
    const rules = [{ prefix: 'tmp/', days: 14, enabled: true }];
    expect(parseLifecycleXml(serializeLifecycleXml(rules))).toEqual(rules);
  });
});
