const maximumDelayMs = 60_000;

function headers(token: string | undefined) {
  return {
    accept: 'application/json',
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  };
}

function parseJson(url: string, text: string) {
  try {
    const data: unknown = JSON.parse(text);
    return data;
  } catch {
    throw new Error(`${url} answered with invalid JSON.`);
  }
}

async function refuse(method: string, url: string, response: Response) {
  const text = await response.text();
  return new Error(`${method} ${url} answered ${String(response.status)}: ${text.trim()}`);
}

function sleep(delayMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export interface RetryPolicy {
  attempts: number;
  delayMs: number;
}

export interface JsonAnswer {
  data: unknown;
  status: number;
}

// An absent resource is a fact the caller reads, so a 404 answers with an undefined body.
export async function readJson(url: string, token?: string): Promise<JsonAnswer> {
  const response = await fetch(url, { headers: headers(token) });
  if (response.status === 404) {
    return { data: undefined, status: response.status };
  }
  if (!response.ok) {
    throw await refuse('GET', url, response);
  }
  const text = await response.text();
  return { data: parseJson(url, text), status: response.status };
}

export async function readBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw await refuse('GET', url, response);
  }
  const body = await response.arrayBuffer();
  return Buffer.from(body);
}

export async function writeJson(url: string, token: string, body: unknown) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { ...headers(token), 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    throw await refuse('POST', url, response);
  }
  const text = await response.text();
  return parseJson(url, text);
}

export async function writeBytes(url: string, token: string, bytes: Buffer, contentType: string) {
  const response = await fetch(url, {
    body: new Uint8Array(bytes),
    headers: { ...headers(token), 'content-type': contentType },
    method: 'POST',
  });
  if (!response.ok) {
    throw await refuse('POST', url, response);
  }
}

export async function removeResource(url: string, token: string) {
  const response = await fetch(url, { headers: headers(token), method: 'DELETE' });
  if (!response.ok) {
    throw await refuse('DELETE', url, response);
  }
}

// The registry and the GitHub API both propagate a write with a delay, so a read after a write waits for it.
// A failed read is one more way a write has not propagated, so it counts as an attempt and its error survives to the end.
export async function until<Value>(
  policy: RetryPolicy,
  subject: string,
  read: () => Promise<Value | undefined>,
) {
  let delayMs = policy.delayMs;
  let failure: { error: unknown } | undefined = undefined;
  for (let attempt = 1; attempt <= policy.attempts; attempt += 1) {
    try {
      const value = await read();
      if (value !== undefined) {
        return value;
      }
      failure = undefined;
    } catch (error) {
      failure = { error };
    }
    if (attempt < policy.attempts) {
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, maximumDelayMs);
    }
  }
  if (failure !== undefined) {
    throw failure.error;
  }
  throw new Error(`${subject} did not appear after ${String(policy.attempts)} attempts.`);
}
