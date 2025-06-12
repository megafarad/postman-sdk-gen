import {Collection, Item, ItemGroup, Request, RequestAuth, Url} from "postman-collection";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import {camelCase} from "./utils";

export interface ParsedCollection {
    auth: RequestAuth;
    endpoints: ParsedEndpoint[];
}

export interface ParsedEndpoint {
    name: string;
    method: string;
    url: Url;
    pathParams: string[];
    queryParams: string[];
    requestBody?: string;
    headers: Record<string, string>;
    responseSample: string | undefined;
    namespacePath: string[];
    effectiveAuth: RequestAuth;
}

export async function loadCollection(collectionPath: string): Promise<Collection> {
    let json: any;

    if (collectionPath.startsWith("http://") || collectionPath.startsWith("https://")) {
        const res = await fetch(collectionPath);
        json = await res.json();
    } else {
        const fullPath = path.resolve(collectionPath);
        const content = await fs.readFile(fullPath, "utf-8");
        json = JSON.parse(content);
    }

    return new Collection(json);
}

export function extractEndpoints(collection: Collection): ParsedCollection {
    const endpoints: ParsedEndpoint[] = [];
    const collectionAuth = collection.auth || {type: "noauth"} as RequestAuth;

    const recurse = (items: Item[] | ItemGroup<Item>, path: string[] = []) => {
        if (Array.isArray(items)) {
            items.forEach(item => handleItem(item, path));
        } else {
            items.items.each(item => handleItem(item, path)); // ItemGroup has an .items property, and .each method
        }
    };

    const handleItem = (item: Item | ItemGroup<Item>, path: string[]) => {
        if (item instanceof ItemGroup) {
            recurse(item, [...path, camelCase(item.name || "unnamed")]);
        } else {
            const req = item.request as Request;
            const firstResponse = item.responses?.all()?.filter(r => r.code === 200)[0];
            const sampleBody = firstResponse?.body || undefined;
            const effectiveAuth = req.auth || collectionAuth;

            endpoints.push({
                name: item.name || req.url.getPath(),
                method: req.method,
                url: req.url,
                pathParams: req.url.variables.map((v) => v.key),
                queryParams: req.url.query.map((q) => q.key),
                requestBody: req.body?.raw || undefined,
                headers: Object.fromEntries(req.headers.map((h) => [h.key, h.value])),
                responseSample: sampleBody,
                namespacePath: path,
                effectiveAuth
            });
        }
    };

    const itemsArray = collection.items.map((i) => i) as Item[];

    recurse(itemsArray);

    return {endpoints, auth: collection.auth || {type: "noauth"} as RequestAuth};
}
