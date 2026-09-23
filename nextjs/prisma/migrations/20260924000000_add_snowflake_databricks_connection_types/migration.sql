-- Add snowflake and databricks connection types to connection_type enum
ALTER TYPE "connection_type" ADD VALUE IF NOT EXISTS 'snowflake';
ALTER TYPE "connection_type" ADD VALUE IF NOT EXISTS 'databricks';
