import fs from "fs/promises";
import path from "path";
import process from "process";
import { glob } from "glob";

type GasEntry = {
  contract: string;
  gasUsed: bigint;
  address?: string;
  transactionHash?: string;
  sourceFile: string;
};

type CliOptions = {
  network: string;
  detailed: boolean;
  sort: "asc" | "desc" | "none";
};

const DEFAULT_OPTIONS: CliOptions = {
  network: "ethereum_testnet",
  detailed: false,
  sort: "none",
};

function printHelp(): void {
  console.log(`
dTRINITY Gas Estimation Utility
================================

Usage:
  yarn gas-estimate [--network <name>] [--detailed] [--sort asc|desc] [--help]

Options:
  --network, -n   Deployment subdirectory to read (default: ethereum_testnet)
  --detailed, -d  Print per-contract breakdown instead of summary only
  --sort          Sort detailed table by gas usage ("asc" | "desc")
  --help, -h      Display this help message

Description:
  Scans Hardhat deployment artifacts for the selected network and aggregates
  the gas usage recorded in each deployment JSON. Useful for quick comparisons
  when planning mainnet rollouts or sanity-checking deployment refactors.
`);
}

function parseArgs(argv: string[]): CliOptions | null {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return null;
  }

  const opts: CliOptions = { ...DEFAULT_OPTIONS };

  const networkFlagIndex = argv.findIndex((arg) => arg === "--network" || arg === "-n");
  if (networkFlagIndex !== -1 && networkFlagIndex + 1 < argv.length) {
    opts.network = argv[networkFlagIndex + 1];
  }

  if (argv.includes("--detailed") || argv.includes("-d")) {
    opts.detailed = true;
  }

  const sortFlagIndex = argv.findIndex((arg) => arg === "--sort");
  if (sortFlagIndex !== -1 && sortFlagIndex + 1 < argv.length) {
    const sortValue = argv[sortFlagIndex + 1];
    if (sortValue === "asc" || sortValue === "desc") {
      opts.sort = sortValue;
    } else {
      console.warn(`Ignoring unsupported sort value "${sortValue}". Use "asc" or "desc".`);
    }
  }

  return opts;
}

function parseGasValue(value: unknown): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string") {
    if (value.trim().length === 0) {
      return null;
    }

    try {
      if (value.startsWith("0x") || value.startsWith("0X")) {
        return BigInt(value);
      }
      return BigInt(value);
    } catch (error) {
      console.warn(`Unable to parse gas value "${value}": ${(error as Error).message}`);
      return null;
    }
  }

  return null;
}

function formatGas(gas: bigint): string {
  const asString = gas.toString();
  if (asString.length <= 3) {
    return asString;
  }

  const reversed = asString.split("").reverse();
  const chunks: string[] = [];
  for (let i = 0; i < reversed.length; i += 3) {
    chunks.push(reversed.slice(i, i + 3).reverse().join(""));
  }
  return chunks.reverse().join(",");
}

async function loadDeploymentEntries(deploymentsDir: string): Promise<GasEntry[]> {
  const pattern = path.join(deploymentsDir, "*.json");
  const files = await glob(pattern, { nodir: true });

  const entries: GasEntry[] = [];

  for (const file of files) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const data = JSON.parse(raw);
      const gasValue =
        parseGasValue(data?.receipt?.gasUsed) ??
        parseGasValue(data?.gasUsed) ??
        parseGasValue(data?.receipt?.cumulativeGasUsed);

      if (gasValue === null) {
        continue;
      }

      entries.push({
        contract: path.basename(file, ".json"),
        gasUsed: gasValue,
        address: typeof data?.address === "string" ? data.address : undefined,
        transactionHash: typeof data?.receipt?.transactionHash === "string" ? data.receipt.transactionHash : data?.transactionHash,
        sourceFile: file,
      });
    } catch (error) {
      console.warn(`Failed to process deployment file "${file}": ${(error as Error).message}`);
    }
  }

  return entries;
}

function printSummary(entries: GasEntry[], options: CliOptions): void {
  if (entries.length === 0) {
    console.log("No deployment files with gas usage found for the selected network.");
    return;
  }

  const totalGas = entries.reduce((sum, entry) => sum + entry.gasUsed, 0n);
  const maxGas = entries.reduce((max, entry) => (entry.gasUsed > max ? entry.gasUsed : max), 0n);

  console.log(`\nNetwork: ${options.network}`);
  console.log(`Contracts processed: ${entries.length}`);
  console.log(`Total gas used: ${formatGas(totalGas)} units`);
  console.log(`Highest single deployment gas: ${formatGas(maxGas)} units\n`);
}

function printDetailed(entries: GasEntry[], options: CliOptions): void {
  if (!options.detailed) {
    return;
  }

  let sortedEntries = [...entries];
  if (options.sort === "asc") {
    sortedEntries = sortedEntries.sort((a, b) => (a.gasUsed < b.gasUsed ? -1 : a.gasUsed > b.gasUsed ? 1 : 0));
  } else if (options.sort === "desc") {
    sortedEntries = sortedEntries.sort((a, b) => (a.gasUsed > b.gasUsed ? -1 : a.gasUsed < b.gasUsed ? 1 : 0));
  }

  const tableData = sortedEntries.map((entry) => ({
    Contract: entry.contract,
    "Gas Used": formatGas(entry.gasUsed),
    Address: entry.address ?? "n/a",
    "Tx Hash": entry.transactionHash ?? "n/a",
  }));

  console.table(tableData);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    return;
  }

  const deploymentsDir = path.join(process.cwd(), "deployments", options.network);
  try {
    const stats = await fs.stat(deploymentsDir);
    if (!stats.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch (error) {
    console.error(`\nDeployment directory not found: ${deploymentsDir}`);
    console.error("Use --network to point at a valid Hardhat deployments folder (e.g., --network katana_mainnet).\n");
    process.exitCode = 1;
    return;
  }

  const entries = await loadDeploymentEntries(deploymentsDir);
  printSummary(entries, options);
  printDetailed(entries, options);
}

main().catch((error) => {
  console.error("Unhandled error while estimating deployment gas:", error);
  process.exitCode = 1;
});

