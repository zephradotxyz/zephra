// Legal pages. Fill in SITE.contactEmail, SITE.legalEntity and SITE.jurisdiction in src/site.ts
// and have counsel review before mainnet.
import { H2, P, B, UL, Callout, DocLink, type DocPage } from "../../components/DocKit";
import { SITE, operator } from "../../site";

const Contact = () =>
  SITE.contactEmail ? (
    <a href={`mailto:${SITE.contactEmail}`} className="font-semibold text-accent hover:underline">{SITE.contactEmail}</a>
  ) : (
    <>the official channels listed on {SITE.domain}</>
  );

export const LEGAL: DocPage[] = [
  {
    slug: "terms",
    group: "Legal",
    title: "Terms of Use",
    summary: `These Terms govern your access to the ${SITE.name} interface at ${SITE.domain}. By using the interface you agree to them.`,
    Body: () => (
      <>
        <H2>1. Who we are</H2>
        <P>
          The {SITE.name} interface (the "Interface") is a website operated by {operator()} ("we", "us"). It lets you interact with
          open-source smart contracts deployed on the Elysium network (the "Protocol"). The Interface is one of several ways to access the
          Protocol; we do not control the Protocol, the blockchain, or any wallet you use.
        </P>
        <H2>2. Real assets</H2>
        <P>
          The Interface connects to <B>Elysium mainnet</B>. Transactions use real HYPE and real tokens, are final once included in a block,
          and can result in the <B>total loss</B> of the assets involved. The smart contracts have not been externally audited.
        </P>
        <H2>3. Eligibility</H2>
        <UL
          items={[
            "You must be at least 18 years old and able to form a binding contract.",
            "You must not be a resident of, or located in, a country or region subject to comprehensive sanctions, and you must not be on any sanctions list.",
            "You are responsible for making sure your use of the Interface is lawful where you live.",
          ]}
        />
        <H2>4. Non-custodial service</H2>
        <P>
          We never take custody of your assets or private keys. Transactions are created in the Interface, signed by you in your wallet and
          executed by the Protocol on-chain. On-chain transactions are <B>final and irreversible</B>; we cannot cancel, reverse or refund them.
          You are solely responsible for securing your wallet, keys and devices. Keep your keys safe and never share them.
        </P>
        <H2>5. User-created tokens</H2>
        <P>
          Anyone can create a token through the Protocol. We do not create, review, endorse or vet tokens, their names, logos, descriptions or
          links. Token creators are solely responsible for what they publish and must not infringe third-party rights or mislead others. We may
          hide tokens or content from the Interface at our discretion, but this does not affect the underlying contracts.
        </P>
        <H2>6. Prohibited use</H2>
        <P>You agree not to:</P>
        <UL
          items={[
            "break any applicable law, including sanctions, anti-money-laundering, securities and consumer protection laws;",
            "manipulate markets, including wash trading, spoofing or coordinated pump-and-dump schemes;",
            "publish content that is fraudulent, defamatory, hateful, sexually explicit, or that impersonates another person or project;",
            "interfere with or attack the Interface, the Protocol or other users, including through exploits, malware or automated abuse;",
            "use the Interface to infringe intellectual property rights.",
          ]}
        />
        <H2>7. No advice</H2>
        <P>
          Nothing in the Interface or documentation is financial, investment, legal or tax advice. You make your own decisions and should consult
          professional advisers where appropriate.
        </P>
        <H2>8. Risks</H2>
        <P>
          Using blockchain protocols involves significant risk, including total loss of assets. Please read the{" "}
          <DocLink to="/legal/risk">Risk Disclosure</DocLink>, which forms part of these Terms.
        </P>
        <H2>9. Fees</H2>
        <P>
          The Protocol charges the fees described in the <DocLink to="/docs/fees">documentation</DocLink>. You also pay network gas. We may change
          the Interface at any time; Protocol parameters change only as described in the documentation.
        </P>
        <H2>10. Intellectual property</H2>
        <P>
          The {SITE.name} name, logo and Interface design belong to {operator()}. The smart contracts are made available under their own
          open-source licence. You may not use our branding in a way that suggests endorsement or affiliation.
        </P>
        <H2>11. Disclaimer of warranties</H2>
        <P>
          The Interface and Protocol are provided <B>"as is" and "as available"</B>, without warranties of any kind, express or implied, including
          merchantability, fitness for a particular purpose and non-infringement. We do not warrant that they will be secure, error-free or
          uninterrupted, or that any data shown (prices, balances, PnL) is accurate or current.
        </P>
        <H2>12. Limitation of liability</H2>
        <P>
          To the maximum extent permitted by law, {operator()} and its contributors will not be liable for any indirect, incidental, special,
          consequential or punitive damages, or for any loss of profits, data or digital assets, arising from your use of, or inability to use,
          the Interface or the Protocol, even if advised of the possibility of such damages.
        </P>
        <H2>13. Indemnity</H2>
        <P>
          You agree to indemnify and hold harmless {operator()} and its contributors from claims arising out of your use of the Interface, the
          content you publish, or your breach of these Terms or of any law.
        </P>
        <H2>14. Changes and termination</H2>
        <P>
          We may update these Terms by posting a new version with a new date. Continued use after changes means you accept them. We may restrict
          or stop providing the Interface, in whole or in part, at any time.
        </P>
        {SITE.jurisdiction && (
          <>
            <H2>15. Governing law</H2>
            <P>These Terms are governed by the laws of {SITE.jurisdiction}, and disputes will be resolved by the courts of {SITE.jurisdiction}.</P>
          </>
        )}
        <H2>{SITE.jurisdiction ? "16" : "15"}. Contact</H2>
        <P>Questions about these Terms can be sent to <Contact />.</P>
      </>
    ),
  },
  {
    slug: "privacy",
    group: "Legal",
    title: "Privacy Policy",
    summary: `How the ${SITE.name} interface handles information. Short version: no accounts, no tracking cookies, no analytics. Your wallet activity is public on-chain.`,
    Body: () => (
      <>
        <Callout title="At a glance">
          We do not ask for your name or email, we do not use advertising or analytics trackers, and we do not sell data. Settings stay in your
          browser.
        </Callout>
        <H2>1. Information we do not collect</H2>
        <P>
          The Interface has no sign-up. We do not collect names, email addresses, phone numbers, identity documents or payment card details.
        </P>
        <H2>2. Public blockchain data</H2>
        <P>
          When you connect a wallet, the Interface reads your public address and balances from the blockchain. Every transaction you sign,
          including trades, token launches, logos and metadata, is recorded permanently on a public blockchain where anyone can see it. We cannot
          change or delete on-chain data.
        </P>
        <H2>3. Data stored in your browser</H2>
        <P>The Interface uses your browser's local storage, not tracking cookies, to remember:</P>
        <UL
          items={[
            "your network settings and the selected deployment;",
            "your recent transaction list, and which wallets have seen the welcome guide;",
            "whether you connected an injected wallet, so it reconnects after a refresh until you disconnect;",
          ]}
        />
        <P>This data never leaves your device. Clearing your browser's site data removes it.</P>
        <H2>4. Third-party services</H2>
        <P>To work, the Interface connects your browser directly to services we do not operate. Each may receive your IP address and request details:</P>
        <UL
          items={[
            "RPC nodes (by default the public Elysium RPC), which serve blockchain reads and broadcast your transactions;",
            "your wallet provider (for example MetaMask or Rabby);",
            "the block explorer, when you open its links;",
            "our hosting provider, which may keep standard server logs (IP address, user agent, time) for security and reliability.",
          ]}
        />
        <P>Their own privacy policies apply to how they handle that information.</P>
        <H2>5. How we use information</H2>
        <P>
          We use technical information only to operate, secure and improve the Interface, for example to diagnose outages or block abusive
          traffic. We do not profile users or build advertising audiences.
        </P>
        <H2>6. Your rights</H2>
        <P>
          Depending on where you live (for example under the GDPR or CCPA), you may have rights to access, correct or delete personal data and to
          object to processing. Because we hold almost no personal data, most requests can be met by clearing your browser storage. For anything
          else, contact <Contact />. We cannot alter public blockchain records.
        </P>
        <H2>7. Children</H2>
        <P>The Interface is not intended for anyone under 18, and we do not knowingly collect data from children.</P>
        <H2>8. Changes</H2>
        <P>We will post any changes to this policy on this page with a new date.</P>
      </>
    ),
  },
  {
    slug: "risk",
    group: "Legal",
    title: "Risk Disclosure",
    summary: "Interacting with launch tokens, leveraged perpetuals and liquidity vaults carries substantial risk. Read this before you use Zephra.",
    Body: () => (
      <>
        <Callout tone="warn">Only use assets you can afford to lose entirely. Past performance and displayed returns are not indicative of future results.</Callout>
        <H2>Market risk</H2>
        <P>
          Newly launched tokens are highly speculative and usually have no intrinsic value. Prices can move by large percentages in seconds and
          fall to zero. Bonding curves and thin pools amplify price impact.
        </P>
        <H2>Leverage and liquidation</H2>
        <P>
          Perpetual positions use leverage, so losses grow faster than the underlying price move. When equity falls below 10% of notional the
          position can be liquidated and you can lose your entire margin. Funding payments reduce equity over time. Profits are capped at 2/3 of
          notional, and positions at the cap are closed automatically.
        </P>
        <H2>Vault (LP) risk</H2>
        <P>
          Perp Vault depositors are the counterparty to traders. If traders are profitable, the vault's NAV and your share value fall.
          Withdrawals have a 1-hour cooldown and execute at the NAV at execution time, which may be lower than when you requested.
        </P>
        <H2>Smart contract risk</H2>
        <P>
          The contracts may contain bugs or vulnerabilities, and they have not yet been externally audited. An exploit could cause partial or total
          loss of funds. On-chain transactions cannot be reversed.
        </P>
        <H2>Oracle and pricing risk</H2>
        <P>
          Perp prices come from on-chain TWAPs of each token's spot pool. Although pessimistic pricing, deviation checks and caps reduce
          manipulation, prices can still diverge from other venues.
        </P>
        <H2>Network risk</H2>
        <P>
          Elysium is an L2 with a single sequencer. Outages, congestion, reorganisations or bridge failures can delay or prevent transactions,
          including closing a position. After a missed heartbeat, markets pause opens and liquidations for 10 minutes.
        </P>
        <H2>Keeper dependency</H2>
        <P>
          Heartbeats, liquidations, profit-cap closes and withdrawals rely on keepers. Keeper actions are permissionless, but if no keeper runs,
          markets can stall until someone acts.
        </P>
        <H2>Creator and content risk</H2>
        <P>
          Anyone can launch a token. Names, logos, descriptions and links are chosen by creators and are not verified. Tokens may imitate other
          projects. Do your own research.
        </P>
        <H2>Regulatory risk</H2>
        <P>
          Laws on digital assets and derivatives vary by country and change over time. Access to the Interface or Protocol may be restricted in
          your jurisdiction, and you are responsible for compliance and taxes.
        </P>
        <H2>Wallet security</H2>
        <P>
          Anyone with your private key or seed phrase controls your assets. Never share it and never type it into a website you do not trust.
        </P>
      </>
    ),
  },
];
