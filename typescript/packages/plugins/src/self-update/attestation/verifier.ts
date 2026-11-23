/**
 * The verifier of a trust root, built with the trust material alone so that it keeps
 * sigstore-js's default thresholds: one transparency-log entry, one certificate-transparency
 * timestamp, and one verified timestamp. The constructor arrives as a parameter, whose one-argument
 * type rejects an options object, so that no declaration the API report reads imports
 * `@sigstore/verify`.
 */
function verifierOf<Material, Built>(
  Make: new (material: Material) => Built,
  material: Material,
): Built {
  return new Make(material);
}

export { verifierOf };
