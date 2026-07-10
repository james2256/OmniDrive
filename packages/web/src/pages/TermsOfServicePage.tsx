import { PublicPageLayout } from '../components/legal/PublicPageLayout';

export function TermsOfServicePage() {
  const effectiveDate = 'July 4, 2026';

  return (
    <PublicPageLayout title="Terms of Service">
      <p className="text-sm text-stone-600">Effective date: {effectiveDate}</p>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">1. Acceptance of Terms</h2>
        <p>
          By accessing or using OmniDrive at{' '}
          <a href="https://omnidrive-7w1.pages.dev" className="text-primary hover:underline">
            omnidrive-7w1.pages.dev
          </a>
          , you agree to these Terms of Service (&quot;Terms&quot;). If you do not agree, do not use
          the Service.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">2. Description of Service</h2>
        <p>
          OmniDrive is a cloud-hosted application that lets you connect multiple Google Drive
          accounts, manage files through a unified interface, create team workspaces, generate
          shared links, configure automation rules, and optionally access files via an
          S3-compatible API.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">3. Account Registration</h2>
        <p>
          You must provide accurate registration information and keep your credentials secure.
          You are responsible for all activity under your account. Registration may require an
          invitation code at the administrator&apos;s discretion.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">4. Google Drive Connection</h2>
        <p>
          Connecting a Google Drive account requires you to authorize OmniDrive via Google OAuth.
          You grant OmniDrive permission to access your Google Drive data only to the extent of the
          scopes you approve. You may revoke this access at any time through Google Account
          settings or by disconnecting the drive in OmniDrive Settings.
        </p>
        <p>
          You represent that you have the right to connect each Google Drive account you link and
          that your use complies with{' '}
          <a
            href="https://policies.google.com/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Google&apos;s Terms of Service
          </a>
          .
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">5. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Use the Service for unlawful purposes or to store/distribute illegal content</li>
          <li>Attempt to gain unauthorized access to other users&apos; accounts or data</li>
          <li>Interfere with or disrupt the Service or its infrastructure</li>
          <li>Circumvent rate limits, authentication, or access controls</li>
          <li>Use the Service to send spam or malware</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">6. Your Content</h2>
        <p>
          You retain ownership of files stored in your connected Google Drive accounts. OmniDrive
          stores file metadata and encrypted OAuth tokens to provide the Service but does not claim
          ownership of your files. You are solely responsible for the content you manage through
          the Service.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">7. Service Availability</h2>
        <p>
          OmniDrive is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We do
          not guarantee uninterrupted or error-free operation. Scheduled maintenance, third-party
          outages (including Google APIs or Cloudflare), or force majeure may affect availability.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, OmniDrive and its operators shall not be liable
          for any indirect, incidental, special, consequential, or punitive damages, or any loss
          of data, profits, or goodwill, arising from your use of the Service.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">9. Termination</h2>
        <p>
          We may suspend or terminate your access if you violate these Terms or if required for
          security or legal reasons. You may stop using the Service at any time and request account
          deletion by contacting support.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">10. Changes to Terms</h2>
        <p>
          We may modify these Terms at any time. Continued use of the Service after changes are
          posted constitutes acceptance of the revised Terms.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">11. Contact</h2>
        <p>
          Questions about these Terms:{' '}
          <a href="mailto:admin@example.com" className="text-primary hover:underline">
            admin@example.com
          </a>
          .
        </p>
      </section>
    </PublicPageLayout>
  );
}