// Validates model output against schemas/ (JSON Schema 2020-12, spec §10). Functions call this
// before anything goes back to the browser (spec §7).
import Ajv2020 from 'ajv/dist/2020.js';
import readChartSchema from '../schemas/read-chart.json' with { type: 'json' };
import stageReviewSchema from '../schemas/stage-review.json' with { type: 'json' };
import redrawSpecSchema from '../schemas/redraw-spec.json' with { type: 'json' };

const SCHEMAS = {
  'read-chart': readChartSchema,
  'stage-review': stageReviewSchema,
  'redraw-spec': redrawSpecSchema,
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validators = Object.fromEntries(Object.entries(SCHEMAS).map(([name, schema]) => [name, ajv.compile(schema)]));

/**
 * @param {string} name a key of SCHEMAS
 * @returns {{ ok: boolean, errors: string[] }} errors are short, for logs and retry prompts.
 */
export function checkSchema(name, data) {
  const validate = validators[name];
  if (!validate) throw new Error(`Unknown schema: ${name}`);
  if (validate(data)) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: validate.errors.slice(0, 20).map((e) => `${e.instancePath || '(root)'} ${e.message}`),
  };
}

export { parseModelJson } from './modelJson.js';
