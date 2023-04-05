import type { Options } from "tsup";

const env = process.env.NODE_ENV;

export const tsup: Options = {
  globalName: "topGunSocket",
  splitting: true,
  sourcemap: env === "development",
  clean: true,
  dts: true,
  format: ["cjs", "esm", "iife"],
  minify: false,
  bundle: true,
  skipNodeModulesBundle: true,
  entry: {
    "client": "src/socket-client/index.ts",
    "server": "src/socket-server/index.ts",
    "channel": "src/channel/index.ts",
    "writable-consumable-stream": "src/writable-consumable-stream/index.ts",
  },
  watch: env === "development",
};
