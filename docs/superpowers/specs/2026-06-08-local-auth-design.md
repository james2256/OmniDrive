# Design Spec: Local Authentication (Username/Password) Migration

## Overview
This document outlines the design for migrating the OmniDrive authentication flow from a Google OAuth-only approach to a local username and password approach. Connecting a Google Drive account will become a secondary action that happens after the user has logged in to their local account.

## 1. Database Schema Changes
The `users` table currently relies heavily on Google's provided data. It will be modified to support local authentication.

### Table: `users`
- **Additions**:
  - `username` (TEXT, UNIQUE, NOT NULL): The unique identifier for the user to log in.
  - `password_hash` (TEXT, NOT NULL): Securely hashed password.
- **Modifications (Make Optional)**:
  - `google_id` (TEXT, UNIQUE): Allow NULL.
  - `email` (TEXT, UNIQUE): Allow NULL. Email becomes an optional field during registration.
  - `name` (TEXT): Allow NULL. Default to `username` if not provided.
  - `avatar_url` (TEXT): Allow NULL.

*No changes are required for `drive_accounts` or other tables, as they already support associating a drive account with a `user_id`.*

## 2. Backend API Updates (Cloudflare Worker)
The authentication logic will be split into local authentication and third-party drive connection.

### New Local Auth Endpoints
- `POST /api/auth/register`
  - **Payload**: `username`, `password`, `email` (optional).
  - **Behavior**: Validates input, hashes the password using a Worker-compatible mechanism (e.g., Web Crypto API or `bcryptjs`), and inserts the new user into the `users` table. Automatically creates a session (`omnidrive_sid` cookie) upon successful registration.
- `POST /api/auth/login`
  - **Payload**: `username`, `password`.
  - **Behavior**: Retrieves user by `username`, verifies the password hash, and creates a session (`omnidrive_sid` cookie).

### Google OAuth Flow Changes
- `GET /api/auth/google` & `GET /api/auth/callback`
  - **Behavior Change**: These endpoints will no longer create or log in a user. They will purely act as a mechanism to connect a new Google Drive account to the *currently logged-in* user.
  - **Security**: Must be protected by `authGuard`. If a request is made without a valid `omnidrive_sid` session, it must return a 401 Unauthorized error.

## 3. Frontend Updates (React/Vite)

### Authentication Page (`LoginPage.tsx`)
- Remove the "Sign in with Google" button.
- Implement a form with two modes: "Login" and "Register".
  - **Login Mode**: Requires Username and Password.
  - **Register Mode**: Requires Username, Password, and an optional Email field.
- Add a toggle link/button at the bottom to switch between Login and Register modes.

### Main Dashboard (`FilesPage.tsx` / `DriveFolderBrowser.tsx`)
- **Empty State Implementation**: When a user logs in, the application will check the number of connected `drive_accounts`.
- If the count is 0, display a centered empty state:
  - **Message**: "Anda belum memiliki Google Drive yang terhubung."
  - **Action**: A prominent "Hubungkan Google Drive Sekarang" button that redirects the user to `/api/auth/google`.

### Settings Page (`SettingsPage.tsx`)
- Ensure the user interface clearly separates "Profile" settings (update email, change password) from "Connected Drives" management.
- Provide a clear UI to initiate linking a new Google Drive account.

## Technical Considerations & Error Handling
- **Password Hashing**: Must use a secure, salt-based hashing algorithm compatible with the V8 isolate environment of Cloudflare Workers.
- **Unique Constraints**: Ensure SQLite handles multiple `NULL` values gracefully for the `email` unique constraint (SQLite natively allows multiple NULLs in UNIQUE columns).
- **Session Continuity**: When transitioning from Google login to local login, existing users might lose access if their accounts were tied solely to `google_id`. *Migration strategy for existing users*: Existing users currently log in via Google. Since `google_id` is retained, we can allow a one-time "Set Password" flow if they log in via Google, but for simplicity of this initial spec, we assume standard local login for everyone. If an existing user cannot log in, they will register a new local account and re-connect their Google Drive.

## Testing Strategy
1. **API Level**: Test register, login, and verify that accessing `/api/auth/google` without a session fails.
2. **UI Level**: Verify the empty state shows exactly when 0 drives are connected.
3. **End-to-End**: Test registering a new user -> seeing empty state -> connecting Google Drive -> seeing files load.
