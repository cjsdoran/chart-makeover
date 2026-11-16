// Validates model output against schemas/ (JSON Schema 2020-12, spec §10). Functions call this
// before anything goes back to the browser (spec §7).
import Ajv2020 from 'ajv/dist/2020.js';
import readChartSchema from '../schemas/read-chart.json' with { type: 'json' };
import stageReviewSchema from '../schemas/stage-review.json' with { type: 'json' };
import redrawSpecSchema from '../schemas/redraw-spec.json' with { type: 'json' };

// The redraw plan is made in two calls (spec D80); each returns part of redraw-spec.json.
const part = (id, keys) => ({
  ...redrawSpecSchema, $id: id, required: keys,
  properties: Object.fromEntries(keys.map((k) => [k, redrawSpecSchema.properties[k]])),
});
export const REDRAW_PARTS = {
  chart: ['redrawable', 'reason', 'subheading', 'chart', 'table', 'source'],
  finish: ['leadNumbers', 'annotations', 'referenceLines', 'notes'],
};

const SCHEMAS = {
  'read-chart': readChartSchema,
  'stage-review': stageReviewSchema,
  'redraw-spec': redrawSpecSchema,
  'redraw-chart': part('redraw-chart.json', REDRAW_PARTS.chart),
  'redraw-finish': part('redraw-finish.json', REDRAW_PARTS.finish),
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

/** A schema as compact JSON, for prompts that must show the model the shape to return. */
export function schemaText(name) {
  return JSON.stringify(SCHEMAS[name]);
}
