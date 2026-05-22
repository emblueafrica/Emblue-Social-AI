-- AlterTable: add author/original context to the approval queue so it can be
-- persisted and rehydrated from the database instead of an in-memory array.
ALTER TABLE "approval_queue" ADD COLUMN "author_handle" TEXT,
ADD COLUMN "original_text" TEXT;
