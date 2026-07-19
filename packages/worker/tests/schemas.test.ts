import { describe, it, expect } from 'vitest';
import {
  passwordSchema,
  registerSchema,
  loginSchema,
  changePasswordSchema,
  expiresAtSchema,
  createSharedLinkSchema,
  sharedLinkVerifySchema,
  sharedLinkEmailSchema,
  renameFileSchema,
  moveWithinDriveSchema,
  uploadInitSchema,
  fileMetadataSchema,
  createFolderSchema,
  addFilesToFolderSchema,
  createDriveFolderSchema,
  serviceAccountSchema,
  createWorkspaceSchema,
  addWorkspaceMemberSchema,
  workspacePolicySchema,
  createAutomationSchema,
  toggleAutomationSchema,
  createInvitationSchema,
  adminCreateUserSchema,
  createS3CredentialsSchema,
} from '../src/lib/schemas';

describe('passwordSchema', () => {
  it('rejects passwords shorter than 8 characters', () => {
    expect(passwordSchema.safeParse('Abc1').success).toBe(false);
  });
  it('rejects passwords without uppercase', () => {
    expect(passwordSchema.safeParse('abcdefg1').success).toBe(false);
  });
  it('rejects passwords without lowercase', () => {
    expect(passwordSchema.safeParse('ABCDEFG1').success).toBe(false);
  });
  it('rejects passwords without number', () => {
    expect(passwordSchema.safeParse('Abcdefgh').success).toBe(false);
  });
  it('accepts valid passwords', () => {
    expect(passwordSchema.safeParse('Abcdefg1').success).toBe(true);
  });
});

describe('expiresAtSchema (past-date gap fix)', () => {
  it('rejects past dates', () => {
    const result = expiresAtSchema.safeParse('2020-01-01T00:00:00.000Z');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Expiry must be in the future');
    }
  });
  it('accepts future dates', () => {
    expect(expiresAtSchema.safeParse('2099-01-01T00:00:00.000Z').success).toBe(true);
  });
  it('accepts undefined (optional)', () => {
    expect(expiresAtSchema.safeParse(undefined).success).toBe(true);
  });
  it('rejects non-ISO strings', () => {
    expect(expiresAtSchema.safeParse('not-a-date').success).toBe(false);
  });
});

