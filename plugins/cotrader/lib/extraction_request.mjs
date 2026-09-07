export class InputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputValidationError";
    this.code = "INVALID_INPUT";
  }
}

const MAX_URL_CHARS = 2_048;

function readInteger(input, field, defaultValue, minimum, maximum) {
  if (!Object.hasOwn(input, field)) return defaultValue;
  const value = input[field];
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new InputValidationError(`${field} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function normalizeExtractionRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InputValidationError("Request body must be a JSON object.");
  }

  const allowedFields = new Set(["url", "ocrImages", "maxTextChars", "maxImages"]);
  const unknownField = Object.keys(input).find((field) => !allowedFields.has(field));
  if (unknownField) {
    throw new InputValidationError(`Unknown request field: ${unknownField}`);
  }

  if (
    typeof input.url !== "string" ||
    input.url.length === 0 ||
    input.url.length > MAX_URL_CHARS ||
    input.url !== input.url.trim() ||
    !/^https?:\/\//iu.test(input.url) ||
    /[\u0000-\u001f\u007f]/u.test(input.url)
  ) {
    throw new InputValidationError(`url must be a non-empty string of at most ${MAX_URL_CHARS} characters.`);
  }

  let url;
  try {
    url = new URL(input.url);
  } catch {
    throw new InputValidationError("url must be an absolute HTTP or HTTPS URL.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new InputValidationError("url must be an absolute HTTP or HTTPS URL.");
  }
  if (url.username || url.password) {
    throw new InputValidationError("url must not include credentials.");
  }
  url.hash = "";
  if (url.href.length > MAX_URL_CHARS) {
    throw new InputValidationError(`url must normalize to at most ${MAX_URL_CHARS} characters.`);
  }

  if (Object.hasOwn(input, "ocrImages") && typeof input.ocrImages !== "boolean") {
    throw new InputValidationError("ocrImages must be a boolean.");
  }

  return {
    url: url.href,
    ocrImages: input.ocrImages ?? false,
    maxTextChars: readInteger(input, "maxTextChars", 30_000, 1_000, 100_000),
    maxImages: readInteger(input, "maxImages", 30, 0, 100)
  };
}
