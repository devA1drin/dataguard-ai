/**
 * Incident-response playbooks (NIST SP 800-61 style phases, simplified for a capstone).
 * One checklist per incident category; every tick is written to the hash-chained audit log.
 */
export type Phase = "contain" | "eradicate" | "recover" | "lessons";
export interface Step { key: string; phase: Phase; text: string }

const s = (phase: Phase, key: string, text: string): Step => ({ key: `${phase}.${key}`, phase, text });

const COMMON_LESSONS = [
  s("lessons", "review", "Hold a blameless post-incident review within 2 weeks"),
  s("lessons", "update", "Update this playbook, training and controls with what you learned"),
];

export const PLAYBOOKS: Record<string, { title: string; steps: Step[] }> = {
  phishing: { title: "Phishing", steps: [
    s("contain", "block", "Block the sender domain/URL in the mail gateway and web proxy"),
    s("contain", "pull", "Remove the message from every mailbox that received it"),
    s("contain", "reset", "Reset passwords and revoke sessions of anyone who clicked or entered credentials"),
    s("eradicate", "scan", "Scan affected devices for malware from attachments"),
    s("eradicate", "mfa", "Confirm MFA is enabled on the affected accounts"),
    s("recover", "monitor", "Watch affected accounts for unusual sign-ins for 14 days"),
    s("recover", "notify", "Tell staff what the phish looked like and how to report the next one"),
    ...COMMON_LESSONS] },
  unauthorized_access: { title: "Unauthorized access", steps: [
    s("contain", "disable", "Disable or lock the compromised account and revoke all its sessions"),
    s("contain", "block_ip", "Block the source IP(s) and review other sign-ins from them"),
    s("eradicate", "creds", "Reset credentials and require MFA enrolment"),
    s("eradicate", "scope", "Review the access and audit logs to list every record that was viewed"),
    s("recover", "restore", "Restore least-privilege access and re-enable the account"),
    s("recover", "breach", "Decide whether personal data was exposed (start the NPC 72-hour clock if yes)"),
    ...COMMON_LESSONS] },
  data_leak: { title: "Data leak / exfiltration", steps: [
    s("contain", "stop", "Stop the leak: revoke the share link, export job or API key"),
    s("contain", "preserve", "Preserve evidence (logs, files) before changing anything else"),
    s("eradicate", "takedown", "Request takedown of leaked copies and rotate exposed secrets"),
    s("eradicate", "scope", "Count affected data subjects and the types of personal data involved"),
    s("recover", "npc", "Notify the NPC within 72 hours if it is a personal data breach (NPC Circular 16-03, Sec. 17)"),
    s("recover", "subjects", "Notify affected data subjects with clear advice"),
    ...COMMON_LESSONS] },
  misconfiguration: { title: "Misconfiguration", steps: [
    s("contain", "restrict", "Restrict public access to the misconfigured resource"),
    s("contain", "logs", "Check access logs for who reached it while it was open"),
    s("eradicate", "fix", "Fix the configuration and add an automated check for it"),
    s("recover", "verify", "Verify the fix from outside the network (e.g. the Security self-check page)"),
    s("recover", "breach", "Decide whether personal data was exposed (start the NPC 72-hour clock if yes)"),
    ...COMMON_LESSONS] },
  policy_violation: { title: "Policy violation", steps: [
    s("contain", "suspend", "Suspend the access that was misused"),
    s("contain", "hr", "Inform the line manager / HR as the policy requires"),
    s("eradicate", "review", "Review the user's recent activity for other violations"),
    s("recover", "retrain", "Arrange refresher training and restore appropriate access"),
    ...COMMON_LESSONS] },
  lost_device: { title: "Lost or stolen device", steps: [
    s("contain", "wipe", "Remote-lock or wipe the device"),
    s("contain", "revoke", "Revoke the device's sessions and tokens; reset the user's password"),
    s("eradicate", "encryption", "Confirm whether the disk was encrypted (if not, treat as a possible breach)"),
    s("recover", "replace", "Issue a replacement device with full-disk encryption"),
    s("recover", "breach", "Decide whether personal data was exposed (start the NPC 72-hour clock if yes)"),
    ...COMMON_LESSONS] },
  general: { title: "General incident", steps: [
    s("contain", "isolate", "Isolate the affected system or account"),
    s("eradicate", "cause", "Find and remove the root cause"),
    s("recover", "restore", "Restore normal service and monitor closely"),
    ...COMMON_LESSONS] },
};

export const playbookFor = (category: string | null | undefined) => PLAYBOOKS[category ?? ""] ?? PLAYBOOKS.general;

/** NPC Circular 16-03, Sec. 17(A): notify the Commission within 72 hours of knowledge of the breach. */
export const NPC_HOURS = 72;
