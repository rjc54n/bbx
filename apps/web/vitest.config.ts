import path from "node:path";
import { loadEnv } from "vite";
import { defaultExclude, defineConfig } from "vitest/config";

// Mirrors tsconfig.json's "@/*" -> "./src/*" path alias; Vitest resolves
// modules via Vite, which doesn't read tsconfig paths on its own.
//
// Also loads .env.local the way Next.js does (Vite doesn't do this
// automatically outside its own dev server) -- src/lib/supabase.ts
// constructs its client at module load time, so any test that imports a
// query/fetch* module transitively needs real NEXT_PUBLIC_SUPABASE_* values
// even for tests that only exercise pure helpers within that module.
//
// *.live.test.ts hits the real linked Supabase project and is excluded from
// the default `npm test` run so it stays fast/offline; run it explicitly
// with `npm run test:live`.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "");
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }

  const includeLive = process.env.VITEST_LIVE === "1";

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      exclude: includeLive ? defaultExclude : [...defaultExclude, "**/*.live.test.ts"],
    },
  };
});
