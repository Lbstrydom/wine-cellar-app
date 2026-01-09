/**
 * One-off diagnostic: verify OpenAI API connectivity and model access.
 *
 * Safety: never prints OPENAI_API_KEY.
 */

import 'dotenv/config';
import OpenAI from 'openai';

const keyPresent = Boolean(process.env.OPENAI_API_KEY);
if (!keyPresent) {
  console.error('Missing OPENAI_API_KEY in environment.');
  process.exitCode = 2;
  process.exit();
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function redactError(err) {
  if (!err) return { message: 'Unknown error' };

  const status = err.status ?? err.response?.status;
  const message = String(err.message ?? '');
  const type = err.error?.type ?? err.type;
  const code = err.error?.code ?? err.code;

  return {
    status,
    type,
    code,
    message: message.replaceAll(process.env.OPENAI_API_KEY, '[REDACTED]')
  };
}

async function main() {
  // 1) List models and check presence of gpt-5.2 (this verifies project access).
  try {
    const models = await client.models.list();
    const ids = (models.data ?? []).map(m => m.id).filter(Boolean);
    const has52 = ids.includes('gpt-5.2');
    const has52Chat = ids.includes('gpt-5.2-chat-latest');

    console.log('models.list ok');
    console.log(JSON.stringify({ hasGpt52: has52, hasGpt52Chat: has52Chat, sample: ids.slice(0, 20) }, null, 2));
  } catch (err) {
    console.error('models.list failed');
    console.error(JSON.stringify(redactError(err), null, 2));
  }

  // 2) Try a tiny Responses call on gpt-5.2.
  // If this fails with 404/model_not_found, you don't have access in this project.
  try {
    const resp = await client.responses.create({
      model: 'gpt-5.2',
      reasoning: { effort: 'low' },
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: 'Reply with exactly: OK' }]
      }],
      max_output_tokens: 16
    });

    const outText = (resp.output_text ?? '').trim();
    console.log('responses.create(gpt-5.2) ok');
    console.log(JSON.stringify({ outputText: outText }, null, 2));
  } catch (err) {
    console.error('responses.create(gpt-5.2) failed');
    console.error(JSON.stringify(redactError(err), null, 2));
  }
}

await main();
