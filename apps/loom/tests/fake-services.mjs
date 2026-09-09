// A fake npm registry and GitHub API for the release command tests.
// It runs as its own process because the tests spawn the CLI synchronously, which blocks their own event loop.
// It serves the registry under /registry, the GitHub API under /github, and reports every write it received at /state.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const state = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const writes = [];

function assetName(name, version) {
  return `${name.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`;
}

function tarballBytes(entry) {
  return Buffer.from(entry.tarball ?? 'tarball bytes', 'utf8');
}

function integrity(entry) {
  return (
    entry.integrity ?? `sha512-${createHash('sha512').update(tarballBytes(entry)).digest('base64')}`
  );
}

function send(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body);
}

function missing(response) {
  send(response, 404, { message: 'Not Found' });
}

// A package that exists carries an earlier version, and the released version only once it is published.
function packument(entry, name, host) {
  const earlier = {
    dist: { integrity: 'sha512-earlier', tarball: `http://${host}/registry/tarballs/earlier.tgz` },
    name,
    version: '0.0.1',
  };
  const released = {
    dist: {
      integrity: integrity(entry),
      tarball: `http://${host}/registry/tarballs/${assetName(name, state.version)}`,
    },
    name,
    version: state.version,
  };
  return {
    name,
    versions: entry.published
      ? { '0.0.1': earlier, [state.version]: released }
      : { '0.0.1': earlier },
  };
}

function provenance(entry, name) {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://actions.github.io/buildtypes/workflow/v1',
        resolvedDependencies: [
          {
            digest: { gitCommit: entry.provenanceCommit },
            uri: `git+https://github.com/${entry.provenanceRepository ?? state.repository}@${entry.provenanceRef ?? 'refs/heads/main'}`,
          },
        ],
      },
    },
    predicateType: 'https://slsa.dev/provenance/v1',
    subject: [
      {
        name: entry.provenanceSubject ?? `pkg:npm/${name.replace('@', '%40')}@${state.version}`,
      },
    ],
  };
  return {
    attestations: [
      {
        bundle: { dsseEnvelope: { payload: 'e30=' } },
        predicateType: 'https://example.invalid/other/v1',
      },
      {
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement), 'utf8').toString('base64'),
            payloadType: 'application/vnd.in-toto+json',
          },
        },
        predicateType: 'https://slsa.dev/provenance/v1',
      },
    ],
  };
}

function findPackage(name) {
  return Object.hasOwn(state.packages, name) ? state.packages[name] : undefined;
}

function registry(request, response, path, host) {
  const attestations = '/-/npm/v1/attestations/';
  if (path.startsWith(attestations)) {
    const spec = decodeURIComponent(path.slice(attestations.length));
    const name = spec.slice(0, spec.lastIndexOf('@'));
    const entry = findPackage(name);
    if (entry?.provenanceCommit === undefined) {
      missing(response);
      return;
    }
    send(response, 200, provenance(entry, name));
    return;
  }
  if (path.startsWith('/tarballs/')) {
    const file = path.slice('/tarballs/'.length);
    const found = Object.entries(state.packages).find(
      ([name]) => assetName(name, state.version) === file,
    );
    if (!found) {
      missing(response);
      return;
    }
    if (found[1].tarballStalls > 0) {
      found[1].tarballStalls -= 1;
      // The endpoint holds the connection and never answers, so the client's own deadline ends the request.
      return;
    }
    if (found[1].tarballMisses > 0) {
      found[1].tarballMisses -= 1;
      send(response, 503, { message: 'Service Unavailable' });
      return;
    }
    response.writeHead(200, { 'content-type': 'application/gzip' });
    response.end(tarballBytes(found[1]));
    return;
  }
  const name = decodeURIComponent(path.slice(1));
  const entry = findPackage(name);
  if (!entry) {
    missing(response);
    return;
  }
  if (entry.stalls > 0) {
    entry.stalls -= 1;
    // The endpoint holds the connection and never answers, so the client's own deadline ends the request.
    return;
  }
  if (entry.misses > 0) {
    entry.misses -= 1;
    missing(response);
    return;
  }
  send(response, 200, packument(entry, name, host));
}

