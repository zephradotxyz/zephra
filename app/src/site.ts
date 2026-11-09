// Public site details used by the footer, docs and legal pages.
// Fill these in before going live. Empty values are simply not shown.
export const SITE = {
  name: "Zephra",
  domain: "zephra.xyz",
  tagline: "Launchpad + perps on Elysium",
  /** Contact for legal and privacy requests, e.g. "legal@zephra.xyz" */
  contactEmail: "support@zephra.xyz",
  /** Legal entity that operates the interface, e.g. "Zephra Labs Ltd." (empty = "the Zephra contributors") */
  legalEntity: "",
  /** Governing law / venue for the Terms, e.g. "the British Virgin Islands" (empty = clause omitted) */
  jurisdiction: "",
  /** Date shown on the legal pages */
  legalUpdated: "November 1, 2026",
  /** Set to true once the contract source is verified on Elyscan; the "Open source" check then turns green. */
  contractsVerified: false,
  socials: {
    x: "https://x.com/Zephra_xyz",
    telegram: "", // https://t.me/…
    discord: "",
    github: "",
  },
};

export const operator = () => SITE.legalEntity || "the Zephra contributors";
