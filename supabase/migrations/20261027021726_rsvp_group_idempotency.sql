-- Preserve saved records while scoping request UUIDs to the invitation group.
alter table wedding.rsvp_submissions drop constraint rsvp_submissions_request_id_key;
alter table wedding.rsvp_submissions add constraint rsvp_submissions_group_request_id_key unique(group_id,request_id);
alter table wedding.rsvp_submissions add column original_duplicate_warning boolean not null default false;
