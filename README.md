# apidoc-to-openapi

[![npm version](https://img.shields.io/npm/v/apidoc-to-openapi.svg)](https://www.npmjs.com/package/apidoc-to-openapi)
[![license](https://img.shields.io/npm/l/apidoc-to-openapi.svg)](https://github.com/keleus/apidoc-to-openapi/blob/main/package.json)

A CLI utility that scans source files with `apidoc` and converts parsed apidoc metadata into an OpenAPI 3.0 document (`json` or `yaml`).

## Install

```bash
npm install apidoc-to-openapi
```

You can run it directly with:

```bash
npx apidoc-to-openapi --src ./src --output ./openapi.yaml
```

Or after a global/local link:

```bash
apidoc-to-openapi --src ./src --output ./openapi.yaml
```

For local development in this repository:

```bash
npm install
```

## Usage

```bash
apidoc-to-openapi --src <dir> [options]
```

### Options

- `-s, --src <dir>`: Source directory for apidoc scanning (required).
- `-o, --output <file>`: Output file path. When omitted, writes to stdout.
- `--apidoc-output <file>`: Write the raw parsed apidoc `{ data, project }` object as JSON. Omitted by default.
- `-f, --format <json|yaml>`: Output format. Auto-detected from output extension when omitted.
- `--title <text>`: Override `info.title`.
- `--api-version <text>`: Override `info.version`.
- `--description <text>`: Override `info.description`.
- `--server <url>`: Add server URL (repeatable).
- `--include <list>`: `apidoc` include filters, comma-separated.
- `--exclude <list>`: `apidoc` exclude filters, comma-separated.
- `--silent`: Silence apidoc log output.
- `--no-pretty`: Minified JSON output.
- `-h, --help`: Show help.

## Examples

Generate YAML file:

```bash
apidoc-to-openapi --src ./src --output ./openapi.yaml
```

Generate JSON to stdout:

```bash
apidoc-to-openapi --src ./src --format json > openapi.json
```

Generate OpenAPI and raw parsed apidoc JSON together:

```bash
apidoc-to-openapi \
  --src ./src \
  --output ./openapi.yaml \
  --apidoc-output ./apidoc.json
```

Override OpenAPI info:

```bash
apidoc-to-openapi \
  --src ./src \
  --output ./openapi.yaml \
  --title "My Service API" \
  --api-version "2.1.0" \
  --server "https://api.example.com"
```

## Notes

- This converter targets common apidoc tags (`@api`, `@apiParam`, `@apiSuccess`, `@apiError`, `@apiHeader`).
- The generated schema is best-effort for nested field names and array notation (for example `items[].id`).
- Array-like type hints such as `Array`, `List`, `ArrayList`, `List<String>`, `Array<Object>` are recognized, and child fields like `data.id` are mapped to array item properties.
- Common Java types are mapped to OpenAPI schemas, including `Integer`/`Long`, `Float`/`Double`, `BigInteger`/`BigDecimal`, `List`/`Set`, and `Map`. Generic types such as `List<Long>` and `Map<String, Double>` are supported.
- Unrecognized Java class names such as `UserVO` or `com.example.dto.UserDTO` are treated as `object`; types with declared enum values remain primitive OpenAPI enums.
- Description prefixes like `[direct|直销,distribution|分销] 销售方式` are parsed into OpenAPI `enum` (using the value before `|`) and optional `x-enumDescriptions`.
- `apidoc` project metadata fields (`baseurl`, `baseUrl`, `url`) are used as a base path prefix for every OpenAPI path (for example `/dapi/v2/prodev` + `/task_service/sync_task_to_feishu_bitable`).
- Every operation automatically includes a header parameter `App-Code` with default placeholder `{{app-code}}` (unless already defined).
- If `apidoc` parsing fails, the CLI exits with a non-zero status.
