const HELP_TEXT = `apidoc-to-openapi

Convert apidoc comments from source code into an OpenAPI 3.0 document.

Usage:
  apidoc-to-openapi --src <dir> [options]

Options:
  -s, --src <dir>            Source directory for apidoc scanning (required)
  -o, --output <file>        Write output to a file; defaults to stdout
  -f, --format <json|yaml>   Output format (inferred from --output when omitted)
      --title <text>         Override OpenAPI info.title
      --api-version <text>   Override OpenAPI info.version
      --description <text>   Override OpenAPI info.description
      --server <url>         Add server URL (can be used multiple times)
      --include <list>       apidoc includeFilters, comma-separated
      --exclude <list>       apidoc excludeFilters, comma-separated
      --silent               Pass silent=true to apidoc
      --no-pretty            Minify JSON output
  -h, --help                 Show this help text

Examples:
  apidoc-to-openapi -s ./src -o ./openapi.yaml
  apidoc-to-openapi -s ./src -f json > openapi.json
  apidoc-to-openapi -s ./src --server https://api.example.com
`;

function requireValue(args, index, optionName) {
  const next = args[index + 1];
  if (!next || next.startsWith("-")) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return next;
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCliArgs(args) {
  const options = {
    src: "",
    output: "",
    format: "",
    title: "",
    apiVersion: "",
    description: "",
    servers: [],
    includeFilters: [],
    excludeFilters: [],
    silent: false,
    pretty: true,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "-s" || arg === "--src") {
      options.src = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "-o" || arg === "--output") {
      options.output = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "-f" || arg === "--format") {
      const value = requireValue(args, index, arg).toLowerCase();
      if (value !== "json" && value !== "yaml" && value !== "yml") {
        throw new Error(`Unsupported format: ${value}`);
      }
      options.format = value === "yml" ? "yaml" : value;
      index += 1;
      continue;
    }

    if (arg === "--title") {
      options.title = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--api-version") {
      options.apiVersion = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--description") {
      options.description = requireValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--server") {
      options.servers.push(requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--include") {
      options.includeFilters.push(...splitList(requireValue(args, index, arg)));
      index += 1;
      continue;
    }

    if (arg === "--exclude") {
      options.excludeFilters.push(...splitList(requireValue(args, index, arg)));
      index += 1;
      continue;
    }

    if (arg === "--silent") {
      options.silent = true;
      continue;
    }

    if (arg === "--no-pretty") {
      options.pretty = false;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.format === "" && options.output) {
    const lower = options.output.toLowerCase();
    if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
      options.format = "yaml";
    } else {
      options.format = "json";
    }
  }

  if (options.format === "") {
    options.format = "json";
  }

  return options;
}

export function printHelp() {
  process.stdout.write(`${HELP_TEXT}\n`);
}
