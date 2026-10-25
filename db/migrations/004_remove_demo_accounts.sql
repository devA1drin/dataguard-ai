-- DataGuard AI - migration 004: remove the old shared demo login accounts (*@dataguard.demo).
-- The synthetic data they touched (incidents, alerts, notes, requests) is KEPT; only the
-- link to the deleted login is cleared. audit_logs is not modified (actor_id has no
-- foreign key, so the hash chain stays valid). Safe to run more than once.
BEGIN;
CREATE TEMP TABLE demo_users ON COMMIT DROP AS
  SELECT id FROM users WHERE lower(email) LIKE '%@dataguard.demo';
UPDATE consent_history  SET changed_by  = NULL WHERE changed_by  IN (SELECT id FROM demo_users);
UPDATE data_requests    SET handled_by  = NULL WHERE handled_by  IN (SELECT id FROM demo_users);
UPDATE alerts           SET reviewed_by = NULL WHERE reviewed_by IN (SELECT id FROM demo_users);
UPDATE incidents        SET reported_by = NULL WHERE reported_by IN (SELECT id FROM demo_users);
UPDATE incidents        SET assigned_to = NULL WHERE assigned_to IN (SELECT id FROM demo_users);
UPDATE incident_actions SET actor_id    = NULL WHERE actor_id    IN (SELECT id FROM demo_users);
DELETE FROM users WHERE id IN (SELECT id FROM demo_users);
COMMIT;
