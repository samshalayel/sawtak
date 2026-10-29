/**
 * POSTs a video request for audio the server has just made. The server keeps that audio for a while and gave the page
 * an id for it, so the request names the audio by id instead of uploading it again (minutes of upload on a slow
 * connection). If the server no longer has it (it restarted, or half an hour passed), the audio itself is sent.
 */
export async function postRender(
  url: string,
  body: Record<string, unknown>,
  audio: { id?: string; base64: string },
  fields: { id: string; base64: string } = { id: 'audioId', base64: 'audioBase64' },
): Promise<Response> {
  const post = (extra: Record<string, unknown>) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...extra }),
  });
  if (audio.id) {
    const res = await post({ [fields.id]: audio.id });
    if (res.status !== 410) return res;
  }
  return post({ [fields.base64]: audio.base64 });
}
