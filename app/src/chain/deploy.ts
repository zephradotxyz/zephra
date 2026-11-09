// Deploy the Zephra contracts from the connected wallet, straight from the browser.
import { parseEther, type Abi, type Address, type Hex } from "viem";
import artifacts from "./artifacts.json";
import { setDeployment, type Deployment } from "./config";
import { publicClient, recordTx, updateTx, wallet, ensureChain } from "./wallet";

export interface DeployStep {
  label: string;
  status: "waiting" | "pending" | "done" | "error";
  hash?: string;
  address?: Address;
}

export async function deployZephra(opts: { gradTarget: string; creationFee: string; treasury?: string }, onStep: (steps: DeployStep[]) => void): Promise<Deployment> {
  await ensureChain();
  const wc = wallet.client();
  const account = wallet.state.address!;
  const signer = wc.account ?? account; // local key or extension (injected)
  const pc = publicClient();
  const steps: DeployStep[] = [
    { label: "Deploy ZephraConfig", status: "waiting" },
    { label: "Deploy PoolFactory", status: "waiting" },
    { label: "Deploy MarketFactory", status: "waiting" },
    { label: "Deploy ZephraLaunchpad", status: "waiting" },
    { label: "Link PoolFactory → Launchpad", status: "waiting" },
    { label: "Link MarketFactory → Launchpad", status: "waiting" },
  ];
  const update = (i: number, p: Partial<DeployStep>) => {
    steps[i] = { ...steps[i], ...p };
    onStep([...steps]);
  };
  onStep([...steps]);

  const treasury = (opts.treasury || account) as Address;
  const G = parseEther(opts.gradTarget);
  const fee = parseEther(opts.creationFee);
  let firstBlock = 0n;

  async function deploy(i: number, name: keyof typeof artifacts, args: unknown[]) {
    const art = artifacts[name] as { abi: Abi; bytecode?: string };
    update(i, { status: "pending" });
    try {
      const hash = await wc.deployContract({ abi: art.abi, bytecode: art.bytecode as Hex, args, account: signer, chain: wc.chain } as never);
      recordTx(hash, steps[i].label);
      update(i, { hash });
      const rc = await pc.waitForTransactionReceipt({ hash });
      updateTx(hash, rc.status === "success" ? "success" : "failed");
      if (rc.status !== "success" || !rc.contractAddress) throw new Error(`${steps[i].label} failed`);
      if (!firstBlock) firstBlock = rc.blockNumber;
      update(i, { status: "done", address: rc.contractAddress });
      return rc.contractAddress;
    } catch (e) {
      update(i, { status: "error" });
      throw e;
    }
  }

  async function call(i: number, address: Address, name: keyof typeof artifacts, fn: string, args: unknown[]) {
    const art = artifacts[name] as { abi: Abi };
    update(i, { status: "pending" });
    try {
      const hash = await wc.writeContract({ address, abi: art.abi, functionName: fn, args, account: signer, chain: wc.chain } as never);
      recordTx(hash, steps[i].label);
      update(i, { hash });
      const rc = await pc.waitForTransactionReceipt({ hash });
      updateTx(hash, rc.status === "success" ? "success" : "failed");
      if (rc.status !== "success") throw new Error(`${steps[i].label} failed`);
      update(i, { status: "done" });
    } catch (e) {
      update(i, { status: "error" });
      throw e;
    }
  }

  const config = await deploy(0, "ZephraConfig", [account, account, treasury, G, fee]);
  const pf = await deploy(1, "PoolFactory", [config]);
  const mf = await deploy(2, "MarketFactory", [config]);
  const lp = await deploy(3, "ZephraLaunchpad", [config, pf, mf]);
  await call(4, pf, "PoolFactory", "setLaunchpad", [lp]);
  await call(5, mf, "MarketFactory", "setLaunchpad", [lp]);

  const dep: Deployment = { launchpad: lp, config, poolFactory: pf, marketFactory: mf, fromBlock: String(firstBlock) };
  setDeployment(dep);
  return dep;
}

/** Use an existing deployment: only the launchpad address is needed. */
export async function importDeployment(launchpad: Address): Promise<Deployment> {
  const pc = publicClient();
  const lpAbi = artifacts.ZephraLaunchpad.abi as Abi;
  const config = (await pc.readContract({ address: launchpad, abi: lpAbi, functionName: "config" })) as Address;
  const dep: Deployment = { launchpad, config, fromBlock: "0" };
  // find the deployment block (binary search on code presence) so event indexing starts there
  const head = await pc.getBlockNumber();
  let lo = 0n;
  let hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await pc.getCode({ address: launchpad, blockNumber: mid }).catch(() => undefined);
    if (code && code !== "0x") hi = mid;
    else lo = mid + 1n;
  }
  dep.fromBlock = String(lo);
  setDeployment(dep);
  return dep;
}
