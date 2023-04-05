export function isNode(): boolean {
  // @ts-ignore
  return typeof process === "object";
}
