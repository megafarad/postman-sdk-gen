#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "./config";
import { generateSdk } from "./index";

const program = new Command();

program
    .name("postman-sdk-gen")
    .description("Generate a TypeScript SDK from a Postman collection")
    .argument("<collection>", "Path or URL to Postman collection")
    .option("-o, --output <dir>", "Output directory", "./sdk")
    .option("--client-name <name>", "Name of the generated client class", "ApiClient")
    .option("--use-fetch", "Use native fetch instead of axios", false)
    .option("--single-file", "Generate a single output file", false)
    .option("--quiet", "Suppress logs", false)
    .option("--version", "Show version", () => {
        console.log("postman-ts-sdk v0.1.0");
        process.exit(0);
    })
    .parse();

const opts = program.opts();
const collectionArg = program.args[0];

async function main() {
    const config = await loadConfig(collectionArg, opts);
    await generateSdk(config);
}

main().catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
});
