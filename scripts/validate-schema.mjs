import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schemaPath = resolve("specs/engagement-setup.schema.json");
const samplePath = resolve(process.argv[2] ?? "specs/fixtures/hartwell-fy2024.sample.json");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const sample = JSON.parse(readFileSync(samplePath, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats.default ? addFormats.default(ajv) : addFormats(ajv);

const validate = ajv.compile(schema);
const ok = validate(sample);

if (ok) {
  console.log("OK — sample validates against schema");
  process.exit(0);
} else {
  console.error("FAIL — schema validation errors:");
  for (const e of validate.errors ?? []) {
    console.error("  -", e.instancePath || "(root)", e.message, e.params ?? "");
  }
  process.exit(1);
}
