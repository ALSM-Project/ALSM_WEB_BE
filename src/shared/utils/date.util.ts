/** Validate Date internal slots across VM/BSON realms without accepting strings/casts. */
export function isValidDate(value: unknown): value is Date {
  try {
    return Number.isFinite(Date.prototype.getTime.call(value));
  } catch {
    return false;
  }
}
