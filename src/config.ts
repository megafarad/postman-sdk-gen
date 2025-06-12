import fs from "fs/promises";
import path from "path";

export interface SdkGenConfig {
    collection: string;
    output: string;
    clientName: string;
    useFetch: boolean;
    singleFile: boolean;
    quiet: boolean;
}

export async function loadConfig(collectionArg: string, cliOpts: any): Promise<SdkGenConfig> {
    let configFileOpts: Record<string, any> = {};
    if (cliOpts.config) {
        const filePath = path.resolve(cliOpts.config);
        const fileContent = await fs.readFile(filePath, "utf-8");
        configFileOpts = JSON.parse(fileContent);
    }


    return {
        collection: collectionArg,
        output: cliOpts.output || configFileOpts["output"] || "./sdk",
        clientName: cliOpts.clientName || configFileOpts["clientName"] || "ApiClient",
        useFetch: cliOpts.useFetch || configFileOpts["useFetch"] || false,
        singleFile: cliOpts.singleFile || configFileOpts["singleFile"] || false,
        quiet: cliOpts.quiet || configFileOpts["quiet"] || false,
    };
}
