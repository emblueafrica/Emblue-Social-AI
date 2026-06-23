import type { Metadata } from "next";
import Link from "next/link";
import { Callout, ContactBox, LegalPage, LegalSection } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service | Social Emblue AI",
  description: "Terms of Service for Social Emblue AI by Emblue Africa.",
};

const toc = [
  { id: "acceptance", label: "Acceptance" },
  { id: "service", label: "Service Description" },
  { id: "accounts", label: "Accounts" },
  { id: "permitted-use", label: "Permitted Use" },
  { id: "prohibited", label: "Prohibited Activities" },
  { id: "platforms", label: "Platform Compliance" },
  { id: "ip", label: "Intellectual Property" },
  { id: "data", label: "Data & Privacy" },
  { id: "payment", label: "Payment Terms" },
  { id: "disclaimers", label: "Disclaimers" },
  { id: "liability", label: "Liability" },
  { id: "termination", label: "Termination" },
  { id: "law", label: "Governing Law" },
  { id: "changes", label: "Changes" },
  { id: "contact", label: "Contact" },
];

export default function TermsPage() {
  return (
    <LegalPage
      active="terms"
      title="Terms of Service"
      subtitle="Please read these terms carefully before using Social Emblue AI. By accessing our platform, you agree to be bound by these terms."
      effectiveDate="June 23, 2026"
      lastUpdated="June 23, 2026"
      toc={toc}
    >
      <LegalSection id="acceptance" number={1} title="Acceptance">
        <p>
          These Terms of Service govern your access to and use of Social Emblue AI, operated by Emblue Africa. By
          accessing or using the Platform, you agree to be bound by these Terms.
        </p>
        <p>
          These Terms apply to agency operators, platform administrators, brand clients, and any other user granted
          access to Social Emblue AI.
        </p>
        <Callout>
          If you use the Platform on behalf of an organization, you represent that you have authority to bind that
          organization to these Terms.
        </Callout>
      </LegalSection>

      <LegalSection id="service" number={2} title="Service Description">
        <p>
          Social Emblue AI is an AI-powered social media management platform for Instagram, Facebook, X, TikTok,
          and related marketing workflows.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Advanced Social Listening for monitoring public conversations by configured keywords.</li>
          <li>Search & Clustering for grouping conversations into topic intelligence.</li>
          <li>AI Reply Engine for generating and sending responses to comments and messages.</li>
          <li>Comment to DM Funnel for converting commenters into DM conversations.</li>
          <li>Social Response Dashboard for KPI monitoring and reporting.</li>
          <li>Attribution & Links for tracked link generation and conversion attribution.</li>
          <li>Creative Predictor for AI-powered caption and content scoring.</li>
          <li>Comment Mining & Insights for extracting audience intelligence from comments.</li>
          <li>Campaign War Room for real-time campaign health monitoring.</li>
          <li>Engage the Engagers for targeted audience engagement campaigns.</li>
        </ul>
        <p>
          We may modify, suspend, or discontinue features with reasonable notice where practical.
        </p>
      </LegalSection>

      <LegalSection id="accounts" number={3} title="Accounts">
        <p>
          Agency and brand accounts are created through onboarding or administrative approval. You are responsible
          for keeping login details secure and for all activity under your account.
        </p>
        <p>
          Brand client accounts may be created and managed by agency operators or platform administrators. Clients
          must maintain confidentiality of their login credentials.
        </p>
        <p>
          Social media accounts are connected through OAuth authorization. You may revoke authorization from Social
          Emblue AI or from the relevant social platform settings.
        </p>
        <Callout>
          We never ask for or store your social media passwords. Social accounts connect through approved OAuth
          flows only.
        </Callout>
      </LegalSection>

      <LegalSection id="permitted-use" number={4} title="Permitted Use">
        <p>You may use Social Emblue AI for lawful social media management purposes, including:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Managing authorized brand social accounts.</li>
          <li>Monitoring public conversations and brand-related keywords.</li>
          <li>Creating, scheduling, publishing, and responding on behalf of authorized brands.</li>
          <li>Generating reports, insights, and audience intelligence from permitted data sources.</li>
          <li>Running engagement campaigns within applicable platform rules and API limitations.</li>
        </ul>
      </LegalSection>

      <LegalSection id="prohibited" number={5} title="Prohibited Activities">
        <p>You must not use the Platform to:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Send spam, harassment, threats, or abusive messages.</li>
          <li>Engage in deceptive, fraudulent, or misleading activity.</li>
          <li>Violate the terms, policies, or rate limits of social media platforms.</li>
          <li>Collect more personal data than necessary for an approved Platform function.</li>
          <li>Access accounts or data without authorization.</li>
          <li>Use the Platform for unlawful activity.</li>
          <li>Circumvent security, access controls, permissions, or usage limits.</li>
          <li>Reverse engineer, scrape, resell, or sublicense the Platform without written authorization.</li>
          <li>Use external automated scripts or bots to access the Platform outside provided APIs.</li>
        </ul>
        <p>Violation of these restrictions may result in suspension or termination.</p>
      </LegalSection>

      <LegalSection id="platforms" number={6} title="Third-Party Platform Compliance">
        <p>
          Social Emblue AI integrates with Meta, X Corp, TikTok, and other third-party platforms. Your use of those
          integrations must comply with each platform's terms, developer policies, messaging rules, and rate limits.
        </p>
        <p>
          API access, permissions, scopes, and platform rules may change. We are not responsible for third-party
          platform outages, denials, restrictions, account actions, or API policy changes.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Instagram and Facebook messages are subject to Meta messaging windows and private reply rules.</li>
          <li>X replies are public unless approved DM permissions and conversation eligibility allow direct messages.</li>
          <li>TikTok comments, messages, and publishing depend on approved API access and platform rate limits.</li>
        </ul>
      </LegalSection>

      <LegalSection id="ip" number={7} title="Intellectual Property">
        <p>
          The Platform, software, design, workflows, documentation, and trademarks are owned by Emblue Africa or
          its licensors. We grant you a limited, non-exclusive, non-transferable right to use the Platform during
          your active subscription or approved access period.
        </p>
        <p>
          You retain ownership of content, brand assets, captions, comments, media, and campaign materials you
          upload or authorize us to process. You grant us a limited license to process, store, transmit, and display
          that content only to provide the Platform.
        </p>
        <p>
          AI-generated content is assistive. You are responsible for reviewing and approving content before
          publication. Ownership of published content rests with the brand account that publishes it.
        </p>
      </LegalSection>

      <LegalSection id="data" number={8} title="Data and Privacy">
        <p>
          Our{" "}
          <Link href="/privacy" className="font-semibold text-[#1f40ff] underline">
            Privacy Policy
          </Link>{" "}
          explains how we collect, use, store, and protect personal data. It is incorporated into these Terms.
        </p>
        <p>
          Where Social Emblue AI processes social media data for a brand or agency, the brand or agency remains
          responsible for ensuring it has a lawful basis and required permissions under applicable data protection
          laws.
        </p>
        <p>
          We use security measures such as encrypted credential storage, HTTPS, role-based access controls, and
          restricted administrative access. No system can be guaranteed completely secure.
        </p>
      </LegalSection>

      <LegalSection id="payment" number={9} title="Payment Terms">
        <p>
          Access to Social Emblue AI may require a subscription or service agreement. Pricing, billing frequency,
          and included services are agreed during onboarding or in a separate commercial agreement.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Fees are generally billed monthly or annually.</li>
          <li>Payments are non-refundable except where required by law or agreed in writing.</li>
          <li>Non-payment may result in suspension or termination.</li>
          <li>Price changes will be communicated at least 30 days before taking effect.</li>
          <li>You are responsible for applicable taxes.</li>
        </ul>
        <p>For pricing and billing questions, contact hello@emblue.africa.</p>
      </LegalSection>

      <LegalSection id="disclaimers" number={10} title="Disclaimers">
        <p>
          The Platform is provided on an "as is" and "as available" basis. We do not warrant that the Platform will
          be uninterrupted, error-free, completely secure, or available at all times.
        </p>
        <p>
          We do not guarantee that AI-generated content will be accurate, suitable, compliant, or effective for
          every use case. You remain responsible for reviewing outputs and complying with applicable laws and
          platform policies.
        </p>
        <p>We do not guarantee that third-party social media APIs will remain available or unchanged.</p>
      </LegalSection>

      <LegalSection id="liability" number={11} title="Liability">
        <p>
          To the maximum extent permitted by law, Emblue Africa will not be liable for indirect, incidental,
          special, consequential, punitive, or exemplary damages, including lost profits, lost data, loss of
          goodwill, or social platform account actions.
        </p>
        <p>
          Our total liability for claims relating to the Platform is limited to the fees paid by you for the
          Platform in the three months before the event giving rise to the claim.
        </p>
        <p>
          Nothing in these Terms limits liability that cannot legally be excluded, including liability for fraud,
          death, or personal injury caused by negligence.
        </p>
      </LegalSection>

      <LegalSection id="termination" number={12} title="Termination">
        <p>You may stop using the Platform or request termination by contacting us.</p>
        <p>We may suspend or terminate access if you:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Breach these Terms.</li>
          <li>Violate social media platform policies.</li>
          <li>Use the Platform for fraudulent, abusive, or unlawful activity.</li>
          <li>Fail to pay applicable fees.</li>
        </ul>
        <p>
          On termination, Platform access ceases, data is handled according to the Privacy Policy, and outstanding
          payment obligations remain due.
        </p>
      </LegalSection>

      <LegalSection id="law" number={13} title="Governing Law">
        <p>
          These Terms are governed by the laws of the Federal Republic of Nigeria. The parties will first attempt
          to resolve disputes through good-faith negotiation.
        </p>
        <p>
          If a dispute cannot be resolved informally, it will be referred to arbitration in Lagos, Nigeria under
          applicable Nigerian arbitration law, unless emergency injunctive relief is required.
        </p>
      </LegalSection>

      <LegalSection id="changes" number={14} title="Changes">
        <p>
          We may update these Terms from time to time. If material changes are made, we will notify users by email
          or through the Platform and update the date at the top of this page.
        </p>
        <p>Continued use of Social Emblue AI after changes take effect means you accept the updated Terms.</p>
      </LegalSection>

      <LegalSection id="contact" number={15} title="Contact">
        <ContactBox>
          <p className="font-bold">Emblue Africa</p>
          <p>Operating as Social Emblue AI</p>
          <p>Legal enquiries: legal@emblue.africa</p>
          <p>General contact: hello@emblue.africa</p>
          <p>Lagos, Federal Republic of Nigeria</p>
        </ContactBox>
      </LegalSection>
    </LegalPage>
  );
}
