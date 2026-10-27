-- Audit attribution is historical identity, not live authorization membership.
-- Preserve every actor UUID and audit row when an organizer is revoked.
alter table wedding.audit_log
  drop constraint audit_log_organizer_user_id_fkey;
