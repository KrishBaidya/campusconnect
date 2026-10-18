import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// The Prisma CLI (migrate, studio, db pull) uses DIRECT_URL (session pooler, port 5432).
// The app at runtime uses the pooled DATABASE_URL — see lib/prisma.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
