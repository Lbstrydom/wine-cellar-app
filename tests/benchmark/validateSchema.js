/**
 * @fileoverview Validates benchmark file against JSON Schema.
 * Run with: npm run test:benchmark:validate
 */

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BENCHMARK_PATH = path.join(__dirname, '../fixtures/Search_Benchmark_v2_2.json');
const SCHEMA_PATH = path.join(__dirname, 'schemas/benchmarkSchema.json');

async function validateBenchmark() {
  console.log('Wine Search Benchmark Schema Validator');
  console.log('=====================================\n');

  // Load schema
  console.log('Loading schema...');
  const schemaContent = await fs.readFile(SCHEMA_PATH, 'utf8');
  const schema = JSON.parse(schemaContent);
  console.log(`  Schema: ${schema.$id}`);

  // Load benchmark file
  console.log('Loading benchmark file...');
  const benchmarkContent = await fs.readFile(BENCHMARK_PATH, 'utf8');
  const benchmark = JSON.parse(benchmarkContent);
  console.log(`  Version: ${benchmark.version}`);
  console.log(`  Updated: ${benchmark.updated}`);
  console.log(`  Cases: ${benchmark.cases.length}`);

  // Initialize Ajv 2020-12 with formats
  const ajv = new Ajv2020({ allErrors: true, verbose: true });
  addFormats(ajv);

  // Compile schema
  console.log('\nValidating against schema...');
  const validate = ajv.compile(schema);
  const valid = validate(benchmark);

  if (valid) {
    console.log('\n✅ VALIDATION PASSED\n');

    // Print summary statistics
    printSummary(benchmark);

    process.exit(0);
  } else {
    console.log('\n❌ VALIDATION FAILED\n');
    console.log('Errors:');

    for (const error of validate.errors) {
      console.log(`  - ${error.instancePath}: ${error.message}`);
      if (error.params) {
        console.log(`    Params: ${JSON.stringify(error.params)}`);
      }
    }

    process.exit(1);
  }
}

function printSummary(benchmark) {
  console.log('Summary Statistics:');
  console.log('-------------------');

  // Count cases by country
  const byCountry = {};
  const byChallenge = {};
  let withExpected = 0;
  let withVintage = 0;

  for (const c of benchmark.cases) {
    // Country
    byCountry[c.country] = (byCountry[c.country] || 0) + 1;

    // Challenges
    for (const ch of c.challenges) {
      byChallenge[ch] = (byChallenge[ch] || 0) + 1;
    }

    // Expected constraints
    if (c.expected) withExpected++;

    // Vintage
    if (c.vintage) withVintage++;
  }

  console.log(`\nCases by Country (${Object.keys(byCountry).length} countries):`);
  const sortedCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);
  for (const [country, count] of sortedCountries) {
    console.log(`  ${country}: ${count}`);
  }

  console.log(`\nTop 10 Challenges (${Object.keys(byChallenge).length} unique):`);
  const sortedChallenges = Object.entries(byChallenge).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [challenge, count] of sortedChallenges) {
    console.log(`  ${challenge}: ${count}`);
  }

  console.log('\nCoverage:');
  console.log(`  Cases with expected constraints: ${withExpected}/${benchmark.cases.length}`);
  console.log(`  Cases with vintage: ${withVintage}/${benchmark.cases.length}`);
  console.log(`  All cases have producer: ${benchmark.cases.every(c => c.producer) ? 'Yes' : 'No'}`);
}

// Run validation
validateBenchmark().catch(err => {
  console.error('Validation script error:', err.message);
  process.exit(1);
});
