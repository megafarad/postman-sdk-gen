import {SdkGenConfig} from "./config";
import {extractEndpoints, loadCollection, ParsedCollection, ParsedEndpoint} from "./parser";
import {writeClientFile} from "./writer";
import {camelCase, capitalize, namespaceToTypeName} from "./utils";
import {RequestAuth} from "postman-collection";

interface SdkMethod {
    code: string;
    optionsType?: string;
    requestType?: string;
    responseType?: string;
}

interface MethodParts {
    funcName: string;
    reqTypeName: string;
    resTypeName: string;
    optionsTypeName: string;
    hasBody: boolean;
    hasOptions: boolean;
    hasResponse: boolean;
    paramMap: Map<string, string>;
    optionsMap: Map<string, string>;
    optionsType: string | undefined
}

interface GeneratedCode {
    importCode?: string;
    typesCode: string;
    classCode: string;
}


export async function generateSdk(config: SdkGenConfig): Promise<void> {
    if (!config.quiet) {
        console.log(`✨ Generating SDK from: ${config.collection}`);
        console.log(`📦 Output directory: ${config.output}`);
        console.log(`⚙️ Using ${config.useFetch ? "fetch" : "axios"}`);
    }

    const collection = await loadCollection(config.collection);
    const parsedCollection = extractEndpoints(collection);

    const generatedCode = generateCode(parsedCollection, config);

    const mainFileContents = config.singleFile ? generatedCode.importCode + generatedCode.typesCode +
        generatedCode.classCode : generatedCode.importCode + generatedCode.classCode;

    const indexFileLines: string[] = [];

    const clientFilePath = await writeClientFile(config.output, `${config.clientName}.ts`,
        mainFileContents);

    if (!config.quiet) {
        console.log(`✅ SDK written to ${clientFilePath}`);
        indexFileLines.push(`export * from "./${config.clientName}";`);
    }

    if (!config.singleFile) {
        const typesFilePath = await writeClientFile(config.output, `${config.clientName}Types.d.ts`,
            generatedCode.typesCode);

        indexFileLines.push(`export * from "./${config.clientName}Types";`);

        if (!config.quiet) {
            console.log(`✅ Types written to ${typesFilePath}`);
        }
    }

    const indexFilePath = await writeClientFile(config.output, "index.ts", indexFileLines.join("\n"));

    if (!config.quiet) {
        console.log(`✅ Index written to ${indexFilePath}`);
    }

}

export function extractMethodParts(endpoint: ParsedEndpoint): MethodParts {
    const funcName = camelCase(endpoint.name); // e.g. getUserById
    const namespacePart = endpoint.namespacePath.map(capitalize).join("");
    const reqTypeName = namespacePart + capitalize(funcName) + "Request";
    const resTypeName = namespacePart + capitalize(funcName) + "Response";
    const optionsTypeName = namespacePart + capitalize(funcName) + "Options";

    const hasBody = endpoint.method !== "GET" && endpoint.requestBody !== undefined;
    const hasOptions = endpoint.queryParams.length > 0;
    const hasResponse = !!endpoint.responseSample;

    const paramMap = new Map<string, string>();
    const optionsMap = new Map<string, string>();
    endpoint.pathParams.forEach(p => paramMap.set(p, camelCase(p)));
    endpoint.queryParams.forEach(p => optionsMap.set(p, camelCase(p)));

    const optionsTypeBody = hasOptions ?
        '{\n\t' + [...optionsMap].map(([_, camel]) => `${camel}?: string`).join(`,\n\t`) + '\n}' :
        undefined;
    const optionsType = optionsTypeBody ? "export interface " + optionsTypeName + " " + optionsTypeBody + "\n" : undefined;

    return {
        funcName, reqTypeName, resTypeName, optionsTypeName, hasBody, hasOptions, hasResponse, paramMap, optionsMap,
        optionsType
    };
}

export function generateAuthArgs(auth: RequestAuth): string[] {
    switch (auth.type) {
        case "basic":
            return ["username: string", "password: string"];
        case "bearer":
            return ["token: string"];
        case "apikey":
            return ["apiAuthKey: string", "apiAuthValue: string", "apiAuthAddTo: 'header' | 'query' = 'header'"];
        default:
            return [];
    }
}

