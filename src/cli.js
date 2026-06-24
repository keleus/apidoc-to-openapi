import fs from "node:fs/promises";
import path from "node:path";

import { createDoc } from "apidoc";

import { apidocDataToOpenApi, serializeOpenApi } from "./converter.js";
import { parseCliArgs, printHelp } from "./options.js";

function parsePossiblyJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (
    !(trimmed.startsWith("{") || trimmed.startsWith("["))
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function buildApidocConfig(options) {
  const config = {
    src: path.resolve(process.cwd(), options.src),
    dryRun: true,
    silent: options.silent,
  };

  if (options.includeFilters.length > 0) {
    config.includeFilters = options.includeFilters;
  }

  if (options.excludeFilters.length > 0) {
    config.excludeFilters = options.excludeFilters;
  }

  return config;
}

async function writeOutput(outputPath, content) {
  const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
  const outputDir = path.dirname(absoluteOutputPath);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(absoluteOutputPath, content, "utf8");
}

export async function runCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n\n`);
    printHelp();
    return 1;
  }

  if (options.help) {
    printHelp();
    return 0;
  }

  if (!options.src) {
    process.stderr.write("Error: --src is required.\n\n");
    printHelp();
    return 1;
  }

  try {
    const apidocConfig = buildApidocConfig(options);
    const doc = createDoc(apidocConfig);

    if (doc === false || typeof doc !== "object") {
      process.stderr.write("Error: apidoc parsing failed.\n");
      return 2;
    }

    const openApi = apidocDataToOpenApi({
      docData: parsePossiblyJson(doc.data),
      project: parsePossiblyJson(doc.project),
      title: options.title,
      apiVersion: options.apiVersion,
      description: options.description,
      servers: options.servers,
    });

    const content = serializeOpenApi(openApi, options.format, options.pretty);

    if (options.output) {
      await writeOutput(options.output, content);
      process.stdout.write(
        `OpenAPI document written to ${path.resolve(process.cwd(), options.output)}\n`,
      );
      return 0;
    }

    process.stdout.write(content);
    if (!content.endsWith("\n")) {
      process.stdout.write("\n");
    }
    return 0;
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    return 2;
  }
}
