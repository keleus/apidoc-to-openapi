import YAML from "yaml";

const VALID_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

const BODYLESS_METHODS = new Set(["get", "head", "delete", "options", "trace"]);

const TYPE_MAP = {
  string: { type: "string" },
  number: { type: "number" },
  integer: { type: "integer" },
  int: { type: "integer" },
  long: { type: "integer" },
  float: { type: "number" },
  double: { type: "number" },
  boolean: { type: "boolean" },
  bool: { type: "boolean" },
  object: { type: "object", properties: {} },
  array: { type: "array", items: { type: "string" } },
  file: { type: "string", format: "binary" },
  date: { type: "string", format: "date" },
  datetime: { type: "string", format: "date-time" },
  "date-time": { type: "string", format: "date-time" },
};

const ARRAY_TYPE_ALIASES = new Set([
  "array",
  "list",
  "arraylist",
  "linkedlist",
  "set",
  "hashset",
]);

const OBJECT_TYPE_ALIASES = new Set([
  "object",
  "map",
  "hashmap",
  "linkedhashmap",
  "dictionary",
  "dict",
  "record",
]);

const DEFAULT_APP_CODE_HEADER = {
  name: "App-Code",
  in: "header",
  required: false,
  schema: {
    type: "string",
    default: "{{app-code}}",
  },
};

function sanitizeText(input) {
  if (typeof input !== "string" || input.trim() === "") {
    return "";
  }

  const noTags = input.replace(/<[^>]*>/g, " ");
  return noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toOpenApiPath(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return "/";
  }

  const withoutQuery = url.split("?")[0].trim();
  const withLeadingSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;

  return withLeadingSlash.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function extractPathParams(pathname) {
  const names = [];
  const pattern = /\{([^}]+)\}/g;
  let match = pattern.exec(pathname);

  while (match) {
    names.push(match[1]);
    match = pattern.exec(pathname);
  }

  return names;
}

function normalizeFieldName(fieldName) {
  if (typeof fieldName !== "string") {
    return "";
  }
  return fieldName.trim().replace(/^:/, "");
}

function normalizePathParamField(fieldName) {
  return normalizeFieldName(fieldName)
    .replace(/\[\]$/g, "")
    .split(".")[0];
}

function normalizeTypeToken(typeName) {
  if (typeof typeName !== "string") {
    return "";
  }

  const trimmed = typeName.trim().replace(/\?/g, "");
  if (!trimmed) {
    return "";
  }

  const parts = trimmed.split(".");
  const token = parts[parts.length - 1] || trimmed;
  return token.trim().toLowerCase();
}

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function splitTopLevel(input, separator) {
  const parts = [];
  let buffer = "";
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (const char of `${input}`) {
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    }

    if (
      char === separator &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0
    ) {
      const part = buffer.trim();
      if (part) {
        parts.push(part);
      }
      buffer = "";
      continue;
    }

    buffer += char;
  }

  const tail = buffer.trim();
  if (tail) {
    parts.push(tail);
  }

  return parts;
}

function peelArraySuffix(typeExpression) {
  let expression = `${typeExpression}`.trim();
  let depth = 0;

  while (expression.endsWith("[]")) {
    depth += 1;
    expression = expression.slice(0, -2).trim();
  }

  return { expression, depth };
}

function splitGenericType(typeExpression) {
  const source = `${typeExpression}`.trim();
  const ltIndex = source.indexOf("<");
  if (ltIndex === -1) {
    return null;
  }

  let depth = 0;
  let closeIndex = -1;
  for (let index = ltIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "<") {
      depth += 1;
    } else if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        closeIndex = index;
        break;
      }
    }
  }

  if (closeIndex === -1) {
    return null;
  }

  if (source.slice(closeIndex + 1).trim() !== "") {
    return null;
  }

  const outer = source.slice(0, ltIndex).trim().replace(/\.$/, "");
  const inner = source.slice(ltIndex + 1, closeIndex).trim();
  if (!outer || !inner) {
    return null;
  }

  return { outer, inner };
}