export function generateFetchMethod(endpoint: ParsedEndpoint, collectionAuth: RequestAuth): SdkMethod {
    const {
        funcName, reqTypeName, resTypeName, optionsTypeName, hasBody, hasOptions, hasResponse, paramMap, optionsMap,
        optionsType
    } = extractMethodParts(endpoint);
    const args = Array.from(paramMap.entries()).map(([_, camel]) => `${camel}: string`);
    const authOverride = endpoint.effectiveAuth.type !== collectionAuth.type

    if (hasBody) args.push(`body: ${reqTypeName}`);
    if (authOverride) args.push(...generateAuthArgs(endpoint.effectiveAuth));
    if (hasOptions) args.push(`options?: ${optionsTypeName}`);


    const path = endpoint.url.path?.map(pathItem =>
        pathItem.replace(/:([a-zA-Z0-9_]+)(?=\/|$)/g, (_, name: string) => `\${${camelCase(name)}}`))
        .join('/');
    const pathExpr = `\`${path?.startsWith("/") ? path : "/" + path}\``;

    const preFetchExpressions: string[] = [];

    preFetchExpressions.push('const headers: Header = {' +
        '"Content-Type": "application/json"};');


    if (endpoint.queryParams.length > 0) {
        preFetchExpressions.push(`const urlSearchParams = new URLSearchParams();`);
        preFetchExpressions.push([...optionsMap].map(([name, camel]) => `if (options?.${camel}) { 
            urlSearchParams.set('${name}', options.${camel});
         }`).join("\n"));
        preFetchExpressions.push(`const url = ${pathExpr} + '?' + urlSearchParams.toString();`);
    } else {
        if (endpoint.effectiveAuth.type === "apikey") {
            if (authOverride) {
                preFetchExpressions.push('const urlSearchParams = (apiAuthAddTo === "query") ? new URLSearchParams() : null;)');
                preFetchExpressions.push('if (urlSearchParams) urlSearchParams.set(apiAuthKey, apiAuthValue);');
            } else {
                preFetchExpressions.push('const urlSearchParams = (self.apiAuthAddTo === "query") ? new URLSearchParams() : null;)');
                preFetchExpressions.push('if (urlSearchParams) urlSearchParams.set(self.apiAuthKey, self.apiAuthValue);');
            }
            preFetchExpressions.push(`const url = urlSearchParams ? ${pathExpr} + "?" + urlSearchParams.toString() : ${pathExpr};`);
        } else {
            preFetchExpressions.push(`const url = ${pathExpr};`);
        }
    }
    if (endpoint.effectiveAuth.type === "apikey") {
        if (authOverride) {
            preFetchExpressions.push('if (apiAuthAddTo === "header") headers[apiAuthKey] = apiAuthValue;\n');
        } else {
            preFetchExpressions.push('if (self.apiAuthAddTo === "header") headers[self.apiAuthKey] = self.apiAuthValue;\n');
        }
    }
    if (endpoint.effectiveAuth.type === "bearer") {
        if (authOverride) {
            preFetchExpressions.push('headers.Authorization = "Bearer " + token;');
        } else {
            preFetchExpressions.push('headers.Authorization = "Bearer " + self.token;');
        }
    }
    if (endpoint.effectiveAuth.type === "basic") {
        if (authOverride) {
            preFetchExpressions.push('const auth = isNode ? Buffer.from(username + ":" + password).toString("base64") : btoa(username + ":" + password);');
        } else {
            preFetchExpressions.push('const auth = isNode ? Buffer.from(self.username + ":" + self.password).toString("base64") : btoa(self.username + ":" + self.password);');
        }
        preFetchExpressions.push('headers.Authorization = "Basic " + auth;');
    }

    const bodyJson = hasBody ? jsonToBody(endpoint.requestBody!) : undefined;

    const fetchOpts = [
        `\tmethod: "${endpoint.method}"`,
        `\t\theaders: headers`,
        hasBody ? `\t\tbody: JSON.stringify(${bodyJson})` : null
    ].filter(Boolean).join(",\n    ");

    const code = `
  async ${funcName}(${args.join(", ")}): Promise<${hasResponse ? resTypeName : 'any'}> {
    ${preFetchExpressions.join("\n")}
    const res = await fetch(self.baseUrl + url, {
      ${fetchOpts}
    });
    return res.json();
  }`;

    const requestType = hasBody ? jsonToType(reqTypeName, endpoint.requestBody!) : undefined;
    const responseType = hasResponse ? jsonToType(resTypeName, endpoint.responseSample!) : undefined;

    return {code, optionsType, requestType, responseType};
}

