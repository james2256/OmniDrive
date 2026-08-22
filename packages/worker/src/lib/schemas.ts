import { z } from 'zod';
import type { Context } from 'hono';
import { validateWebhookUrl } from './validation';

/**
 * Shared error hook for zValidator. Formats Zod errors as {error: string}
 * to match the existing API contract consumed by api.ts:42-45.
 *
 * Multiple issues are joined with "; " so the client receives a single readable
 * message rather than Zod's default JSON-path structure.
 *
 * Returns void on success — zValidator then invokes the route handler.
 */
interface ZodErrorLike {
  issues: { message: string }[];
}

export function zodErrorHook(
  result: { success: true } | { success: false; error: ZodErrorLike },
  c: Context,
): Response | void {
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join('; ');
    return c.json({ error: message }, 400 as const);
  }
}

// ─── Auth schemas (auth.ts: 3 routes) ───

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
  .refine((v) => /[0-9]/.test(v), 'Password must contain a number');

export const registerSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: passwordSchema,
  name: z.string().optional(),
  email: z.string().email('Invalid email format').optional(),
  invitation_code: z.string().optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

// ─── Shared link schemas (shared.ts: 4 routes) ───

export const expiresAtSchema = z
  .string()
  .datetime('Invalid expiry format')
  .refine((val) => new Date(val) > new Date(), 'Expiry must be in the future')
  .optional();

const webhookUrlSchema = z
  .string()
  .url('Invalid webhook URL')
  .superRefine((url, ctx) => {
    const err = validateWebhookUrl(url);
    if (err) {
      ctx.addIssue({ code: 'custom', message: err });
    }
  })
  .nullable()
  .optional();

export const createSharedLinkSchema = z.object({
  targetType: z.enum(['file', 'folder']),
  targetId: z.string().min(1, 'targetId is required'),
  password: z.string().optional(),
  expiresAt: expiresAtSchema,
  allowDownloads: z.boolean().default(true),
  maxDownloads: z.number().int().positive().nullable().optional(),
  webhookUrl: webhookUrlSchema,
});

export const updateSharedLinkSchema = z.object({
  password: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  allowDownloads: z.boolean().optional(),
  maxDownloads: z.number().int().positive().nullable().optional(),
  webhookUrl: webhookUrlSchema,
});

export const sharedLinkVerifySchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

// ─── File schemas (files.ts: 6 routes) ───

export const renameFileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
});

export const moveFileSchema = z.object({
  workspaceFolderId: z.string().nullable().optional(),
});

export const moveDriveFileSchema = z.object({
  targetDriveId: z.string().min(1, 'Target drive ID must be a non-empty string'),
});

export const moveWithinDriveSchema = z.object({
  targetFolderId: z.string().min(1, 'Target folder ID is required'),
  oldParentId: z.string().nullable().optional(),
  isFolder: z.boolean(),
});

export const uploadInitSchema = z.object({
  name: z.string().min(1, 'File name is required'),
  mimeType: z.string().min(1, 'MIME type is required'),
  size: z.number().int().nonnegative(),
  parentFolderId: z.string().nullable().optional(),
  workspaceId: z.string().optional(),
  driveAccountId: z.string().optional(),
});

export const uploadFinalizeSchema = z.object({
  googleFileId: z.string().min(1, 'googleFileId is required'),
  driveAccountId: z.string().min(1, 'driveAccountId is required'),
  parentFolderId: z.string().nullable().optional(),
  workspaceFolderId: z.string().nullable().optional(),
  workspaceId: z.string().optional(),
});

export const fileMetadataSchema = z.object({
  metadata: z.record(z.string(), z.string()),
});

// ─── Folder schemas (folders.ts: 3 routes) ───

export const createFolderSchema = z.object({
  name: z.string().min(1, 'Folder name is required').max(255, 'Name too long'),
  parentId: z.string().nullable().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

export const updateFolderSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentId: z.string().nullable().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

export const addFilesToFolderSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1),
});

// ─── Drive schemas (drives.ts: 4 routes) ───

export const createDriveFolderSchema = z.object({
  name: z.string().min(1, 'Folder name is required').max(255, 'Name too long'),
  parentId: z.string().optional(),
});

/**
 * A single folder-path segment: non-empty, no path separators, no traversal.
 * Used by ensureDriveFolderSchema and ensureDriveFoldersBatchSchema.
 */
const folderPathSegment = z
  .string()
  .min(1, 'Folder name is required')
  .max(255, 'Folder name too long')
  .refine(
    (s) => !s.includes('/') && !s.includes('\\'),
    'Path separators not allowed in folder name',
  )
  .refine((s) => s !== '.' && s !== '..', 'Traversal segments are not allowed');

/**
 * A slash-separated folder path (e.g. "projects/src/utils"). Each segment must
 * be a valid folder name. Rejects "..", absolute paths, backslashes, and empty
 * segments. Used by folder upload — the web client sends webkitRelativePath
 * directory portions, which are always sanitized by the browser.
 */
const folderPathSchema = z
  .string()
  .min(1, 'Path is required')
  .max(2048, 'Path too long')
  .refine((p) => !p.startsWith('/') && !p.startsWith('\\'), 'Absolute paths are not allowed')
  .refine((p) => !p.includes('\\'), 'Backslash separators are not allowed')
  .refine(
    (p) => p.split('/').every((seg) => folderPathSegment.safeParse(seg).success),
    'Path contains invalid segments',
  );

