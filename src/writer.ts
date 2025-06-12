import fs from "fs/promises";
import path from "path";

export async function writeClientFile(outputDir: string, fileName: string, content: string): Promise<string> {
    await fs.mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
}