describe('createSharedLinkSchema', () => {
  it('rejects missing targetType', () => {
    const result = createSharedLinkSchema.safeParse({ targetId: 'abc' });
    expect(result.success).toBe(false);
  });
  it('rejects invalid targetType', () => {
    const result = createSharedLinkSchema.safeParse({ targetType: 'image', targetId: 'abc' });
    expect(result.success).toBe(false);
  });
  it('rejects past expiresAt', () => {
    const result = createSharedLinkSchema.safeParse({
      targetType: 'file',
      targetId: 'abc',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
  it('accepts valid input with future expiresAt', () => {
    const result = createSharedLinkSchema.safeParse({
      targetType: 'file',
      targetId: 'abc',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
  it('applies defaults for optional booleans', () => {
    const result = createSharedLinkSchema.safeParse({
      targetType: 'folder',
      targetId: 'xyz',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowDownloads).toBe(true);
      expect(result.data.allowUploads).toBe(false);
      expect(result.data.requireEmail).toBe(false);
    }
  });
  it('rejects private-IP webhookUrl', () => {
    const result = createSharedLinkSchema.safeParse({
      targetType: 'file',
      targetId: 'abc',
      webhookUrl: 'https://192.168.1.1/hook',
    });
    expect(result.success).toBe(false);
  });
});

describe('sharedLinkVerifySchema', () => {
  it('requires password', () => {
    expect(sharedLinkVerifySchema.safeParse({}).success).toBe(false);
  });
  it('accepts non-empty password', () => {
    expect(sharedLinkVerifySchema.safeParse({ password: 'secret' }).success).toBe(true);
  });
});

describe('sharedLinkEmailSchema', () => {
  it('requires valid email', () => {
    expect(sharedLinkEmailSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
  it('accepts valid email', () => {
    expect(sharedLinkEmailSchema.safeParse({ email: 'bob@example.com' }).success).toBe(true);
  });
});

describe('moveWithinDriveSchema (isFolder gap fix)', () => {
  it('rejects non-boolean isFolder', () => {
    const result = moveWithinDriveSchema.safeParse({
      targetFolderId: 'abc',
      isFolder: 'yes',
    });
    expect(result.success).toBe(false);
  });
  it('accepts boolean isFolder', () => {
    expect(
      moveWithinDriveSchema.safeParse({
        targetFolderId: 'abc',
        isFolder: true,
      }).success,
    ).toBe(true);
  });
  it('requires targetFolderId', () => {
    expect(
      moveWithinDriveSchema.safeParse({
        targetFolderId: '',
        isFolder: false,
      }).success,
    ).toBe(false);
  });
});

describe('addWorkspaceMemberSchema (role enum gap fix)', () => {
  it('rejects invalid role', () => {
    const result = addWorkspaceMemberSchema.safeParse({
      email: 'bob@example.com',
      role: 'superadmin',
    });
    expect(result.success).toBe(false);
  });
  it('accepts valid role', () => {
    expect(
      addWorkspaceMemberSchema.safeParse({
        email: 'bob@example.com',
        role: 'viewer',
      }).success,
    ).toBe(true);
  });
  it('defaults role to viewer', () => {
    const result = addWorkspaceMemberSchema.safeParse({ email: 'bob@example.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('viewer');
    }
  });
  it('rejects invalid email', () => {
    expect(
      addWorkspaceMemberSchema.safeParse({
        email: 'not-an-email',
        role: 'viewer',
      }).success,
    ).toBe(false);
  });
  it('rejects owner role (must not be assignable via API)', () => {
    expect(
      addWorkspaceMemberSchema.safeParse({
        email: 'bob@example.com',
        role: 'owner',
      }).success,
    ).toBe(false);
  });
});

describe('workspacePolicySchema', () => {
  it('rejects storage_quota targeting folder', () => {
    const result = workspacePolicySchema.safeParse({
      targetType: 'folder',
      targetId: 'abc',
      policyType: 'storage_quota',
      config: { max_bytes: 1000 },
    });
    expect(result.success).toBe(false);
  });
  it('rejects storage_quota without max_bytes', () => {
    const result = workspacePolicySchema.safeParse({
      targetType: 'workspace',
      policyType: 'storage_quota',
      config: {},
    });
    expect(result.success).toBe(false);
  });
  it('rejects negative max_bytes', () => {
    const result = workspacePolicySchema.safeParse({
      targetType: 'workspace',
      policyType: 'storage_quota',
      config: { max_bytes: -1 },
    });
    expect(result.success).toBe(false);
  });
  it('accepts valid storage_quota', () => {
    expect(
      workspacePolicySchema.safeParse({
        targetType: 'workspace',
        policyType: 'storage_quota',
        config: { max_bytes: 1000000 },
      }).success,
    ).toBe(true);
  });
});

describe('createAutomationSchema', () => {
  it('rejects invalid trigger_type', () => {
    const result = createAutomationSchema.safeParse({
      name: 'Test',
      trigger_type: 'webhook',
    });
    expect(result.success).toBe(false);
  });
  it('accepts event trigger_type', () => {
    expect(
      createAutomationSchema.safeParse({
        name: 'Test',
        trigger_type: 'event',
      }).success,
    ).toBe(true);
  });
  it('accepts cron trigger_type', () => {
    expect(
      createAutomationSchema.safeParse({
        name: 'Test',
        trigger_type: 'cron',
      }).success,
    ).toBe(true);
  });
  it('requires name', () => {
    expect(
      createAutomationSchema.safeParse({
        trigger_type: 'event',
      }).success,
    ).toBe(false);
  });
});

describe('toggleAutomationSchema', () => {
  it('rejects non-boolean is_active', () => {
    expect(toggleAutomationSchema.safeParse({ is_active: 'true' }).success).toBe(false);
  });
  it('accepts boolean is_active', () => {
    expect(toggleAutomationSchema.safeParse({ is_active: true }).success).toBe(true);
  });
});

describe('createInvitationSchema (corrected with code field)', () => {
  it('accepts missing code (server generates)', () => {
    expect(createInvitationSchema.safeParse({}).success).toBe(true);
  });
  it('rejects short custom code (< 12 chars)', () => {
    const result = createInvitationSchema.safeParse({ code: 'short' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('at least 12 characters');
    }
  });
  it('accepts long custom code (>= 12 chars)', () => {
    expect(
      createInvitationSchema.safeParse({ code: 'longenoughcode123' }).success,
    ).toBe(true);
  });
  it('defaults max_uses to 1', () => {
    const result = createInvitationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_uses).toBe(1);
    }
  });
  it('has no expires_at field (route does not read it)', () => {
    const result = createInvitationSchema.safeParse({
      expires_at: '2099-01-01T00:00:00.000Z',
    });
    // Zod strips unknown keys by default — expires_at is silently dropped
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).expires_at).toBeUndefined();
    }
  });
});

describe('adminCreateUserSchema', () => {
  it('rejects weak password', () => {
    expect(
      adminCreateUserSchema.safeParse({
        username: 'bob',
        password: 'weak',
      }).success,
    ).toBe(false);
  });
  it('rejects invalid role', () => {
    expect(
      adminCreateUserSchema.safeParse({
        username: 'bob',
        password: 'Abcdefg1',
        role: 'god',
      }).success,
    ).toBe(false);
  });
  it('defaults role to member', () => {
    const result = adminCreateUserSchema.safeParse({
      username: 'bob',
      password: 'Abcdefg1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('member');
    }
  });
});

describe('auth schemas', () => {
  it('loginSchema requires both fields', () => {
    expect(loginSchema.safeParse({ username: 'bob' }).success).toBe(false);
    expect(loginSchema.safeParse({ username: 'bob', password: 'x' }).success).toBe(true);
  });
  it('registerSchema validates email format', () => {
    expect(
      registerSchema.safeParse({
        username: 'bob',
        password: 'Abcdefg1',
        email: 'not-an-email',
      }).success,
    ).toBe(false);
  });
  it('changePasswordSchema requires currentPassword', () => {
    expect(
      changePasswordSchema.safeParse({ newPassword: 'Abcdefg1' }).success,
    ).toBe(false);
  });
});

describe('file schemas', () => {
  it('renameFileSchema requires name', () => {
    expect(renameFileSchema.safeParse({}).success).toBe(false);
  });
  it('uploadInitSchema requires name, mimeType, size', () => {
    expect(
      uploadInitSchema.safeParse({ name: 'a', mimeType: 'text/plain', size: -1 }).success,
    ).toBe(false);
    expect(
      uploadInitSchema.safeParse({ name: 'a', mimeType: 'text/plain', size: 10 }).success,
    ).toBe(true);
  });
  it('fileMetadataSchema accepts string record', () => {
    expect(
      fileMetadataSchema.safeParse({ metadata: { key: 'value' } }).success,
    ).toBe(true);
  });
});

describe('folder schemas', () => {
  it('createFolderSchema requires name', () => {
    expect(createFolderSchema.safeParse({}).success).toBe(false);
  });
  it('addFilesToFolderSchema requires non-empty fileIds', () => {
    expect(addFilesToFolderSchema.safeParse({ fileIds: [] }).success).toBe(false);
    expect(
      addFilesToFolderSchema.safeParse({ fileIds: ['abc'] }).success,
    ).toBe(true);
  });
});

describe('drive schemas', () => {
  it('createDriveFolderSchema requires name', () => {
    expect(createDriveFolderSchema.safeParse({}).success).toBe(false);
  });
  it('serviceAccountSchema requires credentials + folderId', () => {
    expect(serviceAccountSchema.safeParse({ credentials: 'x' }).success).toBe(false);
    expect(
      serviceAccountSchema.safeParse({ credentials: 'x', folderId: 'y' }).success,
    ).toBe(true);
  });
});

describe('workspace schemas', () => {
  it('createWorkspaceSchema requires name', () => {
    expect(createWorkspaceSchema.safeParse({}).success).toBe(false);
  });
});

describe('s3 credentials schema', () => {
  it('accepts empty object (all fields optional)', () => {
    expect(createS3CredentialsSchema.safeParse({}).success).toBe(true);
  });
  it('accepts description + workspaceId', () => {
    expect(
      createS3CredentialsSchema.safeParse({
        description: 'My key',
        workspaceId: 'ws-123',
      }).success,
    ).toBe(true);
  });
  it('rejects description over 500 chars', () => {
    expect(
      createS3CredentialsSchema.safeParse({ description: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});