// GitHub reports the upload state of every asset, and an asset the fixture leaves unstated finished its upload.
function releaseAssets() {
  return state.release.assets.map((asset) => ({ state: 'uploaded', ...asset }));
}

function releaseBody(host) {
  return {
    assets: releaseAssets(),
    id: state.release.id,
    tag_name: `v${state.version}`,
    upload_url: `http://${state.release.uploadHost ?? host}/github/uploads/repos/${state.repository}/releases/${state.release.id}/assets{?name,label}`,
  };
}

function github(request, response, url, host, body) {
  const path = url.pathname.slice('/github'.length);
  const repository = `/repos/${state.repository}`;
  if (request.method === 'GET' && path === `${repository}/git/ref/tags/v${state.version}`) {
    if (!state.tag) {
      missing(response);
      return;
    }
    send(response, 200, {
      object: state.tag.annotated
        ? { sha: `tagobject-${state.tag.commit}`, type: 'tag' }
        : { sha: state.tag.commit, type: 'commit' },
      ref: `refs/tags/v${state.version}`,
    });
    return;
  }
  if (request.method === 'GET' && path.startsWith(`${repository}/git/tags/`)) {
    const sha = path.slice(`${repository}/git/tags/`.length);
    send(response, 200, {
      object: { sha: sha.replace('tagobject-', ''), type: 'commit' },
      sha,
      tag: `v${state.version}`,
    });
    return;
  }
  if (request.method === 'POST' && path === `${repository}/git/tags`) {
    writes.push({ body, method: 'POST', path });
    send(response, 201, { sha: `tagobject-${body.object}` });
    return;
  }
  if (request.method === 'POST' && path === `${repository}/git/refs`) {
    writes.push({ body, method: 'POST', path });
    state.tag = { annotated: true, commit: body.sha.replace('tagobject-', '') };
    send(response, 201, { object: { sha: body.sha, type: 'tag' }, ref: body.ref });
    return;
  }
  if (request.method === 'GET' && path === `${repository}/releases/tags/v${state.version}`) {
    if (!state.release) {
      missing(response);
      return;
    }
    send(response, 200, releaseBody(host));
    return;
  }
  if (request.method === 'POST' && path === `${repository}/releases`) {
    writes.push({ body, method: 'POST', path });
    state.release = { assets: [], id: 900 };
    send(response, 201, releaseBody(host));
    return;
  }
  if (request.method === 'GET' && path === `${repository}/releases/${state.release?.id}/assets`) {
    // GitHub pages the assets list, and a client that wants the whole list asks for a page large enough to hold it.
    const size = Number(url.searchParams.get('per_page') ?? 30);
    send(response, 200, releaseAssets().slice(0, size));
    return;
  }
  if (request.method === 'DELETE' && path.startsWith(`${repository}/releases/assets/`)) {
    const id = Number(path.slice(`${repository}/releases/assets/`.length));
    writes.push({ method: 'DELETE', path });
    state.release.assets = state.release.assets.filter((asset) => asset.id !== id);
    response.writeHead(204);
    response.end();
    return;
  }
  missing(response);
}

function upload(request, response, url, body) {
  const name = url.searchParams.get('name');
  writes.push({
    contentType: request.headers['content-type'],
    method: 'POST',
    name,
    path: url.pathname,
    size: body.length,
  });
  const asset = {
    id: 500 + state.release.assets.length,
    name,
    size: body.length,
    state: 'uploaded',
  };
  state.release.assets = [...state.release.assets, asset];
  send(response, 201, asset);
}

function collect(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const host = request.headers.host ?? 'localhost';
  try {
    const raw = await collect(request);
    if (url.pathname === '/state') {
      send(response, 200, { writes });
    } else if (url.pathname.startsWith('/registry/')) {
      registry(request, response, url.pathname.slice('/registry'.length), host);
    } else if (url.pathname.startsWith('/github/uploads/')) {
      upload(request, response, url, raw);
    } else if (url.pathname.startsWith('/github/')) {
      const body = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined;
      github(request, response, url, host, body);
    } else {
      missing(response);
    }
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: String(error) }));
  }
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`);
});