export function generateAxiosMethod(endpoint: ParsedEndpoint, collectionAuth: RequestAuth): SdkMethod {
    const {
        funcName, reqTypeName, resTypeName, optionsTypeName, hasBody, hasOptions, hasResponse, paramMap,
        optionsType, optionsMap
    } = extractMethodParts(endpoint);

    const path = '/' + endpoint.url.path?.map(pathItem => pathItem
        .replace(/:([a-zA-Z0-9_]+)(?=\/|$)/g, (_, name: string) => `\${${camelCase(name)}}`))
        .join('/');
    const pathExpr = `\`${path}\``
    const authOverride = endpoint.effectiveAuth.type !== collectionAuth.type

    const preRequestExpressions: string[] = [];

    preRequestExpressions.push('const params: QueryParams = {};');
    preRequestExpressions.push('const headers: Header = {};');
    preRequestExpressions.push('headers.Accept = "application/json";');

    if (endpoint.queryParams.length > 0) {
        preRequestExpressions.push([...optionsMap].map(([name, camel]) => `if (options?.${camel}) { 
            params.${name} = options.${camel};
         }`).join("\n"));
    }

    if (endpoint.effectiveAuth.type === "apikey") {
        if (authOverride) {
            preRequestExpressions.push('if (apiAuthAddTo === "query") params[apiAuthKey] = apiAuthValue;');
            preRequestExpressions.push('if (apiAuthAddTo === "header") headers[apiAuthKey] = apiAuthValue;');
        } else {
            preRequestExpressions.push('if (self.apiAuthAddTo === "query") params[self.apiAuthKey] = self.apiAuthValue;');
            preRequestExpressions.push('if (self.apiAuthAddTo === "header") headers[self.apiAuthKey] = self.apiAuthValue;');
        }
    }
    if (endpoint.effectiveAuth.type === "bearer") {
        if (authOverride) {
            preRequestExpressions.push('headers.Authorization = "Bearer " + token;');
        } else {
            preRequestExpressions.push('headers.Authorization = "Bearer " + self.token;');
        }
    }
    if (endpoint.effectiveAuth.type === "basic") {
        if (authOverride) {
            preRequestExpressions.push('const auth = isNode ? Buffer.from(username + ":" + password).toString("base64") : btoa(username + ":" + password);');
        } else {
            preRequestExpressions.push('const auth = isNode ? Buffer.from(self.username + ":" + self.password).toString("base64") : btoa(self.username + ":" + self.password);');
        }
        preRequestExpressions.push('headers.Authorization = "Basic " + auth;');
    }

    preRequestExpressions.push('const axiosCallOpts: AxiosRequestConfig = {}');
    preRequestExpressions.push('if (Object.keys(params).length > 0) axiosCallOpts.params = params;');
    preRequestExpressions.push('axiosCallOpts.url = ' + pathExpr);
    preRequestExpressions.push('axiosCallOpts.method = "' + endpoint.method.toLowerCase() + '"');
    preRequestExpressions.push('axiosCallOpts.headers = headers');

    const args = [...paramMap.values()].map(p => `${p}: string`);
    if (hasBody) args.push(`body: ${reqTypeName}`);
    if (hasOptions) args.push(`options?: ${optionsTypeName}`);

    const bodyJson = hasBody ? jsonToBody(endpoint.requestBody!) : undefined;

    if (hasBody) preRequestExpressions.push(`axiosCallOpts.data = ${bodyJson};`);

    const code = `
    async ${funcName}(${args.join(", ")}): Promise<${hasResponse ? resTypeName : 'any'}> {
        ${preRequestExpressions.join("\n")}
        return self.axiosInstance.request(axiosCallOpts).then(res => res.data);
    }`;

    const requestType = hasBody ? jsonToType(reqTypeName, endpoint.requestBody!) : undefined;
    const responseType = hasResponse ? jsonToType(resTypeName, endpoint.responseSample!) : undefined;

    return {code, optionsType, requestType, responseType};
}

