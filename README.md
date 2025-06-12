# Postman TypeScript SDK Generator

Generate a fully-typed TypeScript SDK from a Postman collection, with support for Axios or Fetch, folder-based namespacing, and auto-inferred types.

## ✨ Features

* 🔌 **Input**: Supports Postman Collection v2.1
* 📦 **Output**: TypeScript SDK with methods, namespaces, and inferred request/response types
* ⚡ **Transport**: Axios (default) or Fetch
* 🔒 **Authentication**: Auto-parses Postman auth schemes (Bearer, API Key, Basic Auth)
* 🧠 **Type Inference**: Generates interfaces for bodies and responses
* 🗂️ **Folder-Based Namespacing**: Postman folders become nested namespaces
* 🧾 **.d.ts Generation**: Optional separate type declarations for consumption in JS projects

## 🚀 Getting Started

### 1. Install

```bash
npm install -g @sirhc77/postman-sdk-gen
```

### 2. Generate SDK

```bash
postman-sdk-gen ./collection.json \
  --output ./sdk \
  --client-name ApiClient \
  --use-fetch \
```

### CLI Options

| Flag            | Description                                    |
|-----------------|------------------------------------------------|
| `--output`      | Output directory (default: `./sdk`)            |
| `--client-name` | Name of generated class (default: `ApiClient`) |
| `--use-fetch`   | Use native fetch instead of Axios              |
| `--single-file` | Generate one file instead of multi-file        |
| --quiet         | Supress logs                                   |
| --version       | Show version                                   |

## 🧪 Sample Usage

```ts
import { ApiClient } from './sdk/ApiClient';

const client = new ApiClient('https://api.example.com', '<your username>', '<your password>');

const res = await client.users.getCurrentUser();
```

## 📁 Namespacing

A Postman folder structure like:

```
- Space Management
  - Phone Numbers
    - List All
```

…generates:

```ts
client.spaceManagement.phoneNumbers.listAll();
```

## 🔒 Authentication

Postman `auth` sections are auto-detected. Supported:

* Bearer token`
* API key
* Basic Auth

## 🛠️ Contributing

* Clone the repo
* Run locally with `ts-node` or build with `tsc`
* Use `examples/*.postman_collection.json` to test

## 📄 License

MIT License