function schemaFromTypeCore(typeExpression) {
  const generic = splitGenericType(typeExpression);
  if (generic) {
    const outer = normalizeTypeToken(generic.outer);
    const genericArgs = splitTopLevel(generic.inner, ",");

    if (ARRAY_TYPE_ALIASES.has(outer)) {
      const itemType = genericArgs[0] || "string";
      return {
        type: "array",
        items: schemaFromTypeExpression(itemType),
      };
    }

    if (OBJECT_TYPE_ALIASES.has(outer)) {
      const schema = { type: "object", properties: {} };
      if (genericArgs.length >= 2) {
        schema.additionalProperties = schemaFromTypeExpression(genericArgs[1]);
      }
      return schema;
    }
  }

  const normalized = normalizeTypeToken(typeExpression);
  if (ARRAY_TYPE_ALIASES.has(normalized)) {
    return { type: "array", items: { type: "string" } };
  }
  if (OBJECT_TYPE_ALIASES.has(normalized)) {
    return { type: "object", properties: {} };
  }

  if (TYPE_MAP[normalized]) {
    return safeClone(TYPE_MAP[normalized]);
  }

  return { type: "string" };
}

function schemaFromTypeExpression(typeName) {
  if (typeof typeName !== "string" || typeName.trim() === "") {
    return { type: "string" };
  }

  let expression = typeName.trim();
  const unionParts = splitTopLevel(expression, "|");
  if (unionParts.length > 1) {
    expression = unionParts[0];
  }

  const { expression: peeledExpression, depth: arrayDepth } = peelArraySuffix(
    expression,
  );
  let schema = schemaFromTypeCore(peeledExpression);

  for (let index = 0; index < arrayDepth; index += 1) {
    schema = { type: "array", items: schema };
  }

  return schema;
}

function parseAllowedValues(raw) {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.filter((item) => item !== undefined && item !== null);
  }

  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function parseEnumToken(token) {
  const text = `${token || ""}`.trim();
  if (!text) {
    return null;
  }

  const [rawValue, ...labelParts] = text.split("|");
  const valueText = `${rawValue || ""}`.trim();
  if (!valueText) {
    return null;
  }

  const label = labelParts.join("|").trim();
  return {
    value: parsePrimitive(valueText),
    description: label || "",
  };
}