function jsonToType(name: string, json: string): string | undefined {
    try {
        const parsed = JSON.parse(json);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;

        const lines = Object.entries(parsed).map(([key, value]) => {
            const camel = camelCase(key);
            const tsType = inferType(value);
            return `  ${camel}: ${tsType};`;
        });

        return `export interface ${name} {\n${lines.join("\n")}\n}`;
    } catch (e) {
        return undefined;
    }
}

function jsonToBody(json: string): string | undefined {
    try {
        const parsed = JSON.parse(json);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
        const lines = Object.entries(parsed).map(([key, _]) => {
            const camel = camelCase(key);
            return `\t\t\t\t${key}: body.${camel},`;
        });
        return `{\n${lines.join("\n")}\n}`;
    } catch (e) {
        return undefined;
    }
}

function inferType(value: any): string {
    if (value === null) return "any";
    switch (typeof value) {
        case "string":
            return "string";
        case "number":
            return Number.isInteger(value) ? "number" : "number";
        case "boolean":
            return "boolean";
        case "object":
            if (Array.isArray(value)) {
                if (value.length === 0) return "any[]";
                return `${inferType(value[0])}[]`;
            }
            return "{ [key: string]: any }";
        default:
            return "any";
    }
}

type EndpointTree = {
    [namespace: string]: EndpointTree | ParsedEndpoint[];
};

function buildEndpointTree(endpoints: ParsedEndpoint[]): EndpointTree {
    const tree: EndpointTree = {};

    for (const ep of endpoints) {
        let current = tree;
        for (const part of ep.namespacePath) {
            if (!current[part]) current[part] = {};
            current = current[part] as EndpointTree;
        }
        if (!Array.isArray(current["_endpoints"])) current["_endpoints"] = [];
        (current["_endpoints"] as ParsedEndpoint[]).push(ep);
    }

    return tree;
}

function generateNamespaceTypes(
    config: SdkGenConfig,
    tree: EndpointTree,
    collectionAuth: RequestAuth,
    path: string[] = [],
): { interfaces: string[], topType: string } {
    const members: string[] = [];
    const interfaces: string[] = [];

    if (tree._endpoints) {
        for (const endpoint of tree._endpoints as ParsedEndpoint[]) {
            const {optionsType, requestType, responseType} = config.useFetch ? generateFetchMethod(endpoint,
                collectionAuth) : generateAxiosMethod(endpoint, collectionAuth);

            const funcName = camelCase(endpoint.name);
            const args = buildSdkArgs(endpoint,
                requestType ? namespaceToTypeName(path, funcName).replace("Namespace", "Request")
                    : null,
                optionsType ? namespaceToTypeName(path, funcName).replace("Namespace", "Options")
                    : null);
            const returnType = responseType
                ? namespaceToTypeName(path, funcName).replace("Namespace", "Response")
                : "any";

            members.push(`${funcName}(${args}): Promise<${returnType}>;`);

            if (requestType) interfaces.push(requestType);
            if (responseType) interfaces.push(responseType);
            if (optionsType) interfaces.push(optionsType);
        }
    }

    for (const [key, subtree] of Object.entries(tree)) {
        if (key === "_endpoints") continue;

        const childPath = [...path, key];
        const {interfaces: childInterfaces, topType} = generateNamespaceTypes(config, subtree as EndpointTree,
            collectionAuth, childPath);
        interfaces.push(...childInterfaces);
        members.push(`${key}: ${topType};`);
    }

    const currentType = namespaceToTypeName(path);
    const interfaceBody = `export interface ${currentType} {\n  ${members.join("\n  ")}\n}`;
    interfaces.push(interfaceBody);

    return {interfaces, topType: currentType};
}

function buildSdkArgs(endpoint: ParsedEndpoint, requestTypeName: string | null, optionsTypeName: string | null): string {
    const paramMap = new Map<string, string>();
    endpoint.pathParams.forEach(p => paramMap.set(p, camelCase(p)));

    const paramList = Array.from(paramMap.entries()).map(([_, camel]) => `${camel}: string`);
    if (requestTypeName) paramList.push(`body: ${requestTypeName}`);
    if (optionsTypeName) paramList.push(`options?: ${optionsTypeName}`);
    return paramList.join(", ");
}


