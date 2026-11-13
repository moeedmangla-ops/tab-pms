-- DropIndex
DROP INDEX "public"."client_search_trgm";

-- AlterTable
ALTER TABLE "public"."reminder_log" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;
