// Lambda custom runtime: the Runtime API loop (next invocation -> handler -> response or error). Written out here so
// the image can be plain Alpine with the same ffmpeg and fonts as the site, without compiling AWS's runtime client.
// https://docs.aws.amazon.com/lambda/latest/dg/runtimes-api.html
import { handler } from './handler.ts';

const API = `http://${process.env.AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime`;
const asError = (e: any) => JSON.stringify({ errorType: e?.name || 'Error', errorMessage: String(e?.message || e).slice(0, 2000) });

async function loop() {
  for (;;) {
    const next = await fetch(`${API}/invocation/next`);
    const id = next.headers.get('lambda-runtime-aws-request-id');
    let body: string;
    let ok = true;
    try {
      body = JSON.stringify(await handler(await next.json()));
    } catch (e) {
      console.error('Reel render failed:', e);
      ok = false;
      body = asError(e);
    }
    await fetch(`${API}/invocation/${id}/${ok ? 'response' : 'error'}`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  }
}

loop().catch(async e => {
  console.error('Runtime failed:', e);
  await fetch(`${API}/init/error`, { method: 'POST', body: asError(e) }).catch(() => {});
  process.exit(1);
});
