import { AcceptInviteForm } from "@/components/accept-invite-form";

export default function AcceptInvitePage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <div>
          <img className="login-logo" src="/brand/stem-intelligence-logo-cropped.png" alt="Stem Intelligence" />
          <p className="eyebrow">Account invitation</p>
          <h1>Finish setting up your account</h1>
          <p className="muted">Choose a password to activate your Stem Intelligence login.</p>
        </div>
        <AcceptInviteForm />
      </section>
    </main>
  );
}
