import { PublicPageLayout } from '../components/legal/PublicPageLayout';

export function PrivacyPolicyPage() {
  const effectiveDate = 'July 4, 2026';

  return (
    <PublicPageLayout title="Privacy Policy">
      <p className="text-sm text-stone-600">Effective date: {effectiveDate}</p>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">1. Introduction</h2>
        <p>
          AzaDrive (&quot;we&quot;, &quot;our&quot;, or &quot;the Service&quot;) is a unified
          multi-Google Drive storage gateway operated at{' '}
          <a href="https://azadrive.my.id" className="text-primary hover:underline">
            azadrive.my.id
          </a>
          . This Privacy Policy explains how we collect, use, store, and protect information when
          you use AzaDrive, including data obtained from Google APIs.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">2. Information We Collect</h2>
        <h3 className="font-medium text-stone-900">2.1 Account information</h3>
        <p>
          When you register, we store your username, display name, optional email address, and a
          hashed password for authentication.
        </p>
        <h3 className="font-medium text-stone-900">2.2 Google user data</h3>
        <p>
          When you connect a Google Drive account via OAuth, we access Google user data as permitted
          by the scopes you authorize, including:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Your Google account email address and basic profile information</li>
          <li>Google Drive file metadata (names, sizes, MIME types, folder structure, modification dates)</li>
          <li>Google Drive file content when you upload, download, move, or share files through the Service</li>
          <li>Google Drive storage quota information</li>
        </ul>
        <p>
          We store OAuth refresh and access tokens encrypted at rest (AES-256-GCM) to maintain your
          connected drives. We do not store your Google account password.
        </p>
        <h3 className="font-medium text-stone-900">2.3 Usage data</h3>
        <p>
          We may log technical information such as IP addresses, request timestamps, and error logs
          for security, rate limiting, and service reliability.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">3. How We Use Your Information</h2>
        <p>We use collected information solely to:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Authenticate you and maintain your session</li>
          <li>Connect and sync your Google Drive accounts as you request</li>
          <li>Display, search, upload, download, move, and share files across your connected drives</li>
          <li>Enforce workspace permissions, quotas, and automation rules you configure</li>
          <li>Provide shared links and S3-compatible API access you explicitly enable</li>
          <li>Protect the Service against abuse, fraud, and unauthorized access</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">
          4. Google API Services User Data Policy
        </h2>
        <p>
          AzaDrive&apos;s use and transfer of information received from Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Specifically:
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            We only use Google user data to provide and improve user-facing features of AzaDrive
            that you explicitly use.
          </li>
          <li>We do not sell Google user data.</li>
          <li>
            We do not use Google user data for advertising, creditworthiness assessment, or lending
            purposes.
          </li>
          <li>
            We do not allow humans to read Google user data unless you give affirmative consent for
            a specific case, it is necessary for security purposes, or required by law.
          </li>
          <li>
            We do not transfer Google user data to third parties except as necessary to provide the
            Service (e.g., Cloudflare infrastructure hosting), to comply with law, or as part of a
            merger/acquisition with notice to users.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">5. Data Storage and Security</h2>
        <p>
          Data is stored on Cloudflare&apos;s edge infrastructure (D1 database and KV store).
          OAuth tokens are encrypted before storage. We use HTTPS for all communications, CSRF
          protection on mutating API requests, rate limiting, and PKCE for the OAuth flow.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">6. Data Retention and Deletion</h2>
        <p>
          We retain your account data and synced file metadata while your account is active.
          When you disconnect a Google Drive account, we delete the associated OAuth tokens.
          You may request account deletion by contacting us; we will remove your account data and
          connected drive tokens within a reasonable timeframe.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">7. Your Rights</h2>
        <p>
          You can revoke AzaDrive&apos;s access to your Google account at any time via{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Google Account permissions
          </a>
          . You can also disconnect individual drives from AzaDrive Settings.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">8. Children&apos;s Privacy</h2>
        <p>
          AzaDrive is not directed at children under 13. We do not knowingly collect personal
          information from children.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will post the revised policy on
          this page with an updated effective date.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">10. Contact</h2>
        <p>
          For privacy-related questions or data deletion requests, contact us at{' '}
          <a href="mailto:support@azadrive.my.id" className="text-primary hover:underline">
            support@azadrive.my.id
          </a>
          .
        </p>
      </section>
    </PublicPageLayout>
  );
}