/**
 * Ensure a nested folder path exists (creating as needed). Used by folder upload
 * — the web client sends `projects/src/utils` and the worker walks each segment,
 * creating real Google Drive folders. Returns the leaf folder's Google ID so
 * the caller can use it as `parentFolderId` for files inside that path.
 */
export const ensureDriveFolderSchema = z.object({
  path: folderPathSchema,
  parentFolderId: z.string().nullable().optional(),
});

/**
 * Batch-ensure multiple folder paths in a single request. Used by folder upload
 * (drag-drop + picker) to avoid N+1 HTTP round-trips. Schema allows up to 1000
 * paths — the subrequest cap is enforced server-side at execution time, not
 * schema time, because the cap depends on how many folders already exist vs.
 * need creation.
 */
export const ensureDriveFoldersBatchSchema = z.object({
  paths: z
    .array(folderPathSchema)
    .min(1, 'At least one path is required')
    .max(1000, 'Too many paths'),
  parentFolderId: z.string().nullable().optional(),
});

export const renameDriveFolderSchema = z.object({
  name: z.string().min(1, 'Folder name is required').max(255, 'Name too long'),
});

export const serviceAccountSchema = z.object({
  credentials: z.string().min(1, 'Service account JSON is required'),
  folderId: z.string().min(1, 'Shared folder ID is required'),
});

// ─── Workspace schemas (workspaces.ts: 4 routes) ───

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, 'Workspace name is required').max(255, 'Name too long'),
});

// ponytail: extract @omnidrive/shared-types workspace when a 3rd type drifts
// between FE/BE or a 2nd consumer (CLI, mobile) appears. Until then, keep
// shared role definitions here and import via relative path.
export const WORKSPACE_ROLES = [
  'viewer',
  'commenter',
  'editor',
  'manager',
  'auditor',
  'owner',
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

// Roles assignable via the add-member API. 'owner' is excluded — it is
// assigned only at workspace creation (direct DB insert at routes/workspaces.ts),
// never via this API, to prevent privilege escalation. The `satisfies` clause
// enforces at compile time that every assignable role is a valid WorkspaceRole,
// so this list cannot drift from WORKSPACE_ROLES.
const ASSIGNABLE_WORKSPACE_ROLES = [
  'viewer',
  'commenter',
  'editor',
  'manager',
  'auditor',
] as const satisfies readonly WorkspaceRole[];

export const workspaceRoleSchema = z.enum(ASSIGNABLE_WORKSPACE_ROLES);

export const addWorkspaceMemberSchema = z.object({
  email: z.string().email('Invalid email format'),
  role: workspaceRoleSchema.default('viewer'),
});

export const workspacePolicySchema = z
  .object({
    targetType: z.enum(['workspace', 'folder']),
    targetId: z.string().optional(),
    policyType: z.enum(['storage_quota', 'data_retention']),
    config: z.record(z.string(), z.unknown()),
  })
  .refine(
    (data) => !(data.policyType === 'storage_quota' && data.targetType !== 'workspace'),
    'storage_quota must target a workspace',
  )
  .refine(
    (data) => !(data.policyType === 'storage_quota' && typeof data.config.max_bytes !== 'number'),
    'config.max_bytes must be a number for storage_quota',
  )
  .refine(
    (data) =>
      !(
        data.policyType === 'storage_quota' &&
        typeof data.config.max_bytes === 'number' &&
        (data.config.max_bytes < 0 || Number.isNaN(data.config.max_bytes))
      ),
    'config.max_bytes must be non-negative',
  );

export const updateWorkspaceMetadataSchema = z.object({
  metadata: z.record(z.string(), z.string()),
});

// ─── Automation schemas (automations.ts: 2 routes) ───

export const createAutomationSchema = z.object({
  name: z.string().min(1, 'name is required'),
  triggerType: z.enum(['event', 'cron'], {
    message: 'triggerType must be "event" or "cron"',
  }),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  conditions: z.array(z.record(z.string(), z.unknown())).optional(),
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
});

// PUT = full replace → same validation as POST. Differs from
// updateSharedLinkSchema (partial/PATCH) because a rule definition is a
// cohesive unit — partial updates make little semantic sense. Use
// PATCH /:id/toggle for activation state changes.
export const updateAutomationSchema = createAutomationSchema;

export const toggleAutomationSchema = z.object({
  isActive: z.boolean(),
});

// ─── Admin schemas (admin.ts: 2 routes) ───

export const createInvitationSchema = z.object({
  code: z.string().min(12, 'Invitation code must be at least 12 characters').optional(),
  max_uses: z.number().int().min(0).default(1),
});

export const adminCreateUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: passwordSchema,
  name: z.string().optional(),
  email: z.string().email('Invalid email format').optional(),
  role: z.enum(['member', 'super_admin']).default('member'),
});

export const adminUpdateRoleSchema = z.object({
  role: z.enum(['super_admin', 'member']),
});

export const adminUpdateStatusSchema = z.object({
  status: z.enum(['active', 'blocked']),
});

// ─── S3 credentials schema (s3-credentials.ts: 1 route) ───

export const createS3CredentialsSchema = z.object({
  description: z.string().max(500, 'Description too long').optional(),
  workspaceId: z.string().optional(),
});