function dedupeEnumEntries(entries) {
  const unique = [];
  const seen = new Set();

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    const value = entry.value;
    const key = `${typeof value}:${JSON.stringify(value)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
  }

  return unique;
}

function parseEnumEntries(raw) {
  if (!raw) {
    return [];
  }

  const entries = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        entries.push(parseEnumToken(item));
      } else if (item !== undefined && item !== null) {
        entries.push({ value: item, description: "" });
      }
    }
    return dedupeEnumEntries(entries);
  }

  if (typeof raw === "string") {
    const tokens = raw
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const token of tokens) {
      entries.push(parseEnumToken(token));
    }
    return dedupeEnumEntries(entries);
  }

  return [];
}

function extractEnumPrefixFromDescription(rawDescription) {
  if (typeof rawDescription !== "string") {
    return null;
  }

  const trimmed = sanitizeText(rawDescription);
  if (!trimmed.startsWith("[")) {
    return null;
  }

  const match = trimmed.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!match) {
    return null;
  }

  const enumEntries = parseEnumEntries(match[1]);
  if (enumEntries.length === 0) {
    return null;
  }

  return {
    entries: enumEntries,
    description: match[2]?.trim() || "",
  };
}

function applyEnumToSchema(schema, enumEntries) {
  if (!schema || !Array.isArray(enumEntries) || enumEntries.length === 0) {
    return;
  }

  const target =
    schema.type === "array"
      ? (() => {
          if (!schema.items || typeof schema.items !== "object" || Array.isArray(schema.items)) {
            schema.items = { type: "string" };
          }
          return schema.items;
        })()
      : schema;

  target.enum = enumEntries.map((entry) => entry.value);
  const enumDescriptions = enumEntries.map((entry) => entry.description || "");
  if (enumDescriptions.some((value) => value !== "")) {
    target["x-enumDescriptions"] = enumDescriptions;
  }
}

function parsePrimitive(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return trimmed;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function schemaFromField(field) {
  const base = schemaFromTypeExpression(field.type);

  const allowedEntries = parseEnumEntries(field.allowedValues);
  const enumInDescription = extractEnumPrefixFromDescription(field.description);
  const enumEntries =
    allowedEntries.length > 0
      ? allowedEntries
      : enumInDescription?.entries || [];
  applyEnumToSchema(base, enumEntries);

  if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") {
    base.default = parsePrimitive(field.defaultValue);
  }

  const descriptionSource =
    enumInDescription && enumInDescription.description
      ? enumInDescription.description
      : enumInDescription
        ? ""
        : field.description;
  const description = sanitizeText(descriptionSource);
  if (description) {
    base.description = description;
  }

  return base;
}

function splitFieldPath(fieldName) {
  return normalizeFieldName(fieldName)
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      if (segment.endsWith("[]")) {
        return { key: segment.slice(0, -2), isArray: true };
      }
      return { key: segment, isArray: false };
    });
}

function ensureObjectSchema(target) {
  if (!target.type) {
    target.type = "object";
  }
  if (target.type !== "object") {
    target.type = "object";
  }
  if (!target.properties) {
    target.properties = {};
  }
  return target;
}

function ensureRequiredList(target) {
  if (!target.required) {
    target.required = [];
  }
  return target.required;
}

function markRequired(target, key) {
  const required = ensureRequiredList(target);
  if (!required.includes(key)) {
    required.push(key);
  }
}

function ensureArrayItemsObject(schema) {
  if (!schema.items || typeof schema.items !== "object" || Array.isArray(schema.items)) {
    schema.items = { type: "object", properties: {} };
  }
  ensureObjectSchema(schema.items);
  return schema.items;
}

function mergeObjectSchemas(existing, incoming) {
  const merged = { ...existing, ...incoming, type: "object" };
  const existingProperties =
    existing?.properties && typeof existing.properties === "object"
      ? existing.properties
      : {};
  const incomingProperties =
    incoming?.properties && typeof incoming.properties === "object"
      ? incoming.properties
      : {};

  const propertyNames = new Set([
    ...Object.keys(existingProperties),
    ...Object.keys(incomingProperties),
  ]);

  if (propertyNames.size > 0) {
    merged.properties = {};
    for (const name of propertyNames) {
      const left = existingProperties[name];
      const right = incomingProperties[name];
      if (left && right) {
        merged.properties[name] = mergeLeafSchemas(left, right);
      } else {
        merged.properties[name] = safeClone(right || left);
      }
    }
  } else if (!merged.properties) {
    merged.properties = {};
  }

  const required = new Set([
    ...(Array.isArray(existing?.required) ? existing.required : []),
    ...(Array.isArray(incoming?.required) ? incoming.required : []),
  ]);
  if (required.size > 0) {
    merged.required = Array.from(required);
  }

  return merged;
}

function mergeLeafSchemas(existing, incoming) {
  if (!existing) {
    return safeClone(incoming);
  }

  if (existing.type === "array" && incoming.type === "array") {
    const merged = { ...existing, ...incoming };
    const leftItems =
      existing.items && typeof existing.items === "object"
        ? existing.items
        : { type: "object", properties: {} };
    const rightItems =
      incoming.items && typeof incoming.items === "object"
        ? incoming.items
        : { type: "object", properties: {} };
    merged.items = mergeLeafSchemas(leftItems, rightItems);
    return merged;
  }

  if (existing.type === "array" && incoming.type === "object") {
    const merged = { ...existing };
    const leftItems =
      existing.items && typeof existing.items === "object"
        ? existing.items
        : { type: "object", properties: {} };
    merged.items = mergeLeafSchemas(leftItems, incoming);
    return merged;
  }

  if (existing.type === "object" && incoming.type === "array") {
    const promoted = { ...incoming };
    const rightItems =
      incoming.items && typeof incoming.items === "object"
        ? incoming.items
        : { type: "object", properties: {} };
    promoted.items = mergeLeafSchemas(existing, rightItems);
    return promoted;
  }

  if (existing.type === "object" && incoming.type === "object") {
    return mergeObjectSchemas(existing, incoming);
  }

  return { ...existing, ...incoming };
}

function resolveTraversalSchema(schema, preferArrayTraversal) {
  if (preferArrayTraversal) {
    if (schema.type !== "array") {
      if (schema.type === "object") {
        return { type: "array", items: safeClone(schema) };
      }
      return { type: "array", items: { type: "object", properties: {} } };
    }
    return schema;
  }
  return schema;
}

function assignFieldToSchema(rootSchema, field) {
  const segments = splitFieldPath(field.field);
  if (segments.length === 0) {
    return;
  }

  let current = ensureObjectSchema(rootSchema);
  const fieldSchema = schemaFromField(field);
  const isRequired = field.optional === false || field.optional === "false";

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;

    if (!segment.key) {
      continue;
    }

    if (isLast) {
      const incoming = segment.isArray
        ? { type: "array", items: fieldSchema }
        : fieldSchema;
      current.properties[segment.key] = mergeLeafSchemas(
        current.properties[segment.key],
        incoming,
      );
      if (isRequired) {
        markRequired(current, segment.key);
      }
      continue;
    }

    const existing = current.properties[segment.key];
    const base =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing
        : { type: "object", properties: {} };
    const resolved = resolveTraversalSchema(base, segment.isArray);
    current.properties[segment.key] = resolved;

    if (resolved.type === "array") {
      current = ensureArrayItemsObject(resolved);
    } else {
      current = ensureObjectSchema(resolved);
    }
  }
}

function fieldPathDepth(fieldName) {
  return splitFieldPath(fieldName).length;
}

function fieldsToObjectSchema(fields) {
  const schema = { type: "object", properties: {} };
  const sorted = [...fields].sort((left, right) => {
    const depthDiff = fieldPathDepth(left.field) - fieldPathDepth(right.field);
    if (depthDiff !== 0) {
      return depthDiff;
    }
    return normalizeFieldName(left.field).localeCompare(normalizeFieldName(right.field));
  });

  for (const field of sorted) {
    if (!field || typeof field !== "object" || !field.field) {
      continue;
    }
    assignFieldToSchema(schema, field);
  }

  return schema;
}

function extractFieldEntries(fieldGroups) {
  if (!fieldGroups || typeof fieldGroups !== "object") {
    return [];
  }

  const entries = [];
  for (const [groupName, groupFields] of Object.entries(fieldGroups)) {
    if (!Array.isArray(groupFields)) {
      continue;
    }
    for (const field of groupFields) {
      if (!field || typeof field !== "object") {
        continue;
      }
      entries.push({ ...field, _group: groupName });
    }
  }

  return entries;
}

function classifyParamLocation(field, method, pathParamNames) {
  const groupName = `${field._group || field.group || ""}`.toLowerCase();
  const normalizedField = normalizePathParamField(field.field);

  if (pathParamNames.has(normalizedField)) {
    return "path";
  }
  if (groupName.includes("header")) {
    return "header";
  }
  if (groupName.includes("query")) {
    return "query";
  }
  if (groupName.includes("path")) {
    return "path";
  }
  if (groupName.includes("body") || groupName.includes("payload") || groupName.includes("form")) {
    return "body";
  }
  if (BODYLESS_METHODS.has(method)) {
    return "query";
  }
  return "body";
}

function toParameter(field, location) {
  let name = normalizeFieldName(field.field);
  let schema = schemaFromField(field);

  if (name.endsWith("[]")) {
    name = name.slice(0, -2);
    schema = { type: "array", items: schema };
  }

  const parameter = {
    name,
    in: location,
    required: location === "path" ? true : !(field.optional === true || field.optional === "true"),
    schema,
  };

  const description = sanitizeText(field.description);
  if (description) {
    parameter.description = description;
  }

  return parameter;
}

function parseExamplePayload(content) {
  if (typeof content !== "string") {
    return undefined;
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidates = [trimmed];
  const jsonStart = trimmed.search(/[\[{]/);
  if (jsonStart > 0) {
    candidates.push(trimmed.slice(jsonStart));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }

  return undefined;
}

function extractStatusCode(raw, fallback) {
  const source = typeof raw === "string" ? raw : "";
  const match = source.match(/\b([1-5]\d{2})\b/);
  if (match) {
    return match[1];
  }
  return fallback;
}

function addExamplesToResponses(responses, examples, fallbackStatus, fallbackDescription) {
  if (!Array.isArray(examples)) {
    return;
  }

  for (const example of examples) {
    const payload = parseExamplePayload(example?.content);
    if (payload === undefined) {
      continue;
    }

    const status = extractStatusCode(example?.title, fallbackStatus);
    if (!responses[status]) {
      responses[status] = { description: fallbackDescription };
    }

    if (!responses[status].content) {
      responses[status].content = {};
    }

    if (!responses[status].content["application/json"]) {
      responses[status].content["application/json"] = {};
    }

    responses[status].content["application/json"].example = payload;
  }
}

function appendFieldResponses(responses, fieldGroups, fallbackStatus, fallbackDescription) {
  if (!fieldGroups || typeof fieldGroups !== "object") {
    return false;
  }

  let added = false;
  for (const [groupName, fields] of Object.entries(fieldGroups)) {
    if (!Array.isArray(fields)) {
      continue;
    }

    const status = extractStatusCode(groupName, fallbackStatus);
    const response = {
      description: sanitizeText(groupName) || fallbackDescription,
    };

    if (fields.length > 0) {
      response.content = {
        "application/json": {
          schema: fieldsToObjectSchema(fields),
        },
      };
    }

    responses[status] = response;
    added = true;
  }

  return added;
}

function buildResponses(endpoint) {
  const responses = {};

  appendFieldResponses(
    responses,
    endpoint?.success?.fields,
    "200",
    "Successful response",
  );
  appendFieldResponses(
    responses,
    endpoint?.error?.fields,
    "400",
    "Error response",
  );

  addExamplesToResponses(
    responses,
    endpoint?.success?.examples,
    "200",
    "Successful response",
  );
  addExamplesToResponses(
    responses,
    endpoint?.error?.examples,
    "400",
    "Error response",
  );

  if (Object.keys(responses).length === 0) {
    responses["200"] = { description: "Successful response" };
  }

  return responses;
}

function dedupeParameters(parameters) {
  const deduped = [];
  const seen = new Set();
  for (const parameter of parameters) {
    const location = `${parameter.in || ""}`.toLowerCase();
    const parameterName = `${parameter.name || ""}`;
    const normalizedName =
      location === "header" ? parameterName.toLowerCase() : parameterName;
    const key = `${location}:${normalizedName}`;
    if (seen.has(key)) {
      continue;
    }
    deduped.push(parameter);
    seen.add(key);
  }
  return deduped;
}

function cloneDefaultAppCodeHeader() {
  return {
    ...DEFAULT_APP_CODE_HEADER,
    schema: { ...DEFAULT_APP_CODE_HEADER.schema },
  };
}

function ensureAppCodeHeader(parameters) {
  const existing = parameters.find(
    (parameter) =>
      `${parameter?.in || ""}`.toLowerCase() === "header" &&
      `${parameter?.name || ""}`.toLowerCase() === "app-code",
  );

  if (!existing) {
    parameters.push(cloneDefaultAppCodeHeader());
    return;
  }

  if (!existing.schema || typeof existing.schema !== "object" || Array.isArray(existing.schema)) {
    existing.schema = { type: "string" };
  }

  if (!existing.schema.type) {
    existing.schema.type = "string";
  }

  if (existing.schema.default === undefined) {
    existing.schema.default = DEFAULT_APP_CODE_HEADER.schema.default;
  }
}

function buildParametersAndRequestBody(endpoint, method, pathname) {
  const pathParamNames = new Set(extractPathParams(pathname));
  const allParamFields = [
    ...extractFieldEntries(endpoint?.header?.fields),
    ...extractFieldEntries(endpoint?.parameter?.fields),
  ];

  const parameters = [];
  const bodyFields = [];

  for (const field of allParamFields) {
    const location = classifyParamLocation(field, method, pathParamNames);
    if (location === "body") {
      bodyFields.push(field);
    } else {
      parameters.push(toParameter(field, location));
    }
  }
  ensureAppCodeHeader(parameters);

  const requestBody = bodyFields.length
    ? {
        required: bodyFields.some(
          (field) => !(field.optional === true || field.optional === "true"),
        ),
        content: {
          "application/json": {
            schema: fieldsToObjectSchema(bodyFields),
          },
        },
      }
    : undefined;

  const example = parseExamplePayload(endpoint?.parameter?.examples?.[0]?.content);
  if (requestBody && example !== undefined) {
    requestBody.content["application/json"].example = example;
  }

  return {
    parameters: dedupeParameters(parameters),
    requestBody,
  };
}

function extractEndpoints(docData) {
  if (Array.isArray(docData)) {
    return docData;
  }

  if (docData && Array.isArray(docData.api)) {
    return docData.api;
  }

  if (docData && typeof docData === "object") {
    const endpoints = [];
    for (const value of Object.values(docData)) {
      if (!Array.isArray(value)) {
        continue;
      }
      endpoints.push(...value);
    }
    return endpoints;
  }

  return [];
}

function toOperationIdPart(value) {
  const text = sanitizeText(value);
  if (!text) {
    return "";
  }

  return text.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function toOperationId(endpoint, method, pathname, seen) {
  const groupPart = toOperationIdPart(endpoint?.group);
  const namePart = toOperationIdPart(endpoint?.name);
  const pathPart = `${method}_${pathname.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_")}`;
  const baseRaw =
    groupPart && namePart
      ? `${groupPart}_${namePart}`
      : namePart || pathPart;
  const base = baseRaw.replace(/^_+|_+$/g, "") || `${method}_operation`;

  let candidate = base;
  let suffix = 2;
  while (seen.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  seen.add(candidate);
  return candidate;
}

function toTags(endpoints) {
  const tags = new Map();
  for (const endpoint of endpoints) {
    const group = sanitizeText(endpoint?.group);
    if (!group) {
      continue;
    }
    if (!tags.has(group)) {
      tags.set(group, { name: group });
    }
  }
  return Array.from(tags.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeServerList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (const value of values) {
    const url = `${value || ""}`.trim();
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    normalized.push(url);
  }

  return normalized;
}

function normalizeBasePathValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  let candidate = value.trim();
  if (!candidate) {
    return "";
  }

  try {
    if (/^[A-Za-z][A-Za-z0-9+\-.]*:\/\//.test(candidate)) {
      const parsedUrl = new URL(candidate);
      candidate = parsedUrl.pathname || "";
    }
  } catch {
    // Ignore URL parse errors and keep original candidate.
  }

  candidate = candidate.split("?")[0].split("#")[0].trim();
  if (!candidate || candidate === "/") {
    return "";
  }

  const withLeadingSlash = candidate.startsWith("/") ? candidate : `/${candidate}`;
  const normalized = withLeadingSlash.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized === "/" ? "" : normalized;
}

function readProjectBasePath(project) {
  if (!project || typeof project !== "object") {
    return "";
  }

  const candidates = [project.baseurl, project.baseUrl, project.url];
  for (const candidate of candidates) {
    const basePath = normalizeBasePathValue(candidate);
    if (basePath) {
      return basePath;
    }
  }

  return "";
}

function joinBasePath(basePath, endpointPath) {
  const normalizedEndpointPath = toOpenApiPath(endpointPath);
  if (!basePath) {
    return normalizedEndpointPath;
  }

  if (
    normalizedEndpointPath === basePath ||
    normalizedEndpointPath.startsWith(`${basePath}/`)
  ) {
    return normalizedEndpointPath;
  }

  if (normalizedEndpointPath === "/") {
    return basePath;
  }

  return `${basePath}/${normalizedEndpointPath.replace(/^\/+/, "")}`.replace(/\/+/g, "/");
}

export function apidocDataToOpenApi({
  docData,
  project = {},
  title = "",
  apiVersion = "",
  description = "",
  servers = [],
} = {}) {
  const endpoints = extractEndpoints(docData);
  const openapi = {
    openapi: "3.0.3",
    info: {
      title: title || sanitizeText(project.title) || sanitizeText(project.name) || "API",
      version: apiVersion || sanitizeText(project.version) || "1.0.0",
    },
    paths: {},
  };

  const infoDescription =
    description || sanitizeText(project.description) || sanitizeText(project.header?.description);
  if (infoDescription) {
    openapi.info.description = infoDescription;
  }

  const explicitServers = normalizeServerList(servers);
  if (explicitServers.length > 0) {
    openapi.servers = explicitServers.map((url) => ({ url }));
  }

  const projectBasePath = readProjectBasePath(project);
  const operationIds = new Set();
  for (const endpoint of endpoints) {
    const method = `${endpoint?.type || ""}`.toLowerCase();
    if (!VALID_METHODS.has(method)) {
      continue;
    }

    const pathname = joinBasePath(projectBasePath, endpoint.url);
    if (!openapi.paths[pathname]) {
      openapi.paths[pathname] = {};
    }

    const operation = {
      operationId: toOperationId(endpoint, method, pathname, operationIds),
      responses: buildResponses(endpoint),
    };

    const summary = sanitizeText(endpoint?.title);
    if (summary) {
      operation.summary = summary;
    }

    const opDescription = sanitizeText(endpoint?.description);
    if (opDescription) {
      operation.description = opDescription;
    }

    const group = sanitizeText(endpoint?.group);
    if (group) {
      operation.tags = [group];
    }

    if (endpoint?.deprecated) {
      operation.deprecated = true;
    }

    const { parameters, requestBody } = buildParametersAndRequestBody(
      endpoint,
      method,
      pathname,
    );
    if (parameters.length > 0) {
      operation.parameters = parameters;
    }
    if (requestBody && !BODYLESS_METHODS.has(method)) {
      operation.requestBody = requestBody;
    }

    openapi.paths[pathname][method] = operation;
  }

  const tags = toTags(endpoints);
  if (tags.length > 0) {
    openapi.tags = tags;
  }

  return openapi;
}

export function serializeOpenApi(document, format = "json", pretty = true) {
  if (format === "yaml") {
    return YAML.stringify(document);
  }
  return JSON.stringify(document, null, pretty ? 2 : 0);
}
