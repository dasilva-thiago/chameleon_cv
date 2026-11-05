-- Annotated Markdown import (ADR-0013) is recorded with its own source format. ADD VALUE needs no data
-- change; the new value is not used inside this migration transaction.
ALTER TYPE "ImportSourceFormat" ADD VALUE 'markdown';
