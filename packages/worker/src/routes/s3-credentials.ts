import { Hono } from 'hono';
import { authGuard } from '../middleware/auth-guard';
import { generateId } from '../lib/id';
import { encrypt } from '../lib/crypto';
import { assertWorkspaceRole } from '../lib/rbac';
import { zValidator } from '@hono/zod-validator';
import { createS3CredentialsSchema, zodErrorHook } from '../lib/schemas';
import type { AppContext } from '../types/context';
import { mapS3CredentialRow } from '../types/db';

export const s3CredentialsRouter = new Hono<AppContext>();

s3CredentialsRouter.use('*', authGuard);

s3CredentialsRouter.post(
  '/',
  zValidator('json', createS3CredentialsSchema, zodErrorHook),
  async (c) => {
    const userId = c.get('userId');
    const { description, workspaceId } = c.req.valid('json');

    // Workspace manager RBAC check
    if (workspaceId) {
      await assertWorkspaceRole(
        c.env.DB,
        workspaceId,
        userId,
        'manager',
        'Unauthorized to manage S3 keys for this workspace',
      );
    }

    // Key generation + encryption (stays in route — needs TOKEN_ENCRYPTION_KEY)
    const id = generateId();
    const accessKeyId = 'OMNI' + generateId().substring(0, 16).toUpperCase();
    const rawSecretKey = generateId() + generateId();
    const secretKeyEnc = await encrypt(rawSecretKey, c.env.TOKEN_ENCRYPTION_KEY);

    await c.get('s3CredentialsRepo').insert({
      id,
      userId,
      accessKeyId,
      secretKeyEnc,
      description: description || null,
      workspaceId: workspaceId || null,
    });

    return c.json(
      {
        id,
        accessKeyId,
        secretAccessKey: rawSecretKey,
        description,
        workspaceId: workspaceId || null,
        createdAt: new Date().toISOString(),
        warning: 'Store this secret now — it will not be shown again.',
      },
      201,
    );
  },
);

s3CredentialsRouter.get('/', async (c) => {
  const { results } = await c.get('s3CredentialsRepo').findAllByUser(c.get('userId'));
  return c.json(results.map((r: Record<string, unknown>) => mapS3CredentialRow(r)));
});

s3CredentialsRouter.delete('/:id', async (c) => {
  await c.get('s3CredentialsRepo').delete(c.req.param('id'), c.get('userId'));
  return c.body(null, 204);
});
