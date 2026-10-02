import { readFileSync } from "node:fs";
import openapiTS, { astToString } from "openapi-typescript";
const expected = await openapiTS(new URL("./openapi.json", import.meta.url));
const generated = astToString(expected);
// CLI prepends its standard header; compare the actual declarations deterministically.
const normalize = (s) => s.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "").trim();
const actual = readFileSync(new URL("./src/schema.d.ts", import.meta.url), "utf8");
if (normalize(actual) !== normalize(generated)) {
  console.error("Generated TypeScript drift; run npm run generate"); process.exit(1);
}
console.log("Generated TypeScript matches OpenAPI.");
