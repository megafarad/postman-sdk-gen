
export function camelCase(input: string): string {
    return input
        .toLowerCase()
        .split(/[^a-zA-Z0-9]+/) // split on non-alphanumeric characters
        .filter(Boolean)        // remove empty strings
        .filter(value => value.toUpperCase() !== 'A' && value.toUpperCase() !== 'AN' && value.toUpperCase() !== 'THE')
        .map((word, index) => {
            if (index === 0) return word;
            return word[0].toUpperCase() + word.slice(1);
        })
        .join('');
}

export function capitalize(input: string): string {
    if (!input || input.length === 0) return input;
    return input[0].toUpperCase() + input.slice(1);
}

export function pascalCase(str: string): string {
    return str
        .replace(/[-_]+/g, " ")
        .replace(/[^\w\s]/g, "")
        .replace(/\s+(.?)/g, (_, c) => c.toUpperCase())
        .replace(/^\w/, c => c.toUpperCase());
}

export function namespaceToTypeName(path: string[], methodName?: string): string {
    const nameParts = [...path, methodName || ""];
    return pascalCase(nameParts.join(" ")) + "Namespace";
}