function generateNamespaceObjectForClass(tree: EndpointTree, collectionAuth: RequestAuth, classProp: string, config: SdkGenConfig,
                                         indent = 2, root = false): string {
    const pad = "\t".repeat(indent);

    const lines: string[] = (root) ? [`this.${classProp} = {`] : [` {`];

    for (const [key, value] of Object.entries(tree)) {
        if (key === "_endpoints") {
            const methods = (value as ParsedEndpoint[])
                .map(e => config.useFetch ? generateFetchMethod(e, collectionAuth).code :
                    generateAxiosMethod(e, collectionAuth).code)
                .map(code => code.replace(/^/gm, pad + "  "))
                .join(",\n\n");
            lines.push(methods);
            continue;
        }

        const nested = generateNamespaceObjectForClass(value as EndpointTree, collectionAuth, key, config, indent + 1);
        lines.push(`${key}: ${nested},`);
    }

    lines.push(`${pad}}`);
    return lines.join("\n");
}

export function generateCode(parsedCollection: ParsedCollection, config: SdkGenConfig): GeneratedCode {
    const tree = buildEndpointTree(parsedCollection.endpoints);
    const {interfaces} = generateNamespaceTypes(config, tree, parsedCollection.auth);
    interfaces.push(`export interface Header { 
        [key: string]: string;
    }`);

    if (!config.useFetch) {
        interfaces.push(`export interface QueryParams { 
            [key: string]: string;
        }`)
    }

    const typeNames = interfaces.map(typeStr => {
        const match = typeStr.match(/export interface (\w+)/);
        return match ? match[1] : null;
    }).filter(Boolean) as string[];

    const constructorArgs: string[] = []
    const constructorFields: string[] = [];
    const constructorAssignments: string[] = [];

    constructorArgs.push('baseUrl: string');
    constructorAssignments.push('const self = this');
    constructorAssignments.push('this.baseUrl = baseUrl');

    switch (parsedCollection.auth.type) {
        case "basic":
            constructorArgs.push('username: string', 'password: string');
            constructorFields.push('private readonly username: string', 'private readonly password: string');
            constructorAssignments.push('this.username = username', 'this.password = password');
            break;
        case "bearer":
            constructorArgs.push('token: string');
            constructorFields.push('private readonly token: string');
            constructorAssignments.push('this.token = token');
            break;
        case "apikey":
            constructorArgs.push('apiAuthKey: string', 'apiAuthValue: string',
                'private apiAuthAddTo: "header" | "query" = "header"');
            constructorFields.push('private readonly apiAuthKey: string', 'private readonly apiAuthValue: string',
                'private readonly apiAuthAddTo: "header" | "query"');
            constructorAssignments.push('this.apiAuthKey = apiAuthKey', 'this.apiAuthValue = apiAuthValue',
                'this.apiAuthAddTo = apiAuthAddTo');
            break;
        case "noauth":
            break;
        default:
            throw new Error(`Unsupported auth type: ${parsedCollection.auth.type}`);
    }

    if (!config.useFetch) {
        constructorArgs.push(`axiosConfig?: AxiosRequestConfig`);
        constructorFields.push(`private readonly axiosInstance: AxiosInstance`);
        constructorAssignments.push('this.axiosInstance = axios.create({\n' +
            'baseURL: this.baseUrl,\n' +
            '...axiosConfig\n' +
            '});');
    }

    const constructorBody = Object.keys(tree)
        .map(ns => generateNamespaceObjectForClass(tree[ns] as EndpointTree, parsedCollection.auth, ns, config, 0, true))
        .join("\n");

    const readonlyFields = Object.keys(tree)
        .map(ns => `readonly ${ns}: ${namespaceToTypeName([ns])};`)
        .join("\n");

    const imports: string[] = [];

    imports.push("import { isNode } from 'browser-or-node';");

    if (!config.useFetch) {
        imports.push("import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';");
    }

    if (!config.singleFile) {
        imports.push(`import type { ${typeNames.join(", ")} } from './${config.clientName}Types';`);
    }

    const importCode = imports.join("\n");

    const typesCode = interfaces.join("\n\n");

    const classCode = `export class ${config.clientName} {
        ${readonlyFields}
        ${constructorFields.join("\n")}
        private readonly baseUrl: string;
        constructor(${constructorArgs.join(", ")}) {
            ${constructorAssignments.join("\n    ")}
            ${constructorBody.replace(/^/gm, "    ")}
        }
    }`

    return {importCode, typesCode, classCode};
}
