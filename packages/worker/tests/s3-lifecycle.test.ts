import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseLifecycleXml, serializeLifecycleXml, cleanupOrphanMultipartUploads } from '../src/services/s3-lifecycle';
import { GoogleDriveService } from '../src/services/google-drive';

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

describe('cleanupOrphanMultipartUploads', () => {
  afterEach(() => vi.restoreAllMocks());

  // Two uploads exist: OLD (created >24h ago) and RECENT (created just now).
  // The real cron filters by `created_at < datetime('now','-1 day')`, which
  // SQLite evaluates. Here we mock DB, so the SELECT returns only the OLD row
  // (the row the WHERE clause would match) and we assert the cleanup reaps it
  // and never touches the RECENT one.
  const OLD = { upload_id: 'up-old', drive_account_id: 'drive-1', temp_folder_id: 'folder-old' };
  const RECENT = { upload_id: 'up-recent', drive_account_id: 'drive-1', temp_folder_id: 'folder-recent' };

  function makeEnv(orphans: typeof OLD[]) {
    const deletes: string[] = [];
    const selects: string[] = [];
    const DB = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          run: async () => {
            if (sql.includes('DELETE FROM s3_multipart_uploads')) deletes.push(args[0]);
            return { success: true };
          },
        }),
        all: async () => {
          if (sql.includes('FROM s3_multipart_uploads')) {
            selects.push(sql);
            return { results: orphans };
          }
          return { results: [] };
        },
      }),
    };
    const env = {
      DB,
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      TOKEN_ENCRYPTION_KEY: 'key',
    } as any;
    return { env, deletes, selects };
  }

  it('deletes the temp folder and DB row of the aged upload, and only that one', async () => {
    const deleteSpy = vi.spyOn(GoogleDriveService.prototype, 'deleteFile').mockResolvedValue(undefined);
    const { env, deletes } = makeEnv([OLD]);

    await cleanupOrphanMultipartUploads(env);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(OLD.drive_account_id, OLD.temp_folder_id);
    expect(deleteSpy).not.toHaveBeenCalledWith(RECENT.drive_account_id, RECENT.temp_folder_id);
    expect(deletes).toEqual([OLD.upload_id]);
  });

  it('filters on created_at with datetime(\'now\',\'-1 day\'), not epoch ms', async () => {
    vi.spyOn(GoogleDriveService.prototype, 'deleteFile').mockResolvedValue(undefined);
    const { env, selects } = makeEnv([OLD]);

    await cleanupOrphanMultipartUploads(env);

    expect(selects[0]).toContain("datetime('now','-1 day')");
    expect(selects[0]).not.toMatch(/\?/); // no bound epoch param
  });

  it('does nothing when there are no aged uploads', async () => {
    const deleteSpy = vi.spyOn(GoogleDriveService.prototype, 'deleteFile').mockResolvedValue(undefined);
    const { env, deletes } = makeEnv([]);

    await cleanupOrphanMultipartUploads(env);

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(deletes).toEqual([]);
  });

  it('still drops the DB row when Drive folder delete fails (best-effort)', async () => {
    vi.spyOn(GoogleDriveService.prototype, 'deleteFile').mockRejectedValue(new Error('folder gone'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { env, deletes } = makeEnv([OLD]);

    await cleanupOrphanMultipartUploads(env);

    expect(deletes).toEqual([OLD.upload_id]);
    errSpy.mockRestore();
  });
});
