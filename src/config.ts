// Bun loads .env automatically.
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

export const config = {
  sgcUrl: (process.env.SGC_URL ?? "https://social.giorgiovola.casa").replace(/\/+$/, ""),
  sgcToken: required("SGC_TOKEN"),
  orbitUrl: required("ORBIT_URL").replace(/\/+$/, ""),
  orbitToken: required("ORBIT_TOKEN"),
  orbitProjectKey: process.env.ORBIT_PROJECT_KEY?.trim() || "",
  orbitStatusName: process.env.ORBIT_STATUS_NAME?.trim() || "Feedback",
  stateFile: process.env.STATE_FILE?.trim() || "state.json",
};
