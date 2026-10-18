import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI (migrate, studio, db pull) uses DIRECT_URL (session pooler, port 5432).
// The app at runtime uses the pooled DATABASE_URL — see lib/prisma.ts.
// `prisma generate` needs no database, so a missing DIRECT_URL must not break installs/builds.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});
