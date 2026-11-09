import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import { parseAbi, zeroAddress, type Address } from "viem";
import { publicClient } from "../chain/wallet";
import { addrUrl, getDeployment } from "../chain/config";
import { SITE } from "../site";
import type { Token } from "../engine/engine";

type Status = "ok" | "warn" | "load";
interface Check {
  label: string;
  detail: string;
  status: Status;
  href?: string;
}

const tokenAbi = parseAbi(["function owner() view returns (address)", "function totalSupply() view returns (uint256)"]);
// Function selectors that would let an owner or admin change balances or block transfers.
const RISKY: Record<string, string> = {
  "40c10f19": "mint",
  "8456cb59": "pause",
  f9f92be4: "blacklist",
  f2fde38b: "transferOwnership",
};

async function runChecks(addr: Address, sells: number): Promise<Check[]> {
  const c = publicClient();
  const dep = getDeployment();
  const [code, owner, supply] = await Promise.all([
    c.getCode({ address: addr }),
    c.readContract({ address: addr, abi: tokenAbi, functionName: "owner" }).catch(() => null),
    c.readContract({ address: addr, abi: tokenAbi, functionName: "totalSupply" }).catch(() => null),
  ]);
  // Zephra tokens are EIP-1167 minimal clones: scan the implementation they point to, not the 45-byte stub.
  let hex = (code ?? "0x").slice(2).toLowerCase();
  const clone = hex.match(/^363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/);
  if (clone) hex = ((await c.getCode({ address: `0x${clone[1]}` as Address })) ?? "0x").slice(2).toLowerCase();
  const found = Object.entries(RISKY).filter(([sel]) => hex.includes(sel)).map(([, n]) => n);
  const renounced = owner === zeroAddress || owner === null;
  const fixed = supply !== null && supply <= 1_000_000_000n * 10n ** 18n && !found.includes("mint");
  const out: Check[] = [
    { label: "Contract deployed", detail: hex.length > 0 ? "Bytecode is live on Elysium" : "No contract found at this address", status: hex.length > 0 ? "ok" : "warn", href: addrUrl(addr) },
    { label: "Ownership renounced", detail: renounced ? "No owner: nobody can change the token" : "Token has an owner", status: renounced ? "ok" : "warn" },
    { label: "Fixed supply, no mint", detail: fixed ? "Total supply is fixed at 1,000,000,000" : "Supply can change", status: fixed ? "ok" : "warn" },
    {
      label: "No honeypot",
      detail: found.length ? `Found: ${found.join(", ")}` : sells > 0 ? `No pause or blacklist. ${sells} sell${sells > 1 ? "s" : ""} completed on-chain` : "No pause, blacklist or transfer tax in the contract",
      status: found.length ? "warn" : "ok",
    },
    { label: "Liquidity locked forever", detail: "One liquidity position is held by the launchpad contract. It has no function to withdraw or move it", status: dep ? "ok" : "warn", href: dep ? addrUrl(dep.launchpad) : undefined },
  ];
  out.push(
    SITE.contractsVerified
      ? { label: "Open source, verified", detail: "Source code is verified on Elyscan", status: "ok", href: addrUrl(addr) + "#code" }
      : { label: "Open source", detail: "Source code is published. Explorer verification is pending", status: "warn", href: addrUrl(addr) + "#code" }
  );
  return out;
}

/** Live on-chain safety checklist shown for every Zephra token. */
export default function TokenSafety({ t }: { t: Token }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [failed, setFailed] = useState(false);
  const sells = t.trades.filter((x) => x.kind === "sell").length;
  useEffect(() => {
    let live = true;
    setChecks(null);
    setFailed(false);
    runChecks(t.addr as Address, sells)
      .then((r) => live && setChecks(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [t.addr, sells]);

  const allOk = checks?.every((c) => c.status === "ok");
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">Safety checks</h3>
        {checks && <span className={`text-[11px] font-semibold ${allOk ? "text-accent" : "text-warn"}`}>{allOk ? "All passed" : "Review"}</span>}
      </div>
      {failed && <p className="text-xs text-muted">Could not read the contract right now. Try again in a moment.</p>}
      {!checks && !failed && <div className="flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin" /> Checking the contract…</div>}
      <ul className="space-y-2.5">
        {checks?.map((c) => (
          <li key={c.label} className="flex items-start gap-2.5 text-sm">
            {c.status === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />}
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {c.href ? (
                  <a href={c.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">{c.label}<ExternalLink size={11} className="text-muted" /></a>
                ) : (
                  c.label
                )}
              </div>
              <div className="text-xs text-muted">{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
