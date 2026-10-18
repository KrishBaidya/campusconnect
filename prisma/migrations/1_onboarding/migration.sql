-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "github_username" TEXT,
ADD COLUMN     "onboarded_at" TIMESTAMPTZ(6),
ADD COLUMN     "projects" JSONB NOT NULL DEFAULT '[]';
