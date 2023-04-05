export function generateId(): string {
  return Math.abs(Math.random() * Math.random() * Date.now() | 0).toString()
    + Math.abs(Math.random() * Math.random() * Date.now() | 0).toString();
}
