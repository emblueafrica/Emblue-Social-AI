import type { Metadata } from "next";
import { Callout, ContactBox, LegalPage, LegalSection, LegalTable, RightsGrid, SuccessCallout } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | Social Emblue AI",
  description: "Privacy Policy for Social Emblue AI by Emblue Africa.",
};

const toc = [
  { id: "controller", label: "Data Controller" },
  { id: "collection", label: "What We Collect" },
  { id: "use", label: "How We Use Data" },
  { id: "processors", label: "Data Processors" },
  { id: "social-data", label: "Social Media Data" },
  { id: "retention", label: "Data Retention" },
  { id: "security", label: "Security" },
  { id: "rights", label: "Your Rights" },
  { id: "transfers", label: "International Transfers" },
  { id: "cookies", label: "Cookies" },
  { id: "children", label: "Children" },
  { id: "ndpr", label: "NDPR Compliance" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      active="privacy"
      title="Privacy Policy"
      subtitle="We are committed to protecting your privacy and handling your data with transparency and care. This policy explains exactly what we collect, why, and how."
      effectiveDate="June 23, 2026"
      lastUpdated="June 23, 2026"
      toc={toc}
    >
      <LegalSection id="controller" number={1} title="Data Controller">
        <p>
          Emblue Africa, operating as Social Emblue AI, is the data controller for the Platform. We determine
          the purposes and means of processing personal data collected through Social Emblue AI.
        </p>
        <Callout>
          Data controller: Emblue Africa, Lagos, Federal Republic of Nigeria. Privacy contact:
          privacy@emblue.africa.
        </Callout>
        <p>
          This includes data from connected social media platforms such as Meta, X, TikTok, and other sources
          you authorize through the Platform.
        </p>
      </LegalSection>

      <LegalSection id="collection" number={2} title="What We Collect">
        <h3 className="font-bold text-slate-950">Account Information</h3>
        <ul className="list-disc space-y-2 pl-6">
          <li>Name and email address.</li>
          <li>Company, brand, and role information.</li>
          <li>Login credentials stored as hashed values, never in plaintext.</li>
        </ul>

        <h3 className="font-bold text-slate-950">Social Media Account Data</h3>
        <ul className="list-disc space-y-2 pl-6">
          <li>Connected account username, profile picture, and platform IDs.</li>
          <li>OAuth access tokens encrypted with AES-256-GCM before storage.</li>
          <li>Account, content, and performance metrics available through approved APIs.</li>
        </ul>

        <h3 className="font-bold text-slate-950">Social Media Content Data</h3>
        <ul className="list-disc space-y-2 pl-6">
          <li>Comments, replies, messages, mentions, and engagement metrics.</li>
          <li>Public conversations matching configured listening keywords.</li>
          <li>Commenter profile information used for audience intelligence and campaign eligibility.</li>
        </ul>

        <h3 className="font-bold text-slate-950">Usage Data</h3>
        <ul className="list-disc space-y-2 pl-6">
          <li>IP address, browser, device, and page activity.</li>
          <li>Actions taken inside the Platform.</li>
          <li>Error logs and security events.</li>
        </ul>

        <SuccessCallout>
          We do not collect social media passwords, payment card details, or sensitive personal data unless it is
          strictly necessary for a requested Platform function.
        </SuccessCallout>
      </LegalSection>

      <LegalSection id="use" number={3} title="How We Use Data">
        <LegalTable
          columns={["Purpose", "Data Used", "Legal Basis"]}
          rows={[
            ["Providing the Platform service", "Account info and connected account data", "Contract performance"],
            ["AI-powered reply generation", "Comment text, DM content, and brand tone settings", "Contract performance"],
            ["Social listening and keyword monitoring", "Public social media posts matching configured keywords", "Legitimate interest"],
            ["Performance reporting", "Engagement metrics and account insights", "Contract performance"],
            ["Audience intelligence", "Public commenter profile data", "Legitimate interest"],
            ["Security and fraud prevention", "Usage logs and IP addresses", "Legitimate interest"],
            ["Service communications", "Email address", "Contract performance"],
            ["Legal compliance", "Information required by law", "Legal obligation"],
          ]}
        />
        <SuccessCallout>
          We never sell your data, use it for third-party advertising, or profile you for purposes outside the
          Platform's core social media management functions.
        </SuccessCallout>
      </LegalSection>

      <LegalSection id="processors" number={4} title="Data Processors">
        <p>We use trusted service providers to operate the Platform. They process data only for our instructions.</p>
        <LegalTable
          columns={["Processor", "Purpose", "Data Processed", "Location"]}
          rows={[
            ["Anthropic, PBC", "AI processing using Claude models", "Comment text, DM content, captions", "United States"],
            ["OpenAI, LLC", "AI processing using GPT models", "Comment text and sentiment classification", "United States"],
            ["Supabase, Inc.", "Database hosting and authentication", "Platform data, user accounts, encrypted tokens", "United States"],
            ["Railway Corp.", "Backend infrastructure hosting", "Application server traffic", "United States"],
            ["Resend, Inc.", "Email delivery", "Email address and report content", "United States"],
            ["Cloudinary Ltd.", "Media storage", "Creative images uploaded by brand clients", "United States / Israel"],
          ]}
        />
      </LegalSection>

      <LegalSection id="social-data" number={5} title="Social Media Platform Data">
        <p>
          Social Emblue AI accesses data from Meta, X Corp, and TikTok through official APIs and OAuth
          authorization. Data from those services is also governed by each platform's own privacy policy and
          developer terms.
        </p>
        <h3 className="font-bold text-slate-950">Meta: Instagram and Facebook</h3>
        <ul className="list-disc space-y-2 pl-6">
          <li>Instagram Business profile information.</li>
          <li>Post comments, replies, and direct messages for connected business accounts.</li>
          <li>Account and post performance insights.</li>
        </ul>
        <h3 className="font-bold text-slate-950">X / Twitter</h3>
        <ul className="list-disc space-y-2 pl-6">
          <li>Public posts matching configured keywords.</li>
          <li>Author username, public profile details, engagement counts, and reply context.</li>
          <li>Replies posted by connected brand accounts.</li>
        </ul>
        <h3 className="font-bold text-slate-950">TikTok</h3>
        <ul className="list-disc space-y-2 pl-6">
          <li>Connected account username and profile information.</li>
          <li>Comment data from connected brand video content when approved API access allows it.</li>
        </ul>
        <Callout>
          Disconnecting a social account deletes its OAuth tokens immediately. Processed engagement data is kept
          only as long as needed for reporting, audit, and campaign history.
        </Callout>
      </LegalSection>

      <LegalSection id="retention" number={6} title="Data Retention">
        <LegalTable
          columns={["Data Type", "Retention Period"]}
          rows={[
            ["Account credentials", "Until account deletion plus 30 days"],
            ["OAuth access tokens", "Until account disconnection; deleted immediately on disconnect"],
            ["Social media engagement data", "12 months from collection"],
            ["Performance reports", "24 months"],
            ["Usage and access logs", "90 days"],
            ["Billing records", "7 years where legally required"],
          ]}
        />
      </LegalSection>

      <LegalSection id="security" number={7} title="Security">
        <ul className="list-disc space-y-2 pl-6">
          <li>OAuth tokens and sensitive credentials are encrypted at rest using AES-256-GCM.</li>
          <li>All production traffic uses HTTPS/TLS.</li>
          <li>Role-based access controls limit access by user role, brand, and tool permissions.</li>
          <li>Authentication uses Supabase Auth with JWT verification.</li>
          <li>Meta webhooks are verified with HMAC-SHA256 signatures where required.</li>
          <li>Production infrastructure is hosted with HTTPS-enabled providers.</li>
        </ul>
        <p>
          No system can be guaranteed completely secure. If a breach affecting your personal data occurs, we will
          notify you and the relevant authorities as required by law.
        </p>
      </LegalSection>

      <LegalSection id="rights" number={8} title="Your Rights">
        <RightsGrid
          items={[
            { title: "Right to Access", body: "Request a copy of the personal data we hold about you." },
            { title: "Right to Rectification", body: "Ask us to correct inaccurate or incomplete data." },
            { title: "Right to Erasure", body: "Ask us to delete your data unless a legal obligation requires retention." },
            { title: "Right to Portability", body: "Receive your data in a structured, machine-readable format." },
            { title: "Right to Object", body: "Object to processing based on legitimate interests." },
            { title: "Right to Restriction", body: "Ask us to restrict processing in certain circumstances." },
          ]}
        />
        <p>
          To exercise your rights, contact privacy@emblue.africa. We aim to respond within 30 days.
        </p>
        <Callout>
          You can withdraw social media authorization at any time by disconnecting the account in Social Emblue AI
          or from the relevant social platform settings.
        </Callout>
      </LegalSection>

      <LegalSection id="transfers" number={9} title="International Transfers">
        <p>
          Social Emblue AI is operated from Nigeria. Some service providers, including Anthropic, OpenAI,
          Supabase, Railway, and Resend, may process data in the United States or other countries.
        </p>
        <p>
          Where data is transferred from the EEA, UK, or another jurisdiction with transfer requirements, we rely
          on appropriate safeguards such as standard contractual clauses or other approved mechanisms.
        </p>
      </LegalSection>

      <LegalSection id="cookies" number={10} title="Cookies">
        <p>We use cookies and similar technologies for essential login, security, preferences, and analytics.</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Essential cookies keep you signed in and protect the Platform.</li>
          <li>Preference cookies remember product settings.</li>
          <li>Analytics cookies help us understand product usage and reliability.</li>
        </ul>
        <p>
          We do not use advertising cookies or track you across unrelated websites. You can manage cookies in your
          browser, but disabling essential cookies may prevent the Platform from working.
        </p>
      </LegalSection>

      <LegalSection id="children" number={11} title="Children">
        <p>
          Social Emblue AI is a business platform and is not intended for children under 18. We do not knowingly
          collect personal data from children. If you believe a child has provided personal data, contact us at
          privacy@emblue.africa.
        </p>
      </LegalSection>

      <LegalSection id="ndpr" number={12} title="NDPR Compliance">
        <p>
          We comply with the Nigeria Data Protection Regulation 2019 and the Nigeria Data Protection Act 2023.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>We collect the minimum data necessary for the Platform.</li>
          <li>We process personal data lawfully, fairly, and transparently.</li>
          <li>We store data securely and restrict access.</li>
          <li>We use safeguards for transfers outside Nigeria.</li>
          <li>We maintain processing records and privacy contacts.</li>
        </ul>
        <p>
          Nigerian users may contact the Nigeria Data Protection Commission at{" "}
          <a className="font-semibold text-[#1f40ff] underline" href="https://ndpc.gov.ng" rel="noreferrer" target="_blank">
            ndpc.gov.ng
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="changes" number={13} title="Changes">
        <p>
          We may update this Privacy Policy from time to time. If material changes are made, we will notify users
          by email or through the Platform and update the date at the top of this page.
        </p>
      </LegalSection>

      <LegalSection id="contact" number={14} title="Contact">
        <ContactBox>
          <p className="font-bold">Data Protection Officer - Emblue Africa</p>
          <p>Operating as Social Emblue AI</p>
          <p>Privacy enquiries: privacy@emblue.africa</p>
          <p>General contact: hello@emblue.africa</p>
          <p>Lagos, Federal Republic of Nigeria</p>
          <p>We aim to respond to privacy requests within 30 days.</p>
        </ContactBox>
      </LegalSection>
    </LegalPage>
  );
}
