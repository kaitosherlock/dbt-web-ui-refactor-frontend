-- AlterEnum
ALTER TYPE "run_command" ADD VALUE IF NOT EXISTS 'parse';
ALTER TYPE "run_command" ADD VALUE IF NOT EXISTS 'ls';
ALTER TYPE "run_command" ADD VALUE IF NOT EXISTS 'debug';
ALTER TYPE "run_command" ADD VALUE IF NOT EXISTS 'run_operation';
ALTER TYPE "run_command" ADD VALUE IF NOT EXISTS 'retry';
ALTER TYPE "run_command" ADD VALUE IF NOT EXISTS 'clone';
