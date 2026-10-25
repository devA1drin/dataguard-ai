/**
 * MITRE ATT&CK techniques used in DataGuard AI. IDs and names verified on attack.mitre.org
 * (Enterprise matrix). Links open the official technique page.
 */
export const TECHNIQUES: Record<string, string> = {
  T1110: "Brute Force",
  "T1110.001": "Brute Force: Password Guessing",
  "T1110.003": "Brute Force: Password Spraying",
  T1078: "Valid Accounts",
  T1213: "Data from Information Repositories",
  T1567: "Exfiltration Over Web Service",
  T1566: "Phishing",
  T1530: "Data from Cloud Storage",
};

export const attackUrl = (id: string) => `https://attack.mitre.org/techniques/${id.replace(".", "/")}/`;

/** Incident category -> technique (lost_device is physical, no ATT&CK Enterprise technique). */
export const INCIDENT_TECHNIQUE: Record<string, string | null> = {
  phishing: "T1566", unauthorized_access: "T1078", data_leak: "T1567", misconfiguration: "T1530", policy_violation: "T1213", lost_device: null,
};

/** ML access anomaly: bulk record access = T1213; when the event includes an export, also T1567. */
export const accessAnomalyTechniques = (exportFlag: number | boolean | null | undefined) => (exportFlag ? ["T1213", "T1567"] : ["T1213"]);
