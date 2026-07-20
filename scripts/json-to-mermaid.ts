/**
 * Turn a dumped refinance transaction (refinance-flow.json) into a black & white
 * Mermaid flowchart of the whole flashloan refinance flow.
 *
 *   yarn tsx scripts/json-to-mermaid.ts [path/to/refinance-flow.json]
 *
 * Prints the Mermaid source to stdout (paste into a ```mermaid block).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { buildCpiTreeFromLogs, LogNode } from "../tests/tx-printer";

const LABELS: Record<string, string> = {
  "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi": "Jupiter Lend borrow (jupr81) — RESTRICTED",
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD": "Kamino Lend (KLend)",
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr": "Kamino Farms",
  "ComputeBudget111111111111111111111111111111": "Compute Budget",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  "11111111111111111111111111111111": "System Program",
};

function short(id: string) {
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

// Which top-level instruction is which, by program-id prefix.
function classifyTopLevel(programId: string): string | null {
  if (programId.startsWith("jupg")) return "flashloan"; // jupg… = Jupiter flashloan/liquidity
  if (programId.startsWith("Compute")) return "compute";
  return "refinance"; // our program (the only other top-level)
}

// Pull the "Instruction: X" label a KLend/jupr81 child logged, to name the CPI.
function ixName(node: LogNode): string | undefined {
  const m = node.messages.find((l) => l.startsWith("Instruction: "));
  return m?.replace("Instruction: ", "");
}

function main() {
  const path = process.argv[2] || join(__dirname, "..", "refinance-flow.json");
  const dump = JSON.parse(readFileSync(path, "utf8"));
  const tx = dump.transaction;
  const logs: string[] = tx.meta.logMessages || [];
  const roots = buildCpiTreeFromLogs(logs);

  // Find the refinance root (our program) and the two flashloan roots (jupg).
  const flashRoots = roots.filter((r) => r.programId.startsWith("jupg"));
  const refinanceRoot = roots.find(
    (r) => classifyTopLevel(r.programId) === "refinance"
  );

  // Under the refinance, group KLend calls (repay/withdraw/refresh) and the jupr81 call.
  const kaminoOps: string[] = [];
  let hasJupr81 = false;
  for (const child of refinanceRoot?.children || []) {
    if (child.programId.startsWith("jupr81")) hasJupr81 = true;
    else if (child.programId.startsWith("KLend")) {
      const n = ixName(child);
      if (n && !/Refresh/i.test(n)) kaminoOps.push(n); // skip the refresh plumbing
    }
  }

  const L: string[] = [];
  L.push("```mermaid");
  L.push("%%{init: {'theme':'base','themeVariables':{");
  L.push("  'background':'#ffffff','primaryColor':'#ffffff','primaryBorderColor':'#000000',");
  L.push("  'primaryTextColor':'#000000','lineColor':'#000000','fontFamily':'monospace',");
  L.push("  'clusterBkg':'#ffffff','clusterBorder':'#000000'}}}%%");
  L.push("flowchart TB");
  L.push("  classDef h1 fill:#ffffff,stroke:#000000,stroke-width:1px,color:#000000;");
  L.push("  classDef h2 fill:#ffffff,stroke:#000000,stroke-width:1px,stroke-dasharray:4 2,color:#000000;");
  L.push("");
  L.push('  FB["① flash borrow USDC<br/>jupg… · height 1"]:::h1');
  L.push('  FR["③ flash repay USDC<br/>jupg… · height 1"]:::h1');
  L.push("");
  L.push('  subgraph RF["② refinance — our program (height 1)"]');
  L.push("    direction TB");
  const nodes: string[] = [];
  kaminoOps.forEach((op, i) => {
    const id = `K${i}`;
    const kind = /Repay/i.test(op) ? "repay Kamino USDC debt" : /Withdraw/i.test(op) ? "withdraw JLP collateral" : op;
    L.push(`    ${id}["${kind}<br/>KLend · height 2 (CPI)"]:::h2`);
    nodes.push(id);
  });
  if (hasJupr81) {
    L.push('    J0["deposit JLP + borrow USDC<br/>jupr81 · height 2 (CPI)<br/>hidden from the sysvar scan"]:::h2');
    nodes.push("J0");
  }
  for (let i = 0; i < nodes.length - 1; i++) L.push(`    ${nodes[i]} --> ${nodes[i + 1]}`);
  L.push("  end");
  L.push("");
  // Single vertical column (NOTE at the bottom, not a side branch) so the image
  // stays narrow and never overflows the page width.
  L.push('  NOTE["Kamino repay scans TOP-LEVEL<br/>ixs (height 1) for jupr81.<br/>Here height 1 is only jupg +<br/>our program, so jupr81 (height 2)<br/>is invisible → allowed."]:::h1');
  L.push("  FB --> RF --> FR -.-> NOTE");
  L.push("```");
  console.log(L.join("\n"));

  console.error(
    `\n[from ${path.split("/").pop()}] flash roots: ${flashRoots.length}, kamino ops: ${kaminoOps.join(", ")}, jupr81 nested: ${hasJupr81}`
  );
}

main();
