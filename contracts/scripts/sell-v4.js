const fs=require("fs"),path=require("path");const {ethers}=require("hardhat");
async function main(){const [s]=await ethers.getSigners();
const d=JSON.parse(fs.readFileSync(path.join(__dirname,"..","deployments","elysiumMainnetV4.json"))).contracts;
const lp=await ethers.getContractAt("ZephraV4Launchpad",d.ZephraV4Launchpad);
const n=await lp.tokenCount();const token=await lp.allTokens(n-1n);
const t=await ethers.getContractAt("ZephraTokenV4",token);
console.log("token",token,"bal",ethers.formatEther(await t.balanceOf(s.address)),"allowance",ethers.formatEther(await t.allowance(s.address,d.ZephraRouter)));
const r=await ethers.getContractAt("ZephraRouter",d.ZephraRouter);
const bal=await t.balanceOf(s.address);
if(bal>0n){ if((await t.allowance(s.address,d.ZephraRouter))<bal){await (await t.approve(d.ZephraRouter,bal)).wait();await new Promise(r=>setTimeout(r,5000));}
 const tx=await r.sell(token,bal,0,Math.floor(Date.now()/1000)+600);await tx.wait();console.log("sell ok",tx.hash);}
const i=await lp.info(token);console.log("netQuote",ethers.formatEther(i.netQuote),"tokensSold",ethers.formatEther(i.tokensSold));}
main().catch(e=>{console.error(e.shortMessage||e.message);process.exit(1)});